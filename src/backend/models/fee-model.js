// src/backend/models/fee-model.js
// ALL fee SQL queries live here.

const db = require('../database/db');

function initFeesTable() {
  db.serialize(() => {
    // Fees table
    db.run(`
      CREATE TABLE IF NOT EXISTS fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        studentId INTEGER UNIQUE NOT NULL,
        totalAmount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        dueDate TEXT,
        notes TEXT,
        createdAt TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(studentId) REFERENCES students(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating fees table:', err.message);
      else console.log('Fees table ready.');
    });

    // Payments table
    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feeId INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        method TEXT,
        paymentDate TEXT,
        note TEXT,
        createdAt TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(feeId) REFERENCES fees(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating payments table:', err.message);
      else console.log('Payments table ready.');

      // Sync: Ensure fee status reflects actual payments vs total
      setTimeout(() => {
        db.all('SELECT id, totalAmount FROM fees', [], (err, rows) => {
          if (!err && rows) {
            rows.forEach(r => {
              triggerFeeUpdate(r.id);
            });
          }
        });
      }, 1500);
    });
  });
}

function getFeeRecordForStudent(studentId, callback) {
  const sql = `SELECT * FROM fees WHERE studentId = ?`;
  db.get(sql, [studentId], (err, row) => {
    if (err) return callback(err, null);
    callback(null, row);
  });
}

function getPaymentsForFeeId(feeId, callback) {
  const sql = `SELECT * FROM payments WHERE feeId = ? ORDER BY paymentDate ASC, createdAt ASC`;
  db.all(sql, [feeId], (err, rows) => {
    if (err) return callback(err, null);
    callback(null, rows);
  });
}

// ── Anchor-clamped period calculation (mirrors fees.js frontend exactly) ─────
// A period is elapsed only when its due date has passed.
// Period N due = admissionDate + N months (anchor-clamped for short months).
// Returns 0 when student is inside their first billing window → nothing owed.
function _getPeriodsElapsed(admissionDateStr) {
  if (!admissionDateStr) return 0;
  const adm = new Date(admissionDateStr);
  if (isNaN(adm.getTime())) return 0;
  const now = new Date();

  let months =
    (now.getFullYear() - adm.getFullYear()) * 12 +
    (now.getMonth() - adm.getMonth());

  // Anchor-day clamping: handle short months (e.g. Jan 31 → Feb 28)
  const anchorDay = adm.getDate();
  const lastDayOfCurrentMonth = new Date(
    now.getFullYear(), now.getMonth() + 1, 0
  ).getDate();
  const effectiveAnchor = Math.min(anchorDay, lastDayOfCurrentMonth);

  // If today hasn't reached the anchor day this month,
  // the current period's due date has NOT passed yet
  if (now.getDate() < effectiveAnchor) months--;

  // Minimum 0 — student may be inside their first window with nothing due yet
  return Math.max(0, months);
}

function triggerFeeUpdate(feeId) {
  // Compute fee status using the same logic as the Fees page frontend (gst()).
  // This ensures Students list and Dashboard always agree with the Fees section.
  const sqlSum = `SELECT COALESCE(SUM(amount), 0) as paidAmount FROM payments WHERE feeId = ?`;
  const sqlFee = `
    SELECT f.totalAmount, s.admissionDate
    FROM fees f
    JOIN students s ON f.studentId = s.id
    WHERE f.id = ?
  `;
  db.get(sqlSum, [feeId], (err, rowSum) => {
    if (err) return;
    db.get(sqlFee, [feeId], (err, rowFee) => {
      if (err || !rowFee) return;
      const monthlyFee = rowFee.totalAmount;
      const periodsElapsed = _getPeriodsElapsed(rowFee.admissionDate);
      const totalOwed = monthlyFee * periodsElapsed;
      const totalPaid = rowSum.paidAmount;
      const balance = Math.max(0, totalOwed - totalPaid);

      // 4-state logic matching frontend gst(), mapped to 2-state column:
      //   fee <= 0           → 'paid'  (no fee configured)
      //   periodsElapsed = 0 → 'paid'  (due-soon: inside first window, nothing owed)
      //   balance <= 0       → 'paid'  (all dues cleared)
      //   balance > 0        → 'pending' (unpaid or overdue)
      let newStatus;
      if (monthlyFee <= 0) {
        newStatus = 'paid';
      } else if (periodsElapsed === 0) {
        newStatus = 'admission';
      } else if (balance <= 0) {
        newStatus = 'paid';
      } else {
        newStatus = 'unpaid';
      }

      const sqlUpdate = `UPDATE fees SET status = ? WHERE id = ?`;
      db.run(sqlUpdate, [newStatus, feeId]);
    });
  });
}

// Ensure a student has a fee record
function ensureFeeRecord(studentId, totalAmount, dueDate, initialStatus, callback) {
  if (typeof initialStatus === 'function') {
    callback = initialStatus;
    initialStatus = 'pending';
  }
  
  getFeeRecordForStudent(studentId, (err, row) => {
    if (err) return callback(err);
    if (!row) {
      const calcStatus = (totalAmount <= 0) ? 'paid' : (initialStatus || 'pre-admission');
      const sql = `INSERT INTO fees (studentId, totalAmount, dueDate, status) VALUES (?, ?, ?, ?)`;
      db.run(sql, [studentId, totalAmount, dueDate, calcStatus], function(err) {
        if (err) return callback(err);
        triggerFeeUpdate(this.lastID);
        setTimeout(() => {
          callback(null, { id: this.lastID, studentId, totalAmount, dueDate, status: calcStatus });
        }, 50);
      });
    } else {
      callback(null, row);
    }
  });
}

function updateFeeRecord(studentId, data, callback) {
  const { totalAmount, dueDate, notes } = data;
  const sql = `UPDATE fees SET totalAmount = ?, dueDate = ?, notes = ? WHERE studentId = ?`;
  db.run(sql, [totalAmount, dueDate, notes, studentId], function(err) {
    if (err) return callback(err);
    // Fetch fee ID to trigger update
    getFeeRecordForStudent(studentId, (err, row) => {
      if (!err && row) triggerFeeUpdate(row.id);
      callback(null, { changes: this.changes });
    });
  });
}

function addPayment(feeId, amount, method, paymentDate, note, callback) {
  const sql = `INSERT INTO payments (feeId, amount, method, paymentDate, note) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [feeId, amount, method, paymentDate, note], function(err) {
    if (err) return callback(err);
    triggerFeeUpdate(feeId);
    callback(null, { id: this.lastID });
  });
}

function deletePayment(paymentId, callback) {
  // First find the feeId
  db.get(`SELECT feeId FROM payments WHERE id = ?`, [paymentId], (err, row) => {
    if (err || !row) return callback(err || new Error("Payment not found"));
    db.run(`DELETE FROM payments WHERE id = ?`, [paymentId], function(err) {
      if (err) return callback(err);
      triggerFeeUpdate(row.feeId);
      callback(null, { changes: this.changes });
    });
  });
}

function getAllFeesWithPayments(callback) {
  const sql = `
    SELECT 
      f.*,
      s.firstName, s.lastName, s.class, s.rollNumber, s.phone, s.studentId as s_studentId, s.courseId, s.admissionDate, 
      s.status as studentStatus, s.createdAt as studentCreatedAt
    FROM fees f
    JOIN students s ON f.studentId = s.id
    ORDER BY CASE WHEN lower(trim(s.status)) = 'inactive' THEN 1 ELSE 0 END ASC, s.createdAt DESC
  `;
  db.all(sql, [], (err, fees) => {
    if (err) return callback(err, null);
    const sqlPayments = `SELECT * FROM payments ORDER BY paymentDate ASC, createdAt ASC`;
    db.all(sqlPayments, [], (err, payments) => {
      if (err) return callback(err, null);
      
      const paymentsByFeeId = {};
      payments.forEach(p => {
        if (!paymentsByFeeId[p.feeId]) paymentsByFeeId[p.feeId] = [];
        paymentsByFeeId[p.feeId].push(p);
      });
      
      const result = fees.map(f => ({
        ...f,
        payments: paymentsByFeeId[f.id] || []
      }));
      callback(null, result);
    });
  });
}

module.exports = {
  initFeesTable,
  getFeeRecordForStudent,
  getPaymentsForFeeId,
  ensureFeeRecord,
  updateFeeRecord,
  addPayment,
  deletePayment,
  getAllFeesWithPayments
};
