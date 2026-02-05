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
import updater from 'electron-updater'
const { autoUpdater } = updater
import net from 'node:net'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
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
let pendingSaveText = ''
let settings = {
  selectionSaveEnabled: true,
  searchShortcut: 'CommandOrControl+Space'
}
let currentSearchShortcut = null

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const UIA_PIPE_NAME = 'copy-app-uia'
const SETTINGS_PATH = path.join(os.tmpdir(), 'copy-app-settings.json')
const UPDATE_FEED_URL =
  'https://github.com/zhaodesen/electron-copy/releases/latest/download'

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
    const indexPath = path.join(__dirname, 'dist', 'renderer', 'index.html')
    mainWindow.loadURL(pathToFileURL(indexPath).toString())
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      mainWindow.setSkipTaskbar(true)
    }
  })

  mainWindow.on('minimize', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      mainWindow.setSkipTaskbar(true)
    }
  })

  mainWindow.on('show', () => {
    mainWindow.setSkipTaskbar(false)
  })
}

function logMain(message) {
  try {
    const logPath = path.join(os.tmpdir(), 'copy-app-uia-main.log')
    const line = `${new Date().toISOString()} ${message}\n`
    fs.appendFile(logPath, line, () => {})
  } catch {
    // ignore logging errors
  }
}

function configureAutoUpdater() {
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_FEED_URL
  })
  autoUpdater.on('error', (error) => {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? error.message
        : String(error)
    logMain(`autoUpdater error: ${message}`)
  })
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      settings = {
        selectionSaveEnabled: parsed.selectionSaveEnabled !== false,
        searchShortcut:
          typeof parsed.searchShortcut === 'string' && parsed.searchShortcut.trim()
            ? parsed.searchShortcut.trim()
            : settings.searchShortcut
      }
      return
    }
  } catch {
    // ignore read errors
  }
  persistSettings(settings)
}

function persistSettings(next) {
  settings = {
    selectionSaveEnabled: next.selectionSaveEnabled !== false,
    searchShortcut:
      typeof next.searchShortcut === 'string' && next.searchShortcut.trim()
        ? next.searchShortcut.trim()
        : settings.searchShortcut
  }
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings), 'utf8')
  } catch {
    // ignore write errors
  }
}

function getSearchUrl() {
  if (devServerUrl) {
    return `${devServerUrl}?mode=search`
  }
  const indexPath = path.join(__dirname, 'dist', 'renderer', 'index.html')
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
    app.isPackaged
      ? path.join(process.resourcesPath, 'uia-helper', 'UiaHelper.exe')
      : null,
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
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function startUiaHelper() {
  if (process.platform !== 'win32') return

  const pipePath = `\\\\.\\pipe\\${UIA_PIPE_NAME}`
  uiaServer = net.createServer((stream) => {
    let data = ''
    let flushTimer
    const flush = () => {
      const text = data.trim()
      data = ''
      if (!text) return
      logMain(`pipe flush len=${text.length}`)
      requestSaveFromUia(text)
    }
    const scheduleFlush = () => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => {
        flushTimer = null
        flush()
      }, 60)
    }
    stream.on('data', (buffer) => {
      data += buffer.toString('utf8')
      scheduleFlush()
    })
    stream.on('end', () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flush()
    })
    stream.on('error', () => {})
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

function requestSaveFromUia(text) {
  if (!text) return
  if (!settings.selectionSaveEnabled) {
    logMain('selection save disabled')
    return
  }
  logMain(`requestSaveFromUia len=${text.length}`)
  pendingSaveText = text
  if (mainWindow?.isDestroyed()) {
    createMainWindow()
  }
  if (!mainWindow) return
  if (searchWindow?.isVisible()) {
    searchWindow.hide()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(true)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false)
    }
  }, 120)
  const send = () => {
    mainWindow.webContents.send('items:save-request', text)
  }
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    setTimeout(send, 0)
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
  if (currentSearchShortcut) {
    globalShortcut.unregister(currentSearchShortcut)
  }
  const shortcut = settings.searchShortcut || 'CommandOrControl+Space'
  const ok = globalShortcut.register(shortcut, () => {
    openSearchWindow()
  })
  if (!ok && shortcut !== 'CommandOrControl+Space') {
    globalShortcut.register('CommandOrControl+Space', () => {
      openSearchWindow()
    })
    currentSearchShortcut = 'CommandOrControl+Space'
    logMain(`shortcut fallback to ${currentSearchShortcut}`)
    return
  }
  currentSearchShortcut = shortcut
}

function registerIpc() {
  ipcMain.handle('items:list', () => listItems())
  ipcMain.handle('items:frequent', (_event, limit) => listFrequentItems(limit))
  ipcMain.handle('items:create', (_event, payload) => createItem(payload))
  ipcMain.handle('items:update', (_event, id, payload) => updateItem(id, payload))
  ipcMain.handle('items:delete', (_event, id) => deleteItem(id))
  ipcMain.handle('items:search', (_event, query) => searchItems(query))
  ipcMain.handle('items:usage', (_event, id) => incrementUsage(id))
  ipcMain.handle('items:save-pending', () => {
    const text = pendingSaveText
    pendingSaveText = ''
    logMain(`save-pending consumed len=${text.length}`)
    return text
  })
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:update', (_event, next) => {
    persistSettings(next || {})
    registerShortcuts()
    return settings
  })
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
  loadSettings()
  await initDatabase(app.getPath('userData'))
  createMainWindow()
  createTray()
  createSearchWindow()
  startUiaHelper()
  registerShortcuts()
  registerIpc()

  if (app.isPackaged) {
    configureAutoUpdater()
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? error.message
          : String(error)
      logMain(`update check failed: ${message}`)
    })
  }

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
