import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  screen,
  nativeImage,
  clipboard,
  ipcMain
} from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  initDatabase,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  searchItems
} from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow
let searchWindow
let tray
let isQuitting = false

const devServerUrl = process.env.VITE_DEV_SERVER_URL

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools()
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html')
    mainWindow.loadURL(pathToFileURL(indexPath).toString())
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
}

function getSearchUrl() {
  if (devServerUrl) {
    return `${devServerUrl}?mode=search`
  }
  const indexPath = path.join(__dirname, 'dist', 'index.html')
  return `${pathToFileURL(indexPath).toString()}?mode=search`
}

function centerOnDisplay(win, width, height) {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const { x, y, width: w, height: h } = display.workArea
  const posX = Math.round(x + (w - width) / 2)
  const posY = Math.round(y + (h - height) / 2)
  win.setBounds({ x: posX, y: posY, width, height })
}

function createSearchWindow() {
  searchWindow = new BrowserWindow({
    width: 680,
    height: 120,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  searchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  centerOnDisplay(searchWindow, 680, 120)
  searchWindow.loadURL(getSearchUrl())

  searchWindow.on('blur', () => {
    if (searchWindow?.isVisible()) {
      searchWindow.hide()
    }
  })
}

function ensureSearchWindow() {
  if (!searchWindow || searchWindow.isDestroyed()) {
    createSearchWindow()
  }
}

function openSearchWindow() {
  ensureSearchWindow()
  centerOnDisplay(searchWindow, 680, 120)
  searchWindow.show()
  searchWindow.focus()
  if (searchWindow.webContents.isLoading()) {
    searchWindow.webContents.once('did-finish-load', () => {
      searchWindow.webContents.send('search:open')
    })
  } else {
    searchWindow.webContents.send('search:open')
  }
}

function createTray() {
  const svg = `
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill="#0f172a"/>
      <circle cx="32" cy="32" r="14" fill="#38bdf8"/>
    </svg>
  `
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  )
  tray = new Tray(icon)
  tray.setToolTip('Copy App')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Space', () => {
    openSearchWindow()
  })
}

function registerIpc() {
  ipcMain.handle('items:list', () => listItems())
  ipcMain.handle('items:create', (_event, text) => createItem(text))
  ipcMain.handle('items:update', (_event, id, text) => updateItem(id, text))
  ipcMain.handle('items:delete', (_event, id) => deleteItem(id))
  ipcMain.handle('items:search', (_event, query) => searchItems(query))
  ipcMain.handle('clipboard:copy', (_event, text) => {
    clipboard.writeText(text)
    return true
  })
  ipcMain.handle('search:close', () => {
    if (searchWindow?.isVisible()) {
      searchWindow.hide()
    }
    return true
  })
  ipcMain.handle('main:show', () => {
    mainWindow.show()
    mainWindow.focus()
    return true
  })
}

app.whenReady().then(async () => {
  await initDatabase(app.getPath('userData'))
  createMainWindow()
  createTray()
  createSearchWindow()
  registerShortcuts()
  registerIpc()

  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  } else {
    mainWindow?.show()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
