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

    const label = typeof raw?.label === 'string' ? raw.label : ''
    let content = ''
    if (typeof raw?.content === 'string') {
      content = raw.content
    } else if (typeof raw?.text === 'string') {
      content = raw.text
    } else {
      const account = typeof raw?.account === 'string' ? raw.account : ''
      const password = typeof raw?.password === 'string' ? raw.password : ''
      const parts = []
      if (account) parts.push(`\u8d26\u53f7: ${account}`)
      if (password) parts.push(`\u5bc6\u7801: ${password}`)
      content = parts.join(' | ')
    }

    const createdAt = Number(raw?.created_at)
    const updatedAt = Number(raw?.updated_at)
    const created = Number.isFinite(createdAt) ? createdAt : now
    const updated = Number.isFinite(updatedAt) ? updatedAt : created

    const usageRaw = raw?.usage_count ?? raw?.usageCount
    const usage = Number(usageRaw)
    const usageCount = Number.isFinite(usage) && usage >= 0 ? usage : 0

    normalizedItems.push({
      id,
      label,
      content,
      created_at: created,
      updated_at: updated,
      usage_count: usageCount
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

export async function listFrequentItems(limit = 5) {
  ensureInitialized()
  const items = [...state.items].sort((a, b) => {
    if (b.usage_count !== a.usage_count) {
      return b.usage_count - a.usage_count
    }
    return b.updated_at - a.updated_at
  })
  return items.slice(0, Math.max(0, Number(limit) || 0)).map(cloneItem)
}

export async function createItem(payload = {}) {
  ensureInitialized()
  const now = Date.now()
  const item = {
    id: ++state.lastId,
    label: typeof payload?.label === 'string' ? payload.label : '',
    content: typeof payload?.content === 'string' ? payload.content : '',
    created_at: now,
    updated_at: now,
    usage_count: 0
  }
  state.items.push(item)
  await persist()
  return cloneItem(item)
}

export async function updateItem(id, payload = {}) {
  ensureInitialized()
  const numericId = Number(id)
  const item = state.items.find((entry) => entry.id === numericId)
  if (!item) return null

  item.label = typeof payload?.label === 'string' ? payload.label : ''
  item.content = typeof payload?.content === 'string' ? payload.content : ''
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
  if (!q) return listItems()

  const results = state.items.filter((item) => {
    const haystack = [item.label, item.content]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })

  return sortByUpdatedDesc([...results]).map(cloneItem)
}

export async function incrementUsage(id) {
  ensureInitialized()
  const numericId = Number(id)
  const item = state.items.find((entry) => entry.id === numericId)
  if (!item) return null
  item.usage_count = Math.max(0, Number(item.usage_count) || 0) + 1
  await persist()
  return cloneItem(item)
}
