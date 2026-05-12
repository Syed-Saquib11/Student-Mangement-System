// src/backend/services/test-service.js
const testModel = require('../models/test-model');

function getAllTests(callback) {
  testModel.getAllTests((err, rows) => {
    if (err) return callback(err);
    
    // Parse JSON string for questions
    const mappedRows = rows.map(row => {
      try {
        row.questions = row.questions ? JSON.parse(row.questions) : [];
      } catch (e) {
        row.questions = [];
      }
      return row;
    });
    
    callback(null, mappedRows);
  });
}

function getTestById(id, callback) {
  testModel.getTestById(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Test not found'));

    try {
      row.questions = row.questions ? JSON.parse(row.questions) : [];
    } catch (e) {
      row.questions = [];
    }
    callback(null, row);
  });
}

function createTest(data, callback) {
  // Stringify questions array before saving
  let questionsStr = '[]';
  try {
    questionsStr = data.questions ? JSON.stringify(data.questions) : '[]';
  } catch (e) {
    questionsStr = '[]';
  }

  const testPayload = {
    courseId: data.courseId,
    title: data.title,
    description: data.description,
    questions: questionsStr,
    duration: data.duration,
    color: data.color,
    status: data.status
  };

  testModel.createTest(testPayload, (err, result) => {
    if (err) return callback(err);

    // Log activity
    const activityModel = require('../models/activity-model');
    activityModel.logActivity(
      'test',
      'New Test Created',
      `${data.title} added to the question bank`,
      'assignment'
    );

    callback(null, result);
  });
}

function deleteTest(id, callback) {
  testModel.deleteTest(id, (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
}

function updateTest(id, data, callback) {
  let questionsStr = '[]';
  try {
    questionsStr = data.questions ? JSON.stringify(data.questions) : '[]';
  } catch (e) {
    questionsStr = '[]';
  }

  const testPayload = {
    title: data.title,
    questions: questionsStr,
    status: data.status
  };

  testModel.updateTest(id, testPayload, (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
}

function getGradesOverview(callback) {
  testModel.getGradesOverviewData((err, rows) => {
    if (err) return callback(err);

    const resultList = rows.map(row => {
      const test1 = row.test1Score !== null
        ? {
            score:       row.test1Score,
            totalMarks:  row.test1Total,
            percentage:  row.test1Percentage,
            submittedAt: row.test1SubmittedAt
          }
        : null;

      const test2 = row.test2Score !== null
        ? {
            score:       row.test2Score,
            totalMarks:  row.test2Total,
            percentage:  row.test2Percentage,
            submittedAt: row.test2SubmittedAt
          }
        : null;

      let avgPercentage = null;

      if (test1 && test2) {
        avgPercentage = ((test1.score + test2.score) / (test1.totalMarks + test2.totalMarks)) * 100;
      } else if (test1) {
        avgPercentage = test1.percentage;
      } else if (test2) {
        avgPercentage = test2.percentage;
      } else {
        avgPercentage = null;
      }

      // We still need to give some UI status colors so the frontend can style the rows
      // The prompt didn't say to remove status labels, but just the 'avg logic'.
      let statusLabel = 'Incomplete';
      let statusColor = 'var(--text-muted)';
      
      if (avgPercentage !== null) {
        if (avgPercentage >= 80) {
          statusLabel = 'Excellent';
          statusColor = 'var(--success)';
        } else if (avgPercentage >= 50) {
          statusLabel = 'Good';
          statusColor = 'var(--warning)';
        } else {
          statusLabel = 'Fail';
          statusColor = 'var(--danger)';
        }
      }

      return {
        studentDbId: row.studentDbId,
        studentId: row.studentId,
        studentName: row.studentName || `${row.firstName} ${row.lastName}`.trim(),
        firstName: row.firstName,
        lastName: row.lastName,
        rollNumber: row.rollNumber,
        courseId: row.courseId,
        courseName: row.courseName,
        courseCode: row.courseCode,
        createdAt: row.createdAt,
        lastTestUpdate: row.lastTestUpdate,
        test1: test1,
        test2: test2,
        avgPercentage: avgPercentage,
        statusLabel: statusLabel,
        statusColor: statusColor
      };
    });

    callback(null, resultList);
  });
}

function deleteTestResult(id, callback) {
  testModel.deleteTestResult(id, callback);
}


function executeFormImport(results, callback) {
  testModel.bulkInsertTestResults(results, callback);
}

module.exports = {
  getAllTests,
  getTestById,
  createTest,
  deleteTest,
  updateTest,
  getGradesOverview,
  executeFormImport,
  deleteTestResult
};
