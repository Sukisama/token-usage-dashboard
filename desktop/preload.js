const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbAPI', {
  moveBy: (dx, dy) => ipcRenderer.send('orb:move-by', { dx, dy }),
  togglePanel: () => ipcRenderer.send('orb:toggle-panel'),
  openDashboard: () => ipcRenderer.send('panel:open-dashboard'),
  closePanel: () => ipcRenderer.send('panel:close'),
  quit: () => ipcRenderer.send('app:quit'),
  port: () => ipcRenderer.invoke('app:port'),
  onRefresh: (cb) => ipcRenderer.on('panel:refresh', cb)
});
