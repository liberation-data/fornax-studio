// preload.cjs: what the desktop app lends the studio's page: which system it is on, and a way to show a file the studio
// made (an image, a song) in the system's file manager. Nothing else crosses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioNative', {
  platform: process.platform,
  showFile: file => ipcRenderer.send('studio:show-file', file),
});
