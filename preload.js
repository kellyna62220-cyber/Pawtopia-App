// Dit au site qu'il tourne dans l'appli pour ordinateur (ex. cacher le bouton « Installer »).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('pawtopiaDesktop', { app: true, platform: process.platform });
