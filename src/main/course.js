// ═══════════════════════════════════════════════════
//  DATAFLOW — Electron Main Process
// ═══════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Persistent storage path ───
const COURSES_FILE = path.join(app.getPath('userData'), 'dataflow-courses.json');

function loadCourses() {
  try {
    if (fs.existsSync(COURSES_FILE))
      return JSON.parse(fs.readFileSync(COURSES_FILE, 'utf8'));
  } catch (e) { console.error('Load error:', e); }
  return [];
}

function saveCourses(data) {
  try { fs.writeFileSync(COURSES_FILE, JSON.stringify(data, null, 2), 'utf8'); return true; }
  catch (e) { console.error('Save error:', e); return false; }
}

// ─── Window ───
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',   // native inset on macOS; full frame on Win/Linux
    backgroundColor: '#f0f2f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => { win.show(); win.focus(); });

  if (process.argv.includes('--dev'))
    win.webContents.openDevTools({ mode: 'detach' });

  // ── IPC: data ──
  ipcMain.handle('courses:load', () => loadCourses());
  ipcMain.handle('courses:save', (_e, d) => saveCourses(d));

  // ── IPC: export ──
  ipcMain.handle('export:json', async (_e, data) => {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export Courses as JSON',
      defaultPath: 'csm-courses.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false };
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); return { ok: true, path: filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('export:html', async (_e, html) => {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export Syllabus as HTML',
      defaultPath: 'csm-syllabus.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { ok: false };
    try { fs.writeFileSync(filePath, html, 'utf8'); return { ok: true, path: filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('open:path', (_e, p) => { shell.showItemInFolder(p); return true; });

  // ── Menu ──
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Add New Course', accelerator: 'CmdOrCtrl+N', click: () => win.webContents.send('menu:add') },
        { type: 'separator' },
        { label: 'Export JSON', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('menu:exportJSON') },
        { label: 'Export HTML', accelerator: 'CmdOrCtrl+Shift+E', click: () => win.webContents.send('menu:exportHTML') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ]
    },
  ]));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
