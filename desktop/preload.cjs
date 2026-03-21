const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guardclawDesktop', {
  platform: process.platform,
  isDesktop: true,
  openDetailedApp: () => ipcRenderer.send('guardclaw:open-detailed-app'),
});
