const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbAPI', {
  moveBy: (dx, dy) => ipcRenderer.send('orb:move-by', { dx, dy }),
  togglePanel: () => ipcRenderer.send('orb:toggle-panel'),
  openDashboard: () => ipcRenderer.send('panel:open-dashboard'),
  closePanel: () => ipcRenderer.send('panel:close'),
  quit: () => ipcRenderer.send('app:quit'),
  port: () => ipcRenderer.invoke('app:port'),
  orbMetric: () => ipcRenderer.invoke('app:orb-metric'),
  setOrbMetric: (m) => ipcRenderer.send('app:set-orb-metric', m),
  onRefresh: (cb) => ipcRenderer.on('panel:refresh', cb),
  onMetricChanged: (cb) => ipcRenderer.on('orb:metric-changed', cb)
});
