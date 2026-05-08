// src/backend/services/google-import-service.js
const { google }      = require('googleapis');
const path            = require('path');
const fs              = require('fs');
const https           = require('https');
const googleService   = require('./google-service');
const studentModel    = require('../models/student-model');

const dataDir = global.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const PHOTOS_DIR = path.join(dataDir, 'student-photos');

// Ensure photos directory exists
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

async function getSheetsMux() {
  const token = await googleService.getValidAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });
  return { 
    sheets: google.sheets({ version: 'v4', auth: oauth2Client }),
    drive: google.drive({ version: 'v3', auth: oauth2Client })
  };
}

function extractFileId(url) {
  if (!url) return null;
  const match = url.match(/(?:id=|d\/)([\w-]{25,})/);
  return match ? match[1] : null;
}

async function previewSheet(sheetIdOrUrl, courses) {
  const { sheets } = await getSheetsMux();
  
  // Support both direct ID and full URL
  const sheetId = extractFileId(sheetIdOrUrl) || sheetIdOrUrl;
  
  // Fetch data (Assuming default sheet A1:Z1000 bounds)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A:Z'
  });

  const allValues = response.data.values;
  if (!allValues || allValues.length < 2) {
    return { rows: [], unmatchedCourses: [] };
  }

  const headers = allValues[0].map(h => h.trim().toLowerCase());
  
  // Find ALL matching column indices dynamically
  const findIndices = (condition) => headers.map((h, i) => condition(h) ? i : -1).filter(i => i !== -1);
  
  const indicesFullName = findIndices(h => h.includes('full name'));
  const indicesPhone = findIndices(h => h.includes('phone') || h.includes('mobile'));
  const indicesEmail = findIndices(h => h.includes('email'));
  const indicesCourse = findIndices(h => h.includes('course'));
  const indicesAddress = findIndices(h => h.includes('address'));
  const indicesParentName = findIndices(h => h.includes('parent') && h.includes('name'));
  const indicesParentPhone = findIndices(h => h.includes('parent') && h.includes('phone'));
  const indicesPhoto = findIndices(h => h.includes('photo'));
  const indicesDob = findIndices(h => h.includes('date of birth') || h.includes('dob'));
  const indicesCategory = findIndices(h => h.includes('category'));
  const indicesFatherName = findIndices(h => h.includes('father') && h.includes('name'));
  const indicesMotherName = findIndices(h => h.includes('mother') && h.includes('name'));

  const getValue = (row, indices) => {
    // Look from right to left (newest columns first in Google Forms)
    for (let i = indices.length - 1; i >= 0; i--) {
      const val = row[indices[i]];
      if (val && val.trim() !== '') return val.trim();
    }
    return '';
  };

  const rows = [];
  const unmatchedCoursesSet = new Set();

  for (let i = 1; i < allValues.length; i++) {
    const row = allValues[i];
    
    const rawFullName = getValue(row, indicesFullName);
    if (!rawFullName) continue;

    const nameParts = rawFullName.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    const rawCourse = getValue(row, indicesCourse);
    let courseId = null;

    if (rawCourse) {
      const matchedCourse = courses.find(c => c.name.trim().toLowerCase() === rawCourse.toLowerCase());
      if (matchedCourse) {
        courseId = matchedCourse.id;
      } else {
        unmatchedCoursesSet.add(rawCourse);
      }
    }

    const drivePhotoStr = getValue(row, indicesPhoto);

    rows.push({
      firstName,
      lastName,
      phone: getValue(row, indicesPhone),
      email: getValue(row, indicesEmail),
      rawCourseName: rawCourse,
      courseId,
      address: getValue(row, indicesAddress),
      parentName: getValue(row, indicesParentName),
      parentPhone: getValue(row, indicesParentPhone),
      dob: getValue(row, indicesDob),
      category: getValue(row, indicesCategory),
      fatherName: getValue(row, indicesFatherName),
      motherName: getValue(row, indicesMotherName),
      drivePhotoUrl: extractFileId(drivePhotoStr) ? drivePhotoStr : null
    });
  }

  return {
    rows,
    unmatchedCourses: Array.from(unmatchedCoursesSet)
  };
}

async function downloadPhoto(driveUrl, studentId) {
  if (!driveUrl) return null;
  const fileId = extractFileId(driveUrl);
  if (!fileId) return null;

  const localPath = path.join(PHOTOS_DIR, `${studentId}.jpg`);

  try {
    const { drive } = await getSheetsMux();
    const dest = fs.createWriteStream(localPath);
    
    return new Promise(async (resolve, reject) => {
      try {
        const res = await drive.files.get(
          { fileId: fileId, alt: 'media' },
          { responseType: 'stream' }
        );

        res.data.pipe(dest);
        
        dest.on('finish', () => resolve(localPath));
        dest.on('error', () => { fs.unlink(localPath, () => {}); resolve(null); });
      } catch (e) {
        console.error("Photo Download API Error for fileId " + fileId + ":", e.message || e);
        resolve(null); // Never throw to keep migration alive
      }
    });

  } catch (err) {
    return null;
  }
}

async function executeImport(confirmedRows) {
  let photosFailed = 0;
  
  // Wait to download all photos ahead of insertion
  for (let row of confirmedRows) {
    const tempStudentId = "STU" + Date.now() + Math.random().toString(36).substr(2,4).toUpperCase(); // Placeholder ID used just to name photo
    
    if (row.drivePhotoUrl) {
      const localPath = await downloadPhoto(row.drivePhotoUrl, tempStudentId);
      if (localPath) {
        row.photo_path = localPath;
      } else {
        photosFailed++;
      }
    }
  }

  // Delegate entirely to DB model
  const dbResult = await studentModel.bulkInsertStudents(confirmedRows);
  
  return {
    inserted: dbResult.inserted,
    skipped: dbResult.skipped,
    photosFailed
  };
}

module.exports = {
  previewSheet,
  downloadPhoto,
  executeImport
};
