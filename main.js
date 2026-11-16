// Pawtopia pour ordinateur : une fenêtre qui ouvre le site (toujours à jour, rien à re-télécharger).
const { app, BrowserWindow, shell, Menu, nativeTheme, Tray, Notification, nativeImage, net, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE = 'https://pawtopia-adoptme.onrender.com';
const HOST = new URL(SITE).host;

if (!app.requestSingleInstanceLock()) { app.quit(); }

// Lien pawtopia://auth?code=… : renvoie dans l'appli après une connexion faite dans le navigateur
// (Google refuse la connexion dans une fenêtre intégrée).
const PROTO = 'pawtopia';
if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTO, process.execPath, [path.resolve(process.argv[1])]); }
else app.setAsDefaultProtocolClient(PROTO);
let pendingUrl = null;
function handleUrl(u) {
  try {
    const x = new URL(u); if (x.protocol !== PROTO + ':') return;
    const code = x.searchParams.get('code');
    if (!/^[a-f0-9]{16,100}$/.test(code || '')) return;
    if (!win) { pendingUrl = u; return; }
    win.loadURL(SITE + '/auth/desktop?code=' + code); if (win.isMinimized()) win.restore(); win.show(); win.focus();
  } catch { }
}
app.on('open-url', (e, u) => { e.preventDefault(); handleUrl(u); });
const isAuthUrl = url => { try { const x = new URL(url); return x.host === HOST && /^\/auth\/(google|discord|roblox)/.test(x.pathname); } catch { return false; } };
const loginInBrowser = () => shell.openExternal(SITE + '/#/desktoplink');

let win, tray, quitting = false;
const ICON = path.join(__dirname, 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');
app.setAppUserModelId('fr.pawtopia.app');   // nécessaire pour les notifications Windows

function showWin(link) {
  if (!win) return create();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (link) win.loadURL(SITE + '/' + String(link).replace(/^\//, ''));
}
// Icône à côté de l'horloge : fermer la fenêtre ne coupe pas l'appli, pour continuer à recevoir les notifications.
function makeTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('Pawtopia');
    const build = () => Menu.buildFromTemplate([
      { label: 'Ouvrir Pawtopia', click: () => showWin() },
      { label: 'Lancer au démarrage de l\'ordinateur', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => { app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }); } },
      { type: 'separator' },
      { label: 'Quitter', click: () => { quitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(build());
    tray.on('click', () => showWin());
  } catch { }
}
// Notifications : on interroge le site toutes les 45 s (les notifications « push » du navigateur ne marchent pas dans une appli).
let lastId = null, lastUnread = null;
async function api(p) {
  const r = await net.fetch(SITE + p, { session: session.defaultSession, credentials: 'include', headers: { 'X-Requested-With': 'pawtopia' } });
  if (!r.ok) return null; return r.json();
}
function toast(title, body, link) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: false });   // silent:false = son de notification du système
  n.on('click', () => showWin(link)); n.show();
}
async function poll() {
  try {
    const nf = await api('/api/notifs'), me = await api('/api/me');
    if (!nf || !me || !me.user) { lastId = null; lastUnread = null; return; }      // pas connecté
    const items = nf.items || [], maxId = items.reduce((m, i) => Math.max(m, i.id), 0);
    const unread = me.unread || 0;
    const quiet = win && win.isVisible() && win.isFocused();                       // la fenêtre est au premier plan : inutile de notifier
    if (lastId !== null && !quiet) {
      const fresh = items.filter(i => i.id > lastId && !i.seen).reverse();
      fresh.slice(0, 3).forEach(i => toast('Pawtopia', i.text, i.link));
      if (fresh.length > 3) toast('Pawtopia', '+ ' + (fresh.length - 3) + ' autres notifications', '#/notifs');
      if (unread > (lastUnread || 0)) toast('✉️ Nouveau message', 'Tu as ' + unread + ' message(s) non lu(s).', '#/messages');
    }
    lastId = maxId; lastUnread = unread;
  } catch { }
}


// ---------- Mises à jour de l'appli : bannière en haut « Mettre à jour maintenant » ----------
const RELEASES = 'https://github.com/kellyna62220-cyber/Pawtopia-App/releases/latest';
// Mac (appli non signée) et Linux .deb ne peuvent pas se mettre à jour seuls : le bouton ouvre la page de téléchargement.
const MANUAL_UPDATE = process.platform === 'darwin' || (process.platform === 'linux' && !process.env.APPIMAGE);
let upd = null, autoUpdater = null;                    // upd = { version, state: 'available' | 'downloading', pct }
const pushUpd = () => { if (win && !win.isDestroyed()) win.webContents.send('upd:state', upd); };
ipcMain.handle('upd:pending', () => upd && { ...upd, manual: MANUAL_UPDATE });
ipcMain.handle('upd:start', async () => {
  if (!upd) return;
  if (MANUAL_UPDATE || !autoUpdater) { shell.openExternal(RELEASES); return; }
  upd = { ...upd, state: 'downloading', pct: 0 }; pushUpd();
  try { await autoUpdater.downloadUpdate(); } catch { upd = { ...upd, state: 'available' }; pushUpd(); shell.openExternal(RELEASES); }
});
function setupUpdates() {
  if (process.env.PAWTOPIA_FAKE_UPDATE) { upd = { version: 'v9.9.9', state: 'available' }; return; }   // test d'affichage
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', i => { upd = { version: 'v' + i.version, state: 'available' }; pushUpd(); });
    autoUpdater.on('download-progress', p => { upd = { ...upd, state: 'downloading', pct: Math.round(p.percent || 0) }; pushUpd(); });
    autoUpdater.on('update-downloaded', () => { quitting = true; autoUpdater.quitAndInstall(false, true); });
    autoUpdater.on('error', () => { });
    const check = () => autoUpdater.checkForUpdates().catch(() => { });
    setTimeout(check, 20000); setInterval(check, 3 * 3600 * 1000);
  } catch { }
}
const BANNER_JS = `(() => { if (!window.pawtopiaDesktop || window.__updB) return; window.__updB = 1;
  const bar = document.createElement('div'); bar.style.cssText = 'display:none;position:relative;z-index:99999;padding:9px 14px;text-align:center;font:700 14px system-ui,Segoe UI,sans-serif;color:#fff;background:linear-gradient(135deg,#ff5fb0,#6c7bff)';
  const t = document.createElement('span'), b = document.createElement('button');
  b.style.cssText = 'margin-left:12px;border:0;border-radius:999px;padding:6px 16px;font:800 13px system-ui,Segoe UI,sans-serif;cursor:pointer;background:#fff;color:#4b3bd6';
  bar.append(t, b); document.body.prepend(bar);
  const show = s => { if (!s) { bar.style.display = 'none'; return; } bar.style.display = 'block';
    if (s.state === 'downloading') { t.textContent = '⬇️ Téléchargement de la mise à jour… ' + (s.pct || 0) + ' %'; b.style.display = 'none'; }
    else { t.textContent = '🆕 Nouvelle version de Pawtopia disponible (' + s.version + ')'; b.style.display = ''; b.textContent = s.manual ? 'Télécharger la mise à jour' : 'Mettre à jour maintenant'; } };
  b.onclick = () => window.pawtopiaDesktop.startUpdate();
  window.pawtopiaDesktop.onUpdate(s => show(s && { ...s, manual: ${MANUAL_UPDATE} })); window.pawtopiaDesktop.pendingUpdate().then(show); })();`;

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
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('close', e => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });

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
    if (isAuthUrl(url)) { loginInBrowser(); return { action: 'deny' }; }
    if (external(url)) { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    if (isAuthUrl(url)) { e.preventDefault(); loginInBrowser(); return; }
    if (external(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('did-finish-load', () => { if (win.webContents.getURL().startsWith(SITE)) win.webContents.executeJavaScript(BANNER_JS).catch(() => { }); });
  load();
  const first = process.argv.find(a => a.startsWith(PROTO + '://')) || pendingUrl; if (first) { pendingUrl = null; win.webContents.once('did-finish-load', () => handleUrl(first)); }
}

app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } const u = argv.find(a => a.startsWith(PROTO + '://')); if (u) handleUrl(u); });
app.whenReady().then(() => {
  create(); makeTray();
  // 1er lancement : démarrage automatique activé (désactivable dans le menu de l'icône à côté de l'horloge)
  try { const f = path.join(app.getPath('userData'), 'first-run.json'); if (!fs.existsSync(f)) { fs.writeFileSync(f, '1'); app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); } } catch { }
  setTimeout(poll, 15000); setInterval(poll, 45000);
  setupUpdates();
  if (process.env.PAWTOPIA_SHOT) setTimeout(async () => { try { fs.writeFileSync(process.env.PAWTOPIA_SHOT, (await win.webContents.capturePage()).toPNG()); } catch { } app.exit(0); }, 14000);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('activate', () => showWin());
