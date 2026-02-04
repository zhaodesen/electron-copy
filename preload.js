import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
})

contextBridge.exposeInMainWorld('api', {
  listItems: () => ipcRenderer.invoke('items:list'),
  createItem: (text) => ipcRenderer.invoke('items:create', text),
  updateItem: (id, text) => ipcRenderer.invoke('items:update', id, text),
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  searchItems: (query) => ipcRenderer.invoke('items:search', query),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  closeSearch: () => ipcRenderer.invoke('search:close'),
  showMain: () => ipcRenderer.invoke('main:show'),
  onSearchOpen: (callback) => {
    ipcRenderer.removeAllListeners('search:open')
    ipcRenderer.on('search:open', () => callback())
  }
})
