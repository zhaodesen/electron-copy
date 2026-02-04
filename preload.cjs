const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
})

contextBridge.exposeInMainWorld('api', {
  listItems: () => ipcRenderer.invoke('items:list'),
  listFrequentItems: (limit) => ipcRenderer.invoke('items:frequent', limit),
  createItem: (payload) => ipcRenderer.invoke('items:create', payload),
  updateItem: (id, payload) => ipcRenderer.invoke('items:update', id, payload),
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  searchItems: (query) => ipcRenderer.invoke('items:search', query),
  recordUsage: (id) => ipcRenderer.invoke('items:usage', id),
  consumeSaveRequest: () => ipcRenderer.invoke('items:save-pending'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  closeSearch: () => ipcRenderer.invoke('search:close'),
  showMain: () => ipcRenderer.invoke('main:show'),
  onSearchOpen: (callback) => {
    ipcRenderer.removeAllListeners('search:open')
    ipcRenderer.on('search:open', () => callback())
  },
  onSaveRequest: (callback) => {
    ipcRenderer.removeAllListeners('items:save-request')
    ipcRenderer.on('items:save-request', (_event, text) => callback(text))
  }
})
