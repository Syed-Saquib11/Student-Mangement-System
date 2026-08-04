// src/main/main.js
// Electron entry point. Creates windows. Registers IPC handlers.
// NO SQL here. All DB work delegated to services.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const https = require('https');

// ─── Set DATA_PATH globally BEFORE any model/service requires db.js ───────
// app.isPackaged = false during npm start (dev), true only in built .exe
// In dev mode we always use the project's own /data folder.
// In packaged mode: check for a /data folder next to the .exe (Portable USB),
// otherwise fall back to userData (Installed).
function getDataPath() {
  if (!app.isPackaged) {
    // Dev mode: use the project's own /data folder (2 levels up from src/main/)
    const devPath = path.join(__dirname, '..', '..', 'data');
    fs.mkdirSync(devPath, { recursive: true });
    return devPath;
  }
  // Packaged: USB portable — data folder sits next to the .exe
  const portablePath = path.join(path.dirname(process.execPath), 'data');
  if (fs.existsSync(portablePath)) return portablePath;
  // Packaged: Installed — use Electron's userData (AppData\Roaming\dataflow)
  const installedPath = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(installedPath, { recursive: true });
  return installedPath;
}
const DATA_PATH = getDataPath();
global.DATA_PATH = DATA_PATH;  // ← db.js and all models read this
console.log('[DATAFLOW] DATA_PATH =', DATA_PATH, '| isPackaged =', app.isPackaged);

// ─── NOW safe to require services/models ──────────────────────────────────
const googleService = require('../backend/services/google-service');
const { initStudentsTable } = require('../backend/models/student-model');

// app.commandLine.appendSwitch('disable-gpu');       // try commenting this
// app.commandLine.appendSwitch('ignore-gpu-blocklist'); // and this too
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-features', 'WidgetLayering');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// ── Init DB tables on startup ──────────────────────────
const activityModel = require('../backend/models/activity-model');
const testModel = require('../backend/models/test-model');
const documentModel = require('../backend/models/document-model');

// ── Services (IPC delegates to these) ─────────────────
const studentService = require('../backend/services/student-service');
const googleImportService = require('../backend/services/google-import-service');
const testService = require('../backend/services/test-service');
const googleFormsService = require('../backend/services/google-forms-service');

const courseModel = require('../backend/models/course-model');
const courseService = require('../backend/services/course-service');
const slotModel = require('../backend/models/slot-model');
const feeModel = require('../backend/models/fee-model');
const feeService = require('../backend/services/fee-service');
const formsModel = require('../backend/models/forms-model');
const documentService = require('../backend/services/document-service');
const authService = require('../backend/services/auth-service');
const driveUploadService = require('../backend/services/drive-upload-service');
const googleDriveService = require('../backend/services/google-drive-service');

// ─── Portable vs Installed path detection ─────────────────────────────────
// If a 'data' folder exists next to the .exe (USB scenario), use that.
// Otherwise fall back to AppData/Roaming/DATAFLOW (installed scenario).


function migrateDataIfNeeded() {
  // Migration only relevant in packaged mode
  if (!app.isPackaged) return;
  const installedPath = path.join(app.getPath('userData'), 'data');
  const bundledDataPath = path.join(process.resourcesPath, 'data');

  // Only migrate if we are using AppData AND we have bundled seed data
  if (DATA_PATH === installedPath && fs.existsSync(bundledDataPath)) {
    const items = fs.readdirSync(bundledDataPath);
    items.forEach(item => {
      const src = path.join(bundledDataPath, item);
      const dest = path.join(installedPath, item);
      // Only copy files that don't already exist in the user's actual data folder
      if (!fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    });
  }
}

migrateDataIfNeeded();


function getRendererPagesDir() {
  return path.join(__dirname, '..', 'renderer', 'pages');
}


function safeFragmentPath(fragmentName) {
  // Allow only simple names like "students", "dashboard", etc.
  if (!/^[a-z0-9-]+$/i.test(fragmentName)) return null;
  const full = path.join(getRendererPagesDir(), `${fragmentName}.html`);
  const pagesDir = getRendererPagesDir();
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(pagesDir) + path.sep)) return null;
  return resolved;
}

// ── Create main window ─────────────────────────────────
let mainWin = null;
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,   // Keep this FALSE always
      backgroundThrottling: false,
    },
    show: false,                    // never show until fully painted
    backgroundColor: '#F0F2F7',    // matches --bg to prevent startup flash
    titleBarStyle: 'default',      // remove hiddenInset — it's macOS only
  });

  mainWin = win;

  win.loadFile(path.join(__dirname, '..', 'renderer', 'pages', 'index.html'));

  // Only show AFTER the page is fully rendered — no flash, no black spots
  win.once('ready-to-show', () => {
    win.show();
    win.maximize();
  });

  // Auto-lock on minimize
  win.on('minimize', () => {
    win.webContents.send('auth:lockApp');
  });

  win.webContents.on('render-process-gone', (event, details) => {
    if (details.reason !== 'clean-exit') win.reload();
  });
}

// ── AutoUpdater Configuration ──────────────────────────
autoUpdater.autoDownload = true; // Download updates silently in the background
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] Update not available. Current version is up to date.');
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Error in auto-updater:', err);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version);
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: `A new version (${info.version}) of DATAFLOW is downloaded and ready to install.`,
    buttons: ['Restart and Install Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// ── App lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  // Init all tables
  initStudentsTable();
  activityModel.initActivityTable();
  testModel.initTestsTable();
  documentModel.initDocumentsTable().catch(err => {
    console.error('Failed to initialize documents table:', err.message);
  });
  formsModel.initFormsTables().catch((err) => {
    console.error('Failed to initialize forms tables:', err.message);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[AutoUpdater] Failed to check for updates on startup:', err);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers: Students ─────────────────────────────

ipcMain.handle('student:add', async (event, data) => {
  return new Promise((resolve, reject) => {
    studentService.addStudent(data, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('student:getAll', async () => {
  return new Promise((resolve, reject) => {
    studentService.getAllStudents((err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

ipcMain.handle('student:getById', async (event, id) => {
  return new Promise((resolve, reject) => {
    studentService.getStudentById(id, (err, row) => {
      if (err) reject(err.message);
      else resolve(row);
    });
  });
});

ipcMain.handle('student:update', async (event, id, data) => {
  return new Promise((resolve, reject) => {
    studentService.updateStudent(id, data, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('student:delete', async (event, id) => {
  return new Promise((resolve, reject) => {
    studentService.deleteStudent(id, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('student:search', async (event, query) => {
  return new Promise((resolve, reject) => {
    studentService.searchStudents(query, (err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

ipcMain.handle('student:checkRoll', async (event, rollNumber, excludeId) => {
  return new Promise((resolve, reject) => {
    studentService.checkRollNumberExists(rollNumber, excludeId, (err, row) => {
      if (err) reject(err.message);
      else resolve(row);
    });
  });
});

// --- NEW IPC HANDLERS ---
// ── IPC Handlers: Tests ─────────────────────────────
ipcMain.handle('test:getAll', async () => {
  return new Promise((resolve, reject) => {
    testService.getAllTests((err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

ipcMain.handle('test:getById', async (event, id) => {
  return new Promise((resolve, reject) => {
    testService.getTestById(id, (err, row) => {
      if (err) reject(err.message);
      else resolve(row);
    });
  });
});

ipcMain.handle('test:create', async (event, data) => {
  return new Promise((resolve, reject) => {
    testService.createTest(data, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('test:update', async (event, id, data) => {
  return new Promise((resolve, reject) => {
    testService.updateTest(id, data, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('test:delete', async (event, id) => {
  return new Promise((resolve, reject) => {
    testService.deleteTest(id, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('test:deleteResult', async (event, id) => {
  return new Promise((resolve, reject) => {
    testService.deleteTestResult(id, (err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('test:publish', async (event, testId) => {
  return new Promise((resolve) => {
    testService.getTestById(testId, async (err, test) => {
      if (err) return resolve({ ok: false, error: err.message });
      if (!test.questions || test.questions.length === 0) {
        return resolve({ ok: false, error: 'Test has no questions. Add at least one question before publishing.' });
      }
      try {
        const result = await googleFormsService.publishTestAsForm(test);
        testModel.updateGoogleFormId(testId, result.formId, (err) => {
          if (err) console.error('Failed to save Google Form ID:', err);
        });
        resolve({ ok: true, url: result.responderUri });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });
});

ipcMain.handle('test:getGradesOverview', async () => {
  return new Promise((resolve, reject) => {
    testService.getGradesOverview((err, result) => {
      if (err) reject(err.message);
      else resolve(result);
    });
  });
});

ipcMain.handle('import:previewForm', async (event, { formId }) => {
  try {
    const studentModel = require('../backend/models/student-model');
    const studentsRes = await new Promise((resolve, reject) => {
      studentModel.getAllStudents((err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });

    const data = await googleFormsService.getFormResponses(formId);
    return { ...data, systemStudents: studentsRes };
  } catch (error) {
    console.error('previewForm error:', error);
    throw new Error(error.message || 'Unknown error occurred during form preview');
  }
});

ipcMain.handle('import:executeFormImport', async (event, { results }) => {
  return new Promise((resolve, reject) => {
    testService.executeFormImport(results, (err, res) => {
      if (err) reject(err.message);
      else resolve(res);
    });
  });
});

ipcMain.handle('import:previewSheet', async (event, { sheetId }) => {
  try {
    const courseModel = require('../backend/models/course-model');
    const courses = await courseModel.getAllCourses().catch(() => []);

    return await googleImportService.previewSheet(sheetId, courses);
  } catch (error) {
    console.error('previewSheet error:', error);
    throw new Error(error.message || 'Unknown error occurred during sheet preview');
  }
});

ipcMain.handle('import:executeImport', async (event, { rows }) => {
  try {
    return await googleImportService.executeImport(rows);
  } catch (error) {
    console.error('executeImport error:', error);
    throw new Error(error.message || 'Unknown error occurred during import');
  }
});

ipcMain.handle('student:updatePhoto', async (event, { studentId, photoPath }) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const studentModel = require('../backend/models/student-model');
    
    // Create student-photos directory if it doesn't exist
    const photosDir = path.join(DATA_PATH, 'student-photos');
    if (!fs.existsSync(photosDir)) {
      fs.mkdirSync(photosDir, { recursive: true });
    }

    // Determine extension and target path
    const ext = path.extname(photoPath) || '.jpg';
    const targetName = `${studentId.replace(/[^a-z0-9]/gi, '_')}${ext}`;
    const targetPath = path.join(photosDir, targetName);

    // Copy file
    fs.copyFileSync(photoPath, targetPath);

    // Update DB with the NEW path
    await studentModel.updateStudentPhoto(studentId, targetPath);
    
    return { success: true, photoPath: targetPath };
  } catch (error) {
    console.error('updatePhoto error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('dialog:openFile', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
      properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0];
  } catch (err) {
    console.error('dialog:openFile error:', err);
    return null;
  }
});

ipcMain.handle('dialog:openDocument', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      filters: [{ name: "All Files", extensions: ["*"] }],
      properties: ["openFile", "multiSelections"]
    });
    return result.canceled ? null : result.filePaths;
  } catch (err) {
    console.error('dialog:openDocument error:', err);
    return null;
  }
});

// ── IPC Handlers: Fees ─────────────────────────────
ipcMain.handle('fees:getAll', async () => {
  return new Promise((resolve, reject) => {
    feeModel.getAllFeesWithPayments((err, rows) => {
      if (err) reject(err.message); else resolve(rows);
    });
  });
});
ipcMain.handle('fees:getPayments', async (event, feeId) => {
  return new Promise((resolve, reject) => {
    feeModel.getPaymentsForFeeId(feeId, (err, rows) => {
      if (err) reject(err.message); else resolve(rows);
    });
  });
});
ipcMain.handle('fees:update', async (event, studentId, data) => {
  return new Promise((resolve, reject) => {
    feeModel.updateFeeRecord(studentId, data, (err, res) => {
      if (err) reject(err.message); else resolve(res);
    });
  });
});
ipcMain.handle('fees:addPayment', async (event, feeId, data) => {
  return new Promise((resolve, reject) => {
    feeService.addPayment(feeId, data, (err, res) => {
      if (err) reject(err.message); else resolve(res);
    });
  });
});
ipcMain.handle('fees:reducePayment', async (event, paymentId, amount) => {
  return new Promise((resolve, reject) => {
    feeModel.reducePayment(paymentId, amount, (err, res) => {
      if (err) reject(err.message); else resolve(res);
    });
  });
});
ipcMain.handle('fees:deletePayment', async (event, paymentId) => {
  return new Promise((resolve, reject) => {
    feeModel.deletePayment(paymentId, (err, res) => {
      if (err) reject(err.message); else resolve(res);
    });
  });
});

// ── IPC Handlers: Activity ────────────────────────────
ipcMain.handle('activity:getRecent', async () => {
  return new Promise((resolve, reject) => {
    activityModel.getRecentActivities(5, (err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

// ── IPC Handlers: Courses / Export ────────────────────
ipcMain.handle('courses:load', async () => {
  try {
    return await courseService.getAllCourses();
  } catch (err) {
    console.error('Failed to load courses from DB:', err);
    return [];
  }
});

ipcMain.handle('courses:save', async (_event, data) => {
  try {
    await courseService.bulkSaveCourses(data);
    return true;
  } catch (err) {
    console.error('Failed to save courses to DB:', err);
    return false;
  }
});

ipcMain.handle('export:json', async (_event, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Data as JSON',
    defaultPath: 'data.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export:html', async (_event, html) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Syllabus as HTML',
    defaultPath: 'syllabus.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, html, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open:path', (_event, targetPath) => {
  shell.openPath(targetPath);
  return true;
});
ipcMain.handle('shell:openExternal', (_event, url) => {
  shell.openExternal(url);
  return true;
});
ipcMain.handle('open:external', (_event, url) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle('export:pdf', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No valid window found' };

  try {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    });

    const title = options?.filename || 'Test';
    const safeTitle = title.replace(/[^a-z0-9 ]/gi, '').trim() || 'DataflowTest';

    // Show a native Save As dialog
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save PDF Document',
      defaultPath: path.join(app.getPath('downloads'), safeTitle + '.pdf'),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) {
      return { ok: false, error: 'Download canceled' };
    }

    fs.writeFileSync(filePath, data);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC Handlers: Fragment loader (router) ─────────────
ipcMain.handle('app:loadFragment', async (_event, fragmentName) => {
  const filePath = safeFragmentPath(String(fragmentName || ''));
  if (!filePath) throw new Error('Invalid fragment name');
  return fs.readFileSync(filePath, 'utf8');
});

// ── IPC Handlers: App lifecycle & state ───────────────────
ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.on('system:relaunch', () => {
  app.relaunch();
  app.exit();
});

// ── IPC Handlers: Slots ────────────────────────────────
ipcMain.handle('slots:getAll', () => { return []; });
ipcMain.handle('slots:add', (_event, slotData) => { return null; });
ipcMain.handle('slots:delete', (_event, id) => { return { ok: true, removed: 0 }; });

// ── IPC Handlers: Slot Data (Rich JSON) ───────────────────
ipcMain.handle('data:load', async () => {
  try {
    return await slotModel.getSlotData();
  } catch (err) {
    console.error('Failed to load rich slot data from DB:', err.message);
    return null;
  }
});

ipcMain.handle('data:save', async (_event, data) => {
  try {
    return await slotModel.saveSlotData(data);
  } catch (err) {
    console.error('Failed to save rich slot data to DB:', err.message);
    return false;
  }
});

ipcMain.handle('data:export', async (_event, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Slots as JSON',
    defaultPath: 'slots-data.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
});

// ── IPC Handlers: Backup & Restore ────────────────────

ipcMain.handle('backup:create', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save DATAFLOW Backup',
    defaultPath: `DATAFLOW_backup_${new Date().toISOString().slice(0, 10)}.dataflow`,
    filters: [{ name: 'DATAFLOW Backup', extensions: ['dataflow'] }],
  });
  if (canceled || !filePath) return { ok: false };

  try {
    // Robust DB path logic consistent with db.js
    const dbPath = path.join(DATA_PATH, 'database.db');
    if (!fs.existsSync(dbPath)) {
      return { ok: false, error: 'Database file not found at ' + dbPath };
    }

    const dbBuffer = fs.readFileSync(dbPath);

    const backup = {
      system: 'DATAFLOW',
      version: '1.0',
      backup_date: new Date().toISOString(),
      database_b64: dbBuffer.toString('base64'),
    };

    fs.writeFileSync(filePath, JSON.stringify(backup), 'utf8');

    // Log this activity
    activityModel.logActivity(
      'system',
      'Backup Created',
      `Data backed up to: ${path.basename(filePath)}`,
      'database'
    );

    return { ok: true, filePath };
  } catch (err) {
    console.error('Backup Error:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:restore', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open DATAFLOW Backup',
    filters: [{ name: 'DATAFLOW Backup', extensions: ['dataflow'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { ok: false };

  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const backup = JSON.parse(raw);

    if (backup.system !== 'DATAFLOW') {
      return { ok: false, error: 'invalid_file' };
    }

    const dbPath = path.join(DATA_PATH, 'database.db');
    // Write the restored DB file
    const dbBuffer = Buffer.from(backup.database_b64, 'base64');
    fs.writeFileSync(dbPath, dbBuffer);

    // Log this activity
    activityModel.logActivity(
      'system',
      'Data Restored',
      'System data restored from backup file',
      'refresh'
    );

    return { ok: true, backup_date: backup.backup_date };
  } catch (err) {
    console.error('Restore Error:', err);
    return { ok: false, error: err.message };
  }
});

// ── IPC Handlers: Google Drive ────────────────────

ipcMain.handle('google:getToken', async () => {
  const token = await googleService.getValidAccessToken();
  return token;
});

ipcMain.handle('google:getDriveFiles', async () => {
  return await googleService.getDriveFiles();
});

ipcMain.handle('google:getConfig', () => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const appId = clientId.split('-')[0] || '';
  return {
    apiKey: process.env.GOOGLE_API_KEY ?? '',
    appId: appId
  };
});

ipcMain.handle('google:getStatus', async () => {
  try {
    return await googleService.getStatus();
  } catch (err) {
    return { connected: false, error: err.message };
  }
});
ipcMain.handle('google:connect', async () => {
  try {
    return await googleService.connect();
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('google:disconnect', async () => {
  try {
    return await googleService.disconnect();
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── GitHub Sync ────────────────────
ipcMain.handle('student:syncGithub', async () => {
  const GITHUB_PAT = process.env.GITHUB_PAT;
  const REPO = 'Syed-Saquib11/Dataflow';

  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Student-Management-System-App'
    };

    // Only add Authorization header if it's not the placeholder and is defined
    if (GITHUB_PAT && GITHUB_PAT !== 'your_personal_access_token_here') {
      headers['Authorization'] = `token ${GITHUB_PAT}`;
    }

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}`,
      method: 'GET',
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200) {
            // Log this as an activity
            activityModel.logActivity(
              'system',
              'GitHub Sync',
              `Fetched metadata for ${REPO} (Stars: ${json.stargazers_count})`,
              'refresh'
            );
            resolve({ success: true, metadata: json });
          } else {
            resolve({ success: false, error: json.message || 'GitHub API error' });
          }
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse GitHub response' });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });

    req.end();
  });
});

// ── IPC Handlers: Forms & Documents ────────────────────
// Resolve data folder (works from USB too)
const dataDir = DATA_PATH;
const templatesDir = path.join(DATA_PATH, 'templates');
const documentsDir = path.join(DATA_PATH, 'documents');
let docsWatcherStarted = false;

// Make sure documents folder exists on startup
if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });

function emitDocumentsChanged() {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('forms:documentsChanged');
  });
}

function startDocumentsWatcher() {
  if (docsWatcherStarted) return;
  docsWatcherStarted = true;
  try {
    fs.watch(documentsDir, () => {
      emitDocumentsChanged();
    });
  } catch (err) {
    console.error('Unable to watch documents directory:', err.message);
  }
}
startDocumentsWatcher();

ipcMain.handle('forms:openTemplate', (event, filename) => {
  const filePath = path.join(templatesDir, filename);
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Template file not found: ' + filePath };
  }
  shell.openPath(filePath);
  return { success: true };
});

ipcMain.handle('forms:getTemplates', () => {
  if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
  return fs.readdirSync(templatesDir)
    .filter(name => (name.toLowerCase().endsWith('.docx') || name.toLowerCase().endsWith('.doc')) && !name.startsWith('~$'))
    .map(name => {
      const filePath = path.join(templatesDir, name);
      const stat = fs.statSync(filePath);
      return { name, size: stat.size, addedAt: stat.birthtime };
    }).sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
});

ipcMain.handle('forms:addTemplate', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Word Documents', extensions: ['docx', 'doc'] }]
  });
  if (canceled || !filePaths.length) return { success: false };
  let copiedCount = 0;
  for (const src of filePaths) {
    const dest = path.join(templatesDir, path.basename(src));
    fs.copyFileSync(src, dest);
    copiedCount++;
  }
  emitDocumentsChanged();
  return { success: true, count: copiedCount };
});

ipcMain.handle('forms:deleteTemplate', (event, filename) => {
  const filePath = path.join(templatesDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  emitDocumentsChanged();
  return { success: true };
});

ipcMain.handle('forms:getDocuments', () => {
  if (!fs.existsSync(documentsDir)) return [];
  return fs.readdirSync(documentsDir).map(name => {
    const filePath = path.join(documentsDir, name);
    const stat = fs.statSync(filePath);
    return { name, size: stat.size, addedAt: stat.birthtime };
  }).sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
});

ipcMain.handle('forms:addDocument', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });
  if (canceled || !filePaths.length) return { success: false };
  const src = filePaths[0];
  const dest = path.join(documentsDir, path.basename(src));
  fs.copyFileSync(src, dest);
  emitDocumentsChanged();
  return { success: true };
});

ipcMain.handle('forms:addDocumentByPath', async (_event, sourcePath) => {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { success: false, error: 'Selected file does not exist.' };
    }
    const destination = path.join(documentsDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, destination);
    emitDocumentsChanged();
    return { success: true, fileName: path.basename(sourcePath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('forms:openDocument', (event, filename) => {
  const filePath = path.join(documentsDir, filename);
  shell.openPath(filePath);
  return { success: true };
});

ipcMain.handle('forms:deleteDocument', (event, filename) => {
  const filePath = path.join(documentsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  emitDocumentsChanged();
  return { success: true };
});

ipcMain.handle('forms:getFormsOverview', async () => {
  try {
    const forms = await formsModel.getFormsWithSubmissions();
    return { success: true, forms };
  } catch (err) {
    return { success: false, error: err.message, forms: [] };
  }
});

// ── NEW DATAFLOW DOCUMENTS & DRIVE IPC ────────────────
ipcMain.handle('document:getAll', async () => {
  return new Promise((resolve, reject) => {
    documentService.getAllDocuments((err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

ipcMain.handle('document:add', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });
  if (canceled || !filePaths.length) return { success: false, canceled: true };

  return new Promise((resolve) => {
    documentService.addDocument(filePaths[0], (err, newDoc) => {
      if (err) resolve({ success: false, error: err.message });
      else {
        emitDocumentsChanged();
        resolve({ success: true, document: newDoc });
      }
    });
  });
});

ipcMain.handle('document:delete', async (event, id) => {
  return new Promise((resolve) => {
    documentService.deleteDocument(id, (err) => {
      if (err) resolve({ success: false, error: err.message });
      else {
        emitDocumentsChanged();
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('document:search', async (event, query) => {
  return new Promise((resolve, reject) => {
    documentService.searchDocuments(query, (err, rows) => {
      if (err) reject(err.message);
      else resolve(rows);
    });
  });
});

ipcMain.handle('drive:listFiles', async () => {
  try {
    const files = await googleDriveService.listDataflowFiles();
    emitDocumentsChanged();
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:uploadFile', async (event, filePath, fileName, mimeType, userEmail) => {
  try {
    const entry = await googleDriveService.uploadToDataflow(filePath, fileName, mimeType, userEmail);
    emitDocumentsChanged();
    return { success: true, entry };
  } catch (err) {
    emitDocumentsChanged();
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:uploadAdmissionForm', async (event, base64Data, fileName) => {
  console.log('[drive:uploadAdmissionForm] Called. fileName:', fileName, '| base64 length:', (base64Data || '').length);
  try {
    const entry = await googleDriveService.uploadBase64Pdf(base64Data, fileName, 'Admission Forms');
    console.log('[drive:uploadAdmissionForm] SUCCESS:', JSON.stringify(entry));
    return { success: true, entry };
  } catch (err) {
    console.error('[drive:uploadAdmissionForm] FAILED:', err.message);
    console.error('[drive:uploadAdmissionForm] Stack:', err.stack);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:uploadIDCard', async (event, base64Data, fileName) => {
  console.log('[drive:uploadIDCard] Called. fileName:', fileName, '| base64 length:', (base64Data || '').length);
  try {
    const entry = await googleDriveService.uploadBase64Pdf(base64Data, fileName, 'ID cards');
    console.log('[drive:uploadIDCard] SUCCESS:', JSON.stringify(entry));
    return { success: true, entry };
  } catch (err) {
    console.error('[drive:uploadIDCard] FAILED:', err.message);
    console.error('[drive:uploadIDCard] Stack:', err.stack);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:deleteFile', async (event, driveFileId) => {
  try {
    await googleDriveService.deleteFromDataflow(driveFileId);
    emitDocumentsChanged();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:uploadPending', async () => {
  try {
    const result = await driveUploadService.uploadPending();
    emitDocumentsChanged();
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive:getStatus', async () => {
  try {
    const googleStatus = await googleService.getStatus();
    if (!googleStatus.connected) {
      return { connected: false, pendingCount: 0 };
    }
    return new Promise((resolve) => {
      documentService.getPendingDocuments((err, docs) => {
        if (err) resolve({ connected: true, pendingCount: 0, error: err.message });
        else resolve({ connected: true, pendingCount: docs.length });
      });
    });
  } catch (err) {
    return { connected: false, error: err.message, pendingCount: 0 };
  }
});

ipcMain.handle('forms:deleteForm', async (_event, id) => {
  try {
    const result = await formsModel.deleteForm(id);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('forms:getDashboardStats', async () => {
  try {
    const docs = fs.existsSync(documentsDir) ? fs.readdirSync(documentsDir) : [];
    const today = new Date().toISOString().split('T')[0];
    const stats = await formsModel.getStats(today, docs.length);
    return {
      success: true,
      ...stats,
      documentsUploaded: docs.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC Handlers: Auth (Hybrid) ───────────────────────
ipcMain.handle('auth:isSetup', async () => {
  return authService.isSetup();
});

ipcMain.handle('auth:setupPassword', async (_event, password, adminName) => {
  return authService.setupPassword(password, adminName);
});

ipcMain.handle('auth:getAdminName', async () => {
  return authService.getAdminName();
});

// ── IPC Handlers: System ──────────────────────────────
ipcMain.handle('system:openExternal', async (_event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('auth:verifyPassword', async (_event, password) => {
  return authService.verifyPassword(password);
});

ipcMain.handle('auth:changePassword', async (_event, oldPw, newPw) => {
  return authService.changePassword(oldPw, newPw);
});

ipcMain.handle('auth:sendResetOTP', async (_event, email) => {
  return await authService.sendResetOTP(email);
});

ipcMain.handle('auth:verifyResetOTP', async (_event, code) => {
  return authService.verifyResetOTP(code);
});

ipcMain.handle('auth:resetPasswordWithOTP', async (_event, code, newPw) => {
  return authService.resetPasswordWithOTP(code, newPw);
});

ipcMain.handle('auth:getRegisteredEmail', async () => {
  return authService.getRegisteredEmail();
});

ipcMain.handle('auth:setRegisteredEmail', async (_event, email) => {
  return authService.setRegisteredEmail(email);
});

ipcMain.handle('auth:getEmailJSConfig', async () => {
  return authService.getEmailJSConfig();
});

ipcMain.handle('auth:setEmailJSConfig', async (_event, config) => {
  return authService.setEmailJSConfig(config);
});

ipcMain.handle('auth:sendTestOTP', async () => {
  return await authService.sendTestOTP();
});

ipcMain.handle('auth:clearSession', async () => {
  authService.clearSession();
  return { success: true };
});

