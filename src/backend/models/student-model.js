// src/backend/models/student-model.js
// ALL student SQL queries live here. Nothing else.

const db = require('../database/db');
const feeModel = require('./fee-model');

// Run migrations once when the model loads
runMigrations(db);

function runMigrations(db) {
  const newCols = [
    "ALTER TABLE students ADD COLUMN email TEXT",
    "ALTER TABLE students ADD COLUMN photo_path TEXT",
    "ALTER TABLE students ADD COLUMN dob TEXT",
    "ALTER TABLE students ADD COLUMN sex TEXT",
    "ALTER TABLE students ADD COLUMN fatherName TEXT",
    "ALTER TABLE students ADD COLUMN motherName TEXT",
    "ALTER TABLE students ADD COLUMN nationality TEXT DEFAULT 'Indian'",
    "ALTER TABLE students ADD COLUMN qualification TEXT",
    "ALTER TABLE students ADD COLUMN category TEXT DEFAULT 'General'"
  ];
  newCols.forEach(sql => {
    // Empty callback gracefully swallows the 'duplicate column' error on subsequent boots
    db.run(sql, () => {});
  });
}

function initStudentsTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT UNIQUE NOT NULL,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      class TEXT,
      rollNumber TEXT,
      courseId INTEGER,
      slotId TEXT,
      feeStatus TEXT DEFAULT 'pending',
      feeAmount INTEGER,
      phone TEXT,
      parentName TEXT,
      parentPhone TEXT,
      address TEXT,
      status TEXT DEFAULT 'Active',
      admissionDate TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) {
      console.error('Error creating students table:', err.message);
    } else {
      console.log('Students table ready.');
      // Patch existing tables (ignore errors if columns already exist)
      db.run(`ALTER TABLE students ADD COLUMN parentName TEXT`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN parentPhone TEXT`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN address TEXT`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN status TEXT DEFAULT 'Active'`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN feeAmount INTEGER`, () => {});
      db.run(`ALTER TABLE students ADD COLUMN admissionDate TEXT`, () => {});
      
      feeModel.initFeesTable();

      // MIGRATION: Fix duplicate roll numbers for active students
      db.all(`SELECT id, rollNumber FROM students WHERE status = 'Active' AND rollNumber IS NOT NULL AND rollNumber != '' ORDER BY id ASC`, [], (err, rows) => {
        const createIndexAndMigrateFees = () => {
          db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_roll_active ON students(rollNumber) WHERE status = 'Active' AND rollNumber IS NOT NULL AND rollNumber != '';`, () => {});
          migrateOldFees();
        };

        if (!err && rows && rows.length > 0) {
          const seen = new Set();
          let maxRoll = 0;
          
          rows.forEach(r => {
            const val = parseInt(r.rollNumber, 10);
            if (!isNaN(val) && val > maxRoll) {
              maxRoll = val;
            }
          });

          let nextRoll = maxRoll + 1;
          const updates = [];
          rows.forEach(r => {
            if (seen.has(r.rollNumber)) {
              updates.push({ id: r.id, newRoll: String(nextRoll++) });
            } else {
              seen.add(r.rollNumber);
            }
          });

          if (updates.length > 0) {
            const stmt = db.prepare(`UPDATE students SET rollNumber = ? WHERE id = ?`);
            updates.forEach(u => stmt.run([u.newRoll, u.id]));
            stmt.finalize(() => {
              createIndexAndMigrateFees();
            });
          } else {
            createIndexAndMigrateFees();
          }
        } else {
          createIndexAndMigrateFees();
        }
      });
      
      function migrateOldFees() {
        setTimeout(() => {
          db.all('SELECT id, feeAmount, feeStatus, admissionDate FROM students', [], (err, rows) => {
            if(!err && rows) {
              rows.forEach(r => {
                feeModel.ensureFeeRecord(r.id, r.feeAmount || 0, r.admissionDate || new Date().toISOString().slice(0, 10), r.feeStatus, () => {});
              });
            }
          });
        }, 1000);
      }
    }
  });
}

function addStudent(student, callback) {
  const {
    studentId, firstName, lastName,
    class: studentClass, rollNumber,
    courseId, slotId, feeStatus, feeAmount, phone,
    parentName, parentPhone, address, status, admissionDate,
    dob, sex, fatherName, motherName, nationality, qualification, category
  } = student;

  const sql = `
    INSERT INTO students
      (studentId, firstName, lastName, class, rollNumber, courseId, slotId, feeStatus, feeAmount, phone, parentName, parentPhone, address, status, admissionDate, dob, sex, fatherName, motherName, nationality, qualification, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [
    studentId, firstName, lastName,
    studentClass, rollNumber,
    courseId != null ? courseId : null, slotId != null && slotId !== '' ? slotId : null,
    feeStatus || 'pending', feeAmount || 0, phone,
    parentName, parentPhone, address, status || 'Active', admissionDate,
    dob, sex, fatherName, motherName, nationality || 'Indian', qualification, category || 'General'
  ], function (err) {
    if (err) return callback(err, null);
    const newStudentId = this.lastID;
    
    feeModel.ensureFeeRecord(newStudentId, feeAmount || 0, admissionDate, (feeErr) => {
      callback(null, { id: newStudentId, studentId });
    });
  });
}

// BULK INSERT NEW METHOD
function bulkInsertStudents(rows) {
  return new Promise((resolve, reject) => {
    let inserted = 0;
    let skipped = 0;
    
    // Fetch existing students to prevent duplicates in-memory
    db.all("SELECT firstName, lastName, phone FROM students", [], (err, existingRows) => {
      if (err) return reject(err);

      const existingSet = new Set((existingRows || []).map(r => 
        `${(r.firstName || '').toLowerCase()}|${(r.lastName || '').toLowerCase()}|${(r.phone || '').trim()}`
      ));

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO students 
          (studentId, firstName, lastName, phone, email, courseId, address, parentName, parentPhone, photo_path, dob, category, fatherName, motherName) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let pendingCount = rows.length;

        const finalizeAndCommit = () => {
          stmt.finalize();
          db.run("COMMIT", (err) => {
            if (err) reject(err);
            else resolve({ inserted, skipped });
          });
        };

        if (pendingCount === 0) {
          return finalizeAndCommit();
        }

        rows.forEach(row => {
          const key = `${(row.firstName || '').toLowerCase()}|${(row.lastName || '').toLowerCase()}|${(row.phone || '').trim()}`;
          if (existingSet.has(key)) {
            skipped++;
            pendingCount--;
            if (pendingCount === 0) finalizeAndCommit();
            return;
          }

          existingSet.add(key); // Prevent duplicates within the same batch

          // Generate unique ID at insert time format: "STU" + Date.now() + Math.random()
          const uniqueStudentId = "STU" + Date.now() + Math.random().toString(36).substr(2,4).toUpperCase();
          
          stmt.run([
            uniqueStudentId,
            row.firstName || '',
            row.lastName || '',
            row.phone || null,
            row.email || null,
            row.courseId || null,
            row.address || null,
            row.parentName || null,
            row.parentPhone || null,
            row.photo_path || null,
            row.dob || null,
            row.category || null,
            row.fatherName || null,
            row.motherName || null
          ], function(err) {
            if (!err && this.changes > 0) {
              inserted++;
              // Automatically mirror into fees architecture so they appear instantly in the Fees tab
              feeModel.ensureFeeRecord(this.lastID, 0, new Date().toISOString().slice(0, 10), 'pending', () => {
                pendingCount--;
                if (pendingCount === 0) finalizeAndCommit();
              });
            } else {
              skipped++;
              pendingCount--;
              if (pendingCount === 0) finalizeAndCommit();
            }
          });
        });
      });
    });
  });
}

function updateStudentPhoto(studentId, photoPath) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE students SET photo_path = ? WHERE studentId = ?`;
    db.run(sql, [photoPath, studentId], function(err) {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

function getStudentById(id, callback) {
  // Check if standard ID vs string studentId is being passed
  const isStudentIdStr = typeof id === 'string' && id.startsWith('STU');
  
  const sql = `
    SELECT s.*, f.totalAmount as trueFeeAmount, f.status as trueFeeStatus
    FROM students s
    LEFT JOIN fees f ON s.id = f.studentId
    WHERE ${isStudentIdStr ? 's.studentId' : 's.id'} = ?
  `;
  
  db.get(sql, [id], (err, row) => {
    if (callback) {
      if (err) return callback(err, null);
      if (row && row.trueFeeAmount != null) {
        row.feeAmount = row.trueFeeAmount;
        row.feeStatus = row.trueFeeStatus;
        delete row.trueFeeAmount;
        delete row.trueFeeStatus;
      }
      callback(null, row);
    }
  });
}

function getAllStudents(callback) {
  const sql = `
    SELECT s.*, f.totalAmount as trueFeeAmount, f.status as trueFeeStatus
    FROM students s
    LEFT JOIN fees f ON s.id = f.studentId
    ORDER BY CASE WHEN lower(trim(s.status)) = 'inactive' THEN 1 ELSE 0 END ASC, s.createdAt DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return callback(err, null);
    const mappedRows = rows.map(r => {
      if (r.trueFeeAmount != null) r.feeAmount = r.trueFeeAmount;
      if (r.trueFeeStatus != null) r.feeStatus = r.trueFeeStatus;
      delete r.trueFeeAmount;
      delete r.trueFeeStatus;
      return r;
    });
    callback(null, mappedRows);
  });
}

function updateStudent(id, student, callback) {
  const {
    firstName, lastName, class: studentClass, rollNumber,
    courseId, slotId, feeStatus, feeAmount, phone,
    parentName, parentPhone, address, status, admissionDate,
    dob, sex, fatherName, motherName, nationality, qualification, category
  } = student;

  const sql = `
    UPDATE students
    SET firstName = ?, lastName = ?, class = ?, rollNumber = ?,
        courseId = ?, slotId = ?, feeStatus = ?, feeAmount = ?, phone = ?,
        parentName = ?, parentPhone = ?, address = ?, status = ?, admissionDate = ?,
        dob = ?, sex = ?, fatherName = ?, motherName = ?, nationality = ?, qualification = ?, category = ?
    WHERE id = ?
  `;

  db.run(sql, [
    firstName, lastName, studentClass, rollNumber,
    courseId != null ? courseId : null, slotId != null && slotId !== '' ? slotId : null,
    feeStatus, feeAmount || 0, phone, parentName, parentPhone, address, status, admissionDate,
    dob, sex, fatherName, motherName, nationality || 'Indian', qualification, category || 'General',
    id
  ], function (err) {
    if (err) return callback(err);
    feeModel.ensureFeeRecord(id, feeAmount || 0, admissionDate, (feeErr, feeRow) => {
       if(!feeErr && feeRow) {
          feeModel.updateFeeRecord(id, { totalAmount: feeAmount || 0, dueDate: feeRow.dueDate || admissionDate, notes: feeRow.notes }, () => {
             callback(null, { changes: this.changes });
          });
       } else {
         callback(null, { changes: this.changes });
       }
    });
  });
}

function deleteStudent(id, callback) {
  const sql = `DELETE FROM students WHERE id = ?`;
  db.run(sql, [id], function (err) {
    if (err) return callback(err);
    callback(null, { changes: this.changes });
  });
}

function searchStudents(query, callback) {
  const like = `%${query}%`;
  const sql = `
    SELECT s.*, f.totalAmount as trueFeeAmount, f.status as trueFeeStatus
    FROM students s
    LEFT JOIN fees f ON s.id = f.studentId
    WHERE s.firstName LIKE ? OR s.lastName LIKE ? OR s.rollNumber LIKE ? OR s.studentId LIKE ?
    ORDER BY CASE WHEN s.status = 'Inactive' THEN 1 ELSE 0 END ASC, s.createdAt DESC
  `;
  db.all(sql, [like, like, like, like], (err, rows) => {
    if (err) return callback(err, null);
    const mappedRows = rows.map(r => {
      if (r.trueFeeAmount != null) r.feeAmount = r.trueFeeAmount;
      if (r.trueFeeStatus != null) r.feeStatus = r.trueFeeStatus;
      delete r.trueFeeAmount;
      delete r.trueFeeStatus;
      return r;
    });
    callback(null, mappedRows);
  });
}

function checkRollNumberExists(rollNumber, excludeId, callback) {
  const sql = `SELECT id, firstName, lastName FROM students WHERE rollNumber = ? AND status = 'Active' AND id != ? LIMIT 1`;
  db.get(sql, [rollNumber, excludeId || -1], (err, row) => {
    callback(err, row);
  });
}

module.exports = {
  initStudentsTable,
  addStudent,
  bulkInsertStudents,
  updateStudentPhoto,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  searchStudents,
  checkRollNumberExists
};
