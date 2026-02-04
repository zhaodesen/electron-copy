import fs from 'node:fs/promises'
import path from 'node:path'

let dbPath = ''
let initialized = false
let writeQueue = Promise.resolve()
let state = {
  lastId: 0,
  items: []
}

export async function initDatabase(userDataPath) {
  dbPath = path.join(userDataPath, 'copy-app.json')
  await loadFromDisk()
  initialized = true
  return state
}

function ensureInitialized() {
  if (!initialized) {
    throw new Error('Database not initialized. Call initDatabase first.')
  }
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(dbPath, 'utf8')
    state = normalizeState(JSON.parse(raw))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      state = { lastId: 0, items: [] }
      await persist()
      return
    }
    throw error
  }
}

function normalizeState(data) {
  const items = Array.isArray(data?.items) ? data.items : []
  const normalizedItems = []
  let maxId = 0
  const now = Date.now()

  for (const raw of items) {
    const id = Number(raw?.id)
    if (!Number.isFinite(id) || id <= 0) continue
    const text = typeof raw?.text === 'string' ? raw.text : ''
    const createdAt = Number(raw?.created_at)
    const updatedAt = Number(raw?.updated_at)
    const created = Number.isFinite(createdAt) ? createdAt : now
    const updated = Number.isFinite(updatedAt) ? updatedAt : created

    normalizedItems.push({
      id,
      text,
      created_at: created,
      updated_at: updated
    })
    if (id > maxId) maxId = id
  }

  const lastId = Number(data?.lastId)
  return {
    lastId: Number.isFinite(lastId) ? Math.max(lastId, maxId) : maxId,
    items: normalizedItems
  }
}

function sortByUpdatedDesc(items) {
  return items.sort((a, b) => b.updated_at - a.updated_at)
}

function cloneItem(item) {
  return { ...item }
}

async function persist() {
  if (!dbPath) {
    throw new Error('Database path not initialized.')
  }
  const payload = JSON.stringify(state)
  const writeTask = () => fs.writeFile(dbPath, payload, 'utf8')
  writeQueue = writeQueue.then(writeTask, writeTask)
  return writeQueue
}

export async function listItems() {
  ensureInitialized()
  return sortByUpdatedDesc([...state.items]).map(cloneItem)
}

export async function createItem(text) {
  ensureInitialized()
  const now = Date.now()
  const item = {
    id: ++state.lastId,
    text: typeof text === 'string' ? text : '',
    created_at: now,
    updated_at: now
  }
  state.items.push(item)
  await persist()
  return cloneItem(item)
}

export async function updateItem(id, text) {
  ensureInitialized()
  const numericId = Number(id)
  const item = state.items.find((entry) => entry.id === numericId)
  if (!item) return null
  item.text = typeof text === 'string' ? text : ''
  item.updated_at = Date.now()
  await persist()
  return cloneItem(item)
}

export async function deleteItem(id) {
  ensureInitialized()
  const numericId = Number(id)
  const index = state.items.findIndex((entry) => entry.id === numericId)
  if (index === -1) return false
  state.items.splice(index, 1)
  await persist()
  return true
}

export async function searchItems(query) {
  ensureInitialized()
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const results = q
    ? state.items.filter((item) => item.text.toLowerCase().includes(q))
    : state.items
  return sortByUpdatedDesc([...results]).map(cloneItem)
}
