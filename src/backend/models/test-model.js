// src/backend/models/test-model.js
const db = require('../database/db');

function initTestsTable() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        courseId INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        questions TEXT,
        duration INTEGER,
        color TEXT DEFAULT 'blue',
        status TEXT DEFAULT 'DRAFT',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        googleFormId TEXT
      )
    `);

    // Redesign: Drop old and create new
    db.run(`DROP TABLE IF EXISTS test_results`);

    db.run(`
      CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        test_number INTEGER,
        score INTEGER,
        total_marks_snapshot INTEGER,
        percentage_snapshot REAL,
        submitted_at DATETIME,
        last_update DATETIME,
        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_students_created_at ON students(createdAt DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_test_results_last_update ON test_results(last_update DESC)`);
  });
}

function getAllTests(callback) {
  const sql = `
    SELECT * FROM tests 
    ORDER BY createdAt DESC
  `;
  db.all(sql, [], callback);
}

function getTestById(id, callback) {
  const sql = `SELECT * FROM tests WHERE id = ?`;
  db.get(sql, [id], callback);
}

function createTest(test, callback) {
  const sql = `
    INSERT INTO tests (courseId, title, description, questions, duration, color, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `;
  db.run(sql, [
    test.courseId || null,
    test.title,
    test.description || null,
    test.questions, // expected to be stringified JSON
    test.duration,
    test.color || 'blue',
    test.status || 'DRAFT'
  ], function (err) {
    callback(err, this ? { id: this.lastID } : null);
  });
}

function deleteTest(id, callback) {
  const sql = `DELETE FROM tests WHERE id = ?`;
  db.run(sql, [id], function (err) {
    callback(err, this ? { changes: this.changes } : null);
  });
}

function updateTest(id, test, callback) {
  const sql = `
    UPDATE tests SET
      title = ?,
      questions = ?,
      status = ?
    WHERE id = ?
  `;
  db.run(sql, [
    test.title,
    test.questions,
    test.status,
    id
  ], function(err) {
    callback(err, this ? { changes: this.changes } : null);
  });
}

function bulkInsertTestResults(results, callback) {
  if (!results || results.length === 0) return callback(null, { inserted: 0 });

  db.serialize(() => {
    let inserted = 0;
    db.run('BEGIN TRANSACTION');

    const stmt = db.prepare(`
      INSERT INTO test_results (
        student_id, test_number, score, total_marks_snapshot, 
        percentage_snapshot, submitted_at, last_update
      )
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM test_results WHERE student_id = ? AND test_number = ?
      )
    `);

    results.forEach(res => {
      stmt.run([
        res.student_id, res.test_number, res.score, res.total_marks_snapshot,
        res.percentage_snapshot, res.submitted_at, res.last_update,
        res.student_id, res.test_number
      ], function(err) {
        if (!err && this.changes > 0) inserted++;
      });
    });

    stmt.finalize();

    db.run('COMMIT', (err) => {
      if (err) {
        db.run('ROLLBACK');
        return callback(err);
      }
      callback(null, { inserted });
    });
  });
}

function getGradesOverviewData(callback) {
  const sql = `
    SELECT
      s.id            AS studentDbId,
      (s.firstName || ' ' || s.lastName) AS studentName,
      s.firstName     AS firstName,
      s.lastName      AS lastName,
      s.studentId     AS studentId,
      s.rollNumber    AS rollNumber,
      s.courseId      AS courseId,
      c.name          AS courseName,
      COALESCE(NULLIF(c.code, ''), c.name, '—') AS courseCode,
      s.createdAt     AS createdAt,
      MAX(tr.last_update) AS lastTestUpdate,

      -- Test 1 snapshot values
      MAX(CASE WHEN tr.test_number = 1 THEN tr.score END)
        AS test1Score,
      MAX(CASE WHEN tr.test_number = 1 THEN tr.total_marks_snapshot END)
        AS test1Total,
      MAX(CASE WHEN tr.test_number = 1 THEN tr.percentage_snapshot END)
        AS test1Percentage,
      MAX(CASE WHEN tr.test_number = 1 THEN tr.submitted_at END)
        AS test1SubmittedAt,

      -- Test 2 snapshot values
      MAX(CASE WHEN tr.test_number = 2 THEN tr.score END)
        AS test2Score,
      MAX(CASE WHEN tr.test_number = 2 THEN tr.total_marks_snapshot END)
        AS test2Total,
      MAX(CASE WHEN tr.test_number = 2 THEN tr.percentage_snapshot END)
        AS test2Percentage,
      MAX(CASE WHEN tr.test_number = 2 THEN tr.submitted_at END)
        AS test2SubmittedAt

    FROM students s
    LEFT JOIN test_results tr ON tr.student_id = s.id
    LEFT JOIN courses c ON s.courseId = c.id
    WHERE s.status = 'Active' AND s.courseId IS NOT NULL

    GROUP BY s.id

    ORDER BY
      MAX(tr.last_update) DESC NULLS LAST,  -- tested students first, most recent on top
      s.createdAt DESC                      -- untested students ordered by newest created
  `;
  db.all(sql, [], callback);
}

function deleteTestResult(id, callback) {
  const sql = `DELETE FROM test_results WHERE id = ?`;
  db.run(sql, [id], function (err) {
    callback(err, this ? { changes: this.changes } : null);
  });
}

function updateGoogleFormId(id, googleFormId, callback) {
  const sql = `UPDATE tests SET googleFormId = ? WHERE id = ?`;
  db.run(sql, [googleFormId, id], function(err) {
    callback(err, this ? { changes: this.changes } : null);
  });
}

module.exports = {
  initTestsTable,
  getAllTests,
  getTestById,
  createTest,
  deleteTest,
  updateTest,
  updateGoogleFormId,
  bulkInsertTestResults,
  getGradesOverviewData,
  deleteTestResult
};
