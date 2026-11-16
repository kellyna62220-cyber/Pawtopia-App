// Dit au site qu'il tourne dans l'appli pour ordinateur, et relie la bannière de mise à jour.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pawtopiaDesktop', {
  app: true, platform: process.platform,
  pendingUpdate: () => ipcRenderer.invoke('upd:pending'),
  startUpdate: () => ipcRenderer.invoke('upd:start'),
  onUpdate: cb => ipcRenderer.on('upd:state', (_e, s) => cb(s))
});
