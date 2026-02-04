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
import net from 'node:net'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  initDatabase,
  listItems,
  listFrequentItems,
  createItem,
  updateItem,
  deleteItem,
  searchItems,
  incrementUsage
} from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow
let searchWindow
let tray
let isQuitting = false
let uiaServer
let uiaProcess
let lastUiaSelection = ''
let lastUiaSelectionAt = 0

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const UIA_PIPE_NAME = 'copy-app-uia'
const UIA_RECENT_MS = 5000

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    }
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setMenu(null)

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

function fitSearchWindowToDisplay() {
  if (!searchWindow || searchWindow.isDestroyed()) return
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const { x, y, width, height } = display.bounds
  searchWindow.setBounds({ x, y, width, height })
}

function createSearchWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds
  searchWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    }
  })
  searchWindow.setMenuBarVisibility(false)
  searchWindow.setMenu(null)

  searchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  fitSearchWindowToDisplay()
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
  fitSearchWindowToDisplay()
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

function resolveUiaHelperPath() {
  const candidates = [
    path.join(
      __dirname,
      'tools',
      'uia-helper',
      'bin',
      'Release',
      'net8.0-windows',
      'win-x64',
      'publish',
      'UiaHelper.exe'
    ),
    path.join(
      __dirname,
      'tools',
      'uia-helper',
      'bin',
      'Release',
      'net8.0-windows',
      'UiaHelper.exe'
    ),
    path.join(
      __dirname,
      'tools',
      'uia-helper',
      'bin',
      'Debug',
      'net8.0-windows',
      'UiaHelper.exe'
    )
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function startUiaHelper() {
  if (process.platform !== 'win32') return

  const pipePath = `\\\\.\\pipe\\${UIA_PIPE_NAME}`
  uiaServer = net.createServer((stream) => {
    stream.on('data', (buffer) => {
      const text = buffer.toString('utf8').trim()
      if (!text) return
      lastUiaSelection = text
      lastUiaSelectionAt = Date.now()
    })
  })

  uiaServer.on('error', () => {})
  uiaServer.listen(pipePath)

  const helperPath = resolveUiaHelperPath()
  if (!helperPath) return

  uiaProcess = spawn(helperPath, [UIA_PIPE_NAME], {
    stdio: 'ignore',
    windowsHide: true
  })
}

function getRecentSelectionText() {
  if (!lastUiaSelection) return ''
  if (Date.now() - lastUiaSelectionAt > UIA_RECENT_MS) return ''
  return lastUiaSelection
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
  globalShortcut.register('Shift+Space', async () => {
    const selectionText = getRecentSelectionText()
    const text = selectionText || clipboard.readText().trim()
    if (!text) return
    const label = text.split(/\r?\n/)[0].slice(0, 20)
    await createItem({ label, content: text })
  })
}

function registerIpc() {
  ipcMain.handle('items:list', () => listItems())
  ipcMain.handle('items:frequent', (_event, limit) => listFrequentItems(limit))
  ipcMain.handle('items:create', (_event, payload) => createItem(payload))
  ipcMain.handle('items:update', (_event, id, payload) => updateItem(id, payload))
  ipcMain.handle('items:delete', (_event, id) => deleteItem(id))
  ipcMain.handle('items:search', (_event, query) => searchItems(query))
  ipcMain.handle('items:usage', (_event, id) => incrementUsage(id))
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
  Menu.setApplicationMenu(null)
  await initDatabase(app.getPath('userData'))
  createMainWindow()
  createTray()
  createSearchWindow()
  startUiaHelper()
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
  if (uiaProcess) {
    uiaProcess.kill()
    uiaProcess = null
  }
  if (uiaServer) {
    uiaServer.close()
    uiaServer = null
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
