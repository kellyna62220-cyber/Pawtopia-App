// Pawtopia pour ordinateur : une fenêtre qui ouvre le site (toujours à jour, rien à re-télécharger).
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('path');

const SITE = 'https://pawtopia-adoptme.onrender.com';
const HOST = new URL(SITE).host;

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win;
function create() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#120d33', title: 'Pawtopia',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  let tries = 0;
  const load = () => win.loadURL(SITE);
  // Le serveur gratuit peut mettre ~30 s à se réveiller : on réessaie avant d'afficher l'erreur.
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (!isMain || code === -3) return;
    if (tries++ < 3) setTimeout(load, 4000);
    else win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.webContents.on('did-finish-load', () => { if (win.webContents.getURL().startsWith(SITE)) tries = 0; });

  // Les liens vers d'autres sites s'ouvrent dans le navigateur, pas dans l'appli.
  const external = url => { try { return new URL(url).host !== HOST; } catch { return false; } };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    if (external(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  load();
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create(); });
