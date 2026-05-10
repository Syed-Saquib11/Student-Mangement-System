// ═══════════════════════════════════════════════════════════
//  PRELOAD.JS — Secure IPC Bridge
//  Exposes window.api (and window.electronAPI) to the renderer.
//  renderer → preload → main → services → models → SQLite
// ═══════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

const bridge = {
  // ── BACKUP & RESTORE ──────────────────────────────────
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),

  // ── STUDENTS ──────────────────────────────────────────────
  getAllStudents: () => ipcRenderer.invoke('student:getAll'),
  getStudentById: (id) => ipcRenderer.invoke('student:getById', id),
  addStudent: (data) => ipcRenderer.invoke('student:add', data),
  updateStudent: (id, data) => ipcRenderer.invoke('student:update', id, data),
  deleteStudent: (id) => ipcRenderer.invoke('student:delete', id),
  searchStudents: (query) => ipcRenderer.invoke('student:search', query),
  checkRollNumber: (roll, excludeId) => ipcRenderer.invoke('student:checkRoll', roll, excludeId),

  // ── FEES ──────────────────────────────────────────────
  getFees: () => ipcRenderer.invoke('fees:getAll'),
  getFeePayments: (feeId) => ipcRenderer.invoke('fees:getPayments', feeId),
  updateFee: (studentId, data) => ipcRenderer.invoke('fees:update', studentId, data),
  addPayment: (feeId, data) => ipcRenderer.invoke('fees:addPayment', feeId, data),
  deletePayment: (paymentId) => ipcRenderer.invoke('fees:deletePayment', paymentId),

  // ── TESTS ─────────────────────────────────────────────
  getAllTests: () => ipcRenderer.invoke('test:getAll'),
  getTestById: (id) => ipcRenderer.invoke('test:getById', id),
  createTest: (data) => ipcRenderer.invoke('test:create', data),
  updateTest: (id, data) => ipcRenderer.invoke('test:update', id, data),
  deleteTest: (id) => ipcRenderer.invoke('test:delete', id),
  deleteTestResult: (id) => ipcRenderer.invoke('test:deleteResult', id),
  publishTest: (testId) => ipcRenderer.invoke('test:publish', testId),
  getGradesOverview: () => ipcRenderer.invoke('test:getGradesOverview'),
  // ── ACTIVITY ──────────────────────────────────────────────
  getRecentActivities: () => ipcRenderer.invoke('activity:getRecent'),

  // ── COURSES ───────────────────────────────────────────────
  // Keep both names for compatibility with different modules.
  getCourses: () => ipcRenderer.invoke('courses:load'),
  loadCourses: () => ipcRenderer.invoke('courses:load'),
  saveCourses: (data) => ipcRenderer.invoke('courses:save', data),

  // ── SLOTS (SQLite — time/label list for dropdowns) ────────
  getSlots: () => ipcRenderer.invoke('slots:getAll'),
  addSlot: (data) => ipcRenderer.invoke('slots:add', data),
  deleteSlot: (id) => ipcRenderer.invoke('slots:delete', id),

  // ── SLOT SCHEDULE DATA (JSON file — day/student matrix) ───
  // The slot management page stores rich per-day scheduling
  // state (slots + enrollments per day) as a JSON file.
  loadSlotData: () => ipcRenderer.invoke('data:load'),
  saveSlotData: (data) => ipcRenderer.invoke('data:save', data),
  exportSlotData: (data) => ipcRenderer.invoke('data:export', data),

  // ── EXPORT (native dialogs & desktop) ──────────────────────
  exportJSON: (data) => ipcRenderer.invoke('export:json', data),
  exportHTML: (html) => ipcRenderer.invoke('export:html', html),
  exportPDF: (options) => ipcRenderer.invoke('export:pdf', options),
  openPath: (p) => ipcRenderer.invoke('open:path', p),

  // ── MENU EVENTS (main → renderer) ─────────────────────────
  onMenuAdd: (cb) => ipcRenderer.on('menu:add', cb),
  onMenuExportJSON: (cb) => ipcRenderer.on('menu:exportJSON', cb),
  onMenuExportHTML: (cb) => ipcRenderer.on('menu:exportHTML', cb),

  // ── ROUTING ───────────────────────────────────────────────
  loadFragment: (name) => ipcRenderer.invoke('app:loadFragment', name),
  // ── SHELL ─────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  googleGetToken:  () => ipcRenderer.invoke('google:getToken'),
  googleGetDriveFiles: () => ipcRenderer.invoke('google:getDriveFiles'),
  getGoogleConfig: () => ipcRenderer.invoke('google:getConfig'),
  googleGetStatus: () => ipcRenderer.invoke('google:getStatus'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),

  // --- Google Sheet / Form Import Additions ---
  importPreviewSheet: (sheetId) => ipcRenderer.invoke('import:previewSheet', { sheetId }),
  importExecute: (rows) => ipcRenderer.invoke('import:executeImport', { rows }),
  importPreviewForm: (formId) => ipcRenderer.invoke('import:previewForm', { formId }),
  importExecuteForm: (results) => ipcRenderer.invoke('import:executeFormImport', { results }),
  updateStudentPhoto: (studentId, photoPath) => ipcRenderer.invoke('student:updatePhoto', { studentId, photoPath }),
  syncFromGithub: () => ipcRenderer.invoke('student:syncGithub'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openAnyFileDialog: () => ipcRenderer.invoke('dialog:openDocument'),

  // ── FORMS & DOCUMENTS ──────────────────────────────
  openTemplate: (filename) => ipcRenderer.invoke('forms:openTemplate', filename),
  getTemplates: () => ipcRenderer.invoke('forms:getTemplates'),
  addTemplate: () => ipcRenderer.invoke('forms:addTemplate'),
  deleteTemplate: (filename) => ipcRenderer.invoke('forms:deleteTemplate', filename),
  
  // Documents
  getAllDocuments: () => ipcRenderer.invoke('document:getAll'),
  addDocument: () => ipcRenderer.invoke('document:add'),
  deleteDocument: (id) => ipcRenderer.invoke('document:delete', id),
  searchDocuments: (q) => ipcRenderer.invoke('document:search', q),
  
  // Drive
  listDriveFiles: () => ipcRenderer.invoke('drive:listFiles'),
  uploadDriveFile: (filePath, fileName, mimeType, userEmail) => ipcRenderer.invoke('drive:uploadFile', filePath, fileName, mimeType, userEmail),
  uploadAdmissionForm: (base64Data, fileName) => ipcRenderer.invoke('drive:uploadAdmissionForm', base64Data, fileName),
  uploadIDCard: (base64Data, fileName) => ipcRenderer.invoke('drive:uploadIDCard', base64Data, fileName),
  deleteDriveFile: (driveFileId) => ipcRenderer.invoke('drive:deleteFile', driveFileId),
  driveGetStatus: () => ipcRenderer.invoke('drive:getStatus'),
  
  getDocuments: () => ipcRenderer.invoke('forms:getDocuments'),
  addDocumentByPath: (sourcePath) => ipcRenderer.invoke('forms:addDocumentByPath', sourcePath),
  openDocument: (filename) => ipcRenderer.invoke('forms:openDocument', filename),
  getFormsOverview: () => ipcRenderer.invoke('forms:getFormsOverview'),
  deleteForm: (id) => ipcRenderer.invoke('forms:deleteForm', id),
  getFormsDashboardStats: () => ipcRenderer.invoke('forms:getDashboardStats'),
  onFormsDocumentsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('forms:documentsChanged', handler);
    return () => ipcRenderer.removeListener('forms:documentsChanged', handler);
  },
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ── AUTH (Hybrid) ─────────────────────────────────────
  authIsSetup:              () => ipcRenderer.invoke('auth:isSetup'),
  authSetupPassword:        (pw, adminName) => ipcRenderer.invoke('auth:setupPassword', pw, adminName),
  authGetAdminName:         () => ipcRenderer.invoke('auth:getAdminName'),
  authVerifyPassword:       (pw) => ipcRenderer.invoke('auth:verifyPassword', pw),
  authChangePassword:       (oldPw, newPw) => ipcRenderer.invoke('auth:changePassword', oldPw, newPw),
  
  authSendResetOTP:         (email) => ipcRenderer.invoke('auth:sendResetOTP', email),
  authVerifyResetOTP:       (code) => ipcRenderer.invoke('auth:verifyResetOTP', code),
  authResetPasswordWithOTP: (code, newPw) => ipcRenderer.invoke('auth:resetPasswordWithOTP', code, newPw),
  
  authGetRegisteredEmail:   () => ipcRenderer.invoke('auth:getRegisteredEmail'),
  authSetRegisteredEmail:   (email) => ipcRenderer.invoke('auth:setRegisteredEmail', email),
  authGetEmailJSConfig:     () => ipcRenderer.invoke('auth:getEmailJSConfig'),
  authSetEmailJSConfig:     (cfg) => ipcRenderer.invoke('auth:setEmailJSConfig', cfg),
  authSendTestOTP:          () => ipcRenderer.invoke('auth:sendTestOTP'),
  
  authClearSession:         () => ipcRenderer.invoke('auth:clearSession'),
  
  onLockApp:                (cb) => {
    const handler = () => cb();
    ipcRenderer.on('auth:lockApp', handler);
    return () => ipcRenderer.removeListener('auth:lockApp', handler);
  }
};

// Keep both names for compatibility across renderer pages.
contextBridge.exposeInMainWorld('api', bridge);
contextBridge.exposeInMainWorld('electronAPI', bridge);