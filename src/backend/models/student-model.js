// src/backend/models/student-model.js
// ALL student SQL queries live here. Nothing else.

const db = require('../database/db');

// Create students table if it doesn't exist
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
      slotId INTEGER,
      feeStatus TEXT DEFAULT 'pending',
      feeAmount INTEGER,
      phone TEXT,
      parentName TEXT,
      parentPhone TEXT,
      address TEXT,
      status TEXT DEFAULT 'Active',
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
    }
  });
}

// INSERT a new student
function addStudent(student, callback) {
  const {
    studentId, firstName, lastName,
    class: studentClass, rollNumber,
    courseId, slotId, feeStatus, feeAmount, phone,
    parentName, parentPhone, address, status
  } = student;

  const sql = `
    INSERT INTO students
      (studentId, firstName, lastName, class, rollNumber, courseId, slotId, feeStatus, feeAmount, phone, parentName, parentPhone, address, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [
    studentId, firstName, lastName,
    studentClass, rollNumber,
    courseId || null, slotId || null,
    feeStatus || 'pending', feeAmount || 0, phone,
    parentName, parentPhone, address, status || 'Active'
  ], function (err) {
    if (err) return callback(err, null);
    callback(null, { id: this.lastID, studentId });
  });
}

// SELECT all students
function getAllStudents(callback) {
  const sql = `SELECT * FROM students ORDER BY createdAt DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return callback(err, null);
    callback(null, rows);
  });
}

// SELECT one student by ID
function getStudentById(id, callback) {
  const sql = `SELECT * FROM students WHERE id = ?`;
  db.get(sql, [id], (err, row) => {
    if (err) return callback(err, null);
    callback(null, row);
  });
}

// UPDATE a student
function updateStudent(id, student, callback) {
  const {
    firstName, lastName,
    class: studentClass, rollNumber,
    courseId, slotId, feeStatus, feeAmount, phone,
    parentName, parentPhone, address, status
  } = student;

  const sql = `
    UPDATE students
    SET firstName = ?, lastName = ?, class = ?, rollNumber = ?,
        courseId = ?, slotId = ?, feeStatus = ?, feeAmount = ?, phone = ?,
        parentName = ?, parentPhone = ?, address = ?, status = ?
    WHERE id = ?
  `;

  db.run(sql, [
    firstName, lastName,
    studentClass, rollNumber,
    courseId || null, slotId || null,
    feeStatus, feeAmount || 0, phone,
    parentName, parentPhone, address, status,
    id
  ], function (err) {
    if (err) return callback(err);
    callback(null, { changes: this.changes });
  });
}

// DELETE a student
function deleteStudent(id, callback) {
  const sql = `DELETE FROM students WHERE id = ?`;
  db.run(sql, [id], function (err) {
    if (err) return callback(err);
    callback(null, { changes: this.changes });
  });
}

// SEARCH students by name or roll number
function searchStudents(query, callback) {
  const like = `%${query}%`;
  const sql = `
    SELECT * FROM students
    WHERE firstName LIKE ?
       OR lastName LIKE ?
       OR rollNumber LIKE ?
       OR studentId LIKE ?
    ORDER BY firstName ASC
  `;
  db.all(sql, [like, like, like, like], (err, rows) => {
    if (err) return callback(err, null);
    callback(null, rows);
  });
}

module.exports = {
  initStudentsTable,
  addStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  searchStudents
};
