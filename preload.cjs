// preload.cjs: what the desktop app lends the studio's page: which system it is on, a way to show a file the studio made
// (an image, a song) in the system's file manager, and setting the Hugging Face token. Nothing else crosses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioNative', {
  platform: process.platform,
  showFile: file => ipcRenderer.send('studio:show-file', file),
  // The Hugging Face token for gated models: the page can set or clear it, and learn whether one is kept, never read it.
  hubToken: () => ipcRenderer.invoke('studio:hub-token'),
  saveHubToken: token => ipcRenderer.invoke('studio:hub-token-save', token),
});
