const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  rescan: () => ipcRenderer.invoke('rescan'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  loadPlugin: (id, opts) => ipcRenderer.invoke('load-plugin', id, opts),
  dawStatus: () => ipcRenderer.invoke('daw-status'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  checkAccessibility: () => ipcRenderer.invoke('check-accessibility'),
  snapshot: (ids, force) => ipcRenderer.invoke('snapshot', ids, force),
  snapshotAll: () => ipcRenderer.invoke('snapshot-all'),
  snapshotCancel: () => ipcRenderer.invoke('snapshot-cancel'),
  health: () => ipcRenderer.invoke('health'),
  addSessionFolder: () => ipcRenderer.invoke('add-session-folder'),
  removeSessionFolder: (f) => ipcRenderer.invoke('remove-session-folder', f),
  showInFinder: (p) => ipcRenderer.invoke('show-in-finder', p),
  liveIndexStart: (onlyMissing) => ipcRenderer.invoke('liveindex-start', onlyMissing),
  liveIndexSome: (ids) => ipcRenderer.invoke('liveindex-some', ids),
  liveIndexStop: () => ipcRenderer.invoke('liveindex-stop'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  openLink: (key) => ipcRenderer.invoke('open-link', key),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
});
