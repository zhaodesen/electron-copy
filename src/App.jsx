import { useEffect, useRef, useState } from 'react'

const api = typeof window !== 'undefined' ? window.api : null
const isSearchMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'search'

const STRINGS = {
  title: '\u5feb\u6377\u65b9\u5f0f',
  searchPlaceholder: '\u641c\u7d22\u5feb\u6377\u65b9\u5f0f/\u5185\u5bb9',
  add: '\u6dfb\u52a0',
  empty: '\u6682\u65e0\u5185\u5bb9',
  unnamed: '\u672a\u547d\u540d',
  edit: '\u7f16\u8f91',
  delete: '\u5220\u9664',
  shortcutLabel: '\u7b80\u79f0',
  content: '\u5185\u5bb9',
  copy: '\u590d\u5236',
  labelPlaceholder: '\u8bf7\u8f93\u5165\u7b80\u79f0',
  contentPlaceholder: '\u8f93\u5165\u8981\u4fdd\u5b58\u7684\u6587\u672c',
  cancel: '\u53d6\u6d88',
  save: '\u4fdd\u5b58',
  requiredToast: '\u8bf7\u586b\u5199\u5185\u5bb9',
  copiedToast: '\u590d\u5236\u6210\u529f',
  searchPlaceholderSpotlight: '\u641c\u7d22\u5df2\u4fdd\u5b58\u7684\u5185\u5bb9...',
  searchEmpty: '\u6682\u65e0\u7ed3\u679c',
  searchHint: 'Enter \u590d\u5236',
  settings: '\u8bbe\u7f6e',
  settingsSaveToggle: '\u4fdd\u5b58\u6309\u94ae\u5f00\u5173',
  settingsShortcut: '\u641c\u7d22\u5feb\u6377\u952e',
  settingsHint: '\u4f8b\u5982\uff1aCommandOrControl+Space'
}

const ITEM_HEIGHT = 56
const OVERSCAN = 10

function CopyList() {
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [form, setForm] = useState({
    label: '',
    content: ''
  })
  const [settings, setSettings] = useState({
    selectionSaveEnabled: true,
    searchShortcut: 'CommandOrControl+Space'
  })
  const [settingsDraft, setSettingsDraft] = useState({
    selectionSaveEnabled: true,
    searchShortcut: 'CommandOrControl+Space'
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const toastTimerRef = useRef(null)
  const listRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(420)

  useEffect(() => {
    let mounted = true
    api.listItems().then((data) => {
      if (mounted) setItems(data)
    })
    if (api.getSettings) {
      api.getSettings().then((data) => {
        if (!mounted || !data) return
        setSettings(data)
        setSettingsDraft(data)
      })
    }
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const update = () => setViewHeight(node.clientHeight || 420)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!api?.onSaveRequest) return
    api.onSaveRequest((text) => {
      openCreate(text || '')
      api.consumeSaveRequest?.()
    })
  }, [])

  useEffect(() => {
    if (!api?.consumeSaveRequest) return
    const checkPending = async () => {
      const pending = await api.consumeSaveRequest()
      if (pending) {
        openCreate(pending)
      }
    }
    checkPending()
    const handleFocus = () => {
      checkPending()
    }
    window.addEventListener('focus', handleFocus)
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      checkPending()
    }, 500)
    return () => {
      window.removeEventListener('focus', handleFocus)
      clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
    setScrollTop(0)
  }, [items.length, query])

  const showToast = (message) => {
    setToast(message)
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = setTimeout(() => {
      setToast('')
    }, 1400)
  }

  const openCreate = (prefillContent = '') => {
    const resolved =
      prefillContent && typeof prefillContent === 'object'
        ? prefillContent.content ?? prefillContent.text ?? ''
        : prefillContent
    const content = typeof resolved === 'string'
      ? resolved.trim()
      : String(resolved ?? '').trim()
    const label = content ? content.split(/\r?\n/)[0].slice(0, 20) : ''
    setEditingItem(null)
    setForm({
      label,
      content
    })
    setIsModalOpen(true)
  }

  const openEdit = (item) => {
    setEditingItem(item)
    setForm({
      label: item.label || '',
      content: item.content || ''
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
  }

  const openSettings = () => {
    setSettingsDraft(settings)
    setIsSettingsOpen(true)
  }

  const closeSettings = () => {
    setIsSettingsOpen(false)
  }

  const saveSettings = async (event) => {
    event.preventDefault()
    if (!api.updateSettings) {
      setIsSettingsOpen(false)
      return
    }
    const updated = await api.updateSettings(settingsDraft)
    if (updated) {
      setSettings(updated)
      setSettingsDraft(updated)
    }
    setIsSettingsOpen(false)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const payload = {
      label: form.label.trim(),
      content: form.content.trim()
    }

    if (!payload.label && !payload.content) {
      showToast(STRINGS.requiredToast)
      return
    }

    if (editingItem) {
      const updated = await api.updateItem(editingItem.id, payload)
      if (updated) {
        setItems((prev) => [
          updated,
          ...prev.filter((item) => item.id !== updated.id)
        ])
      }
    } else {
      const created = await api.createItem(payload)
      setItems((prev) => [created, ...prev])
    }

    setIsModalOpen(false)
  }

  const handleDelete = async (id) => {
    const ok = await api.deleteItem(id)
    if (ok) {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }
  }

  const handleCopy = async (itemId, text) => {
    if (!text) return
    await api.copyText(text)
    await api.recordUsage(itemId)
    showToast(STRINGS.copiedToast)
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredItems = normalizedQuery
    ? items.filter((item) => {
      const haystack = [item.label, item.content]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
    : items

  const totalHeight = filteredItems.length * ITEM_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewHeight / ITEM_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(filteredItems.length, startIndex + visibleCount)
  const offsetY = startIndex * ITEM_HEIGHT
  const visibleItems = filteredItems.slice(startIndex, endIndex)

  return (
    <div className="copy">
      <header className="copy__header">
        <div className="copy__header-actions">
          <div className="copy__search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={STRINGS.searchPlaceholder}
            />
          </div>
          <button className="icon-button" onClick={openCreate} aria-label={STRINGS.add}>
            +
          </button>
        </div>
      </header>

      <section className="copy__list">
        <div
          className="copy__list-virtual"
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {filteredItems.length === 0 ? (
            <div className="empty">{STRINGS.empty}</div>
          ) : (
            <div className="copy__list-spacer" style={{ height: totalHeight }}>
              <div
                className="copy__list-window"
                style={{ transform: `translateY(${offsetY}px)` }}
              >
                {visibleItems.map((item) => {
                  const label = item.label?.trim() || STRINGS.unnamed
                  const content = item.content || ''
                  return (
                    <div key={item.id} className="copy-row">
                      <div className="copy-row__main">
                       
                        <span
                          className="copy-row__content"
                          title={content}
                        >
                          {content || '-'}
                        </span>
                        
                        <button
                          className="copy-row__icon"
                          onClick={() => handleCopy(item.id, item.content)}
                          aria-label={STRINGS.copy}
                          title={STRINGS.copy}
                          disabled={!item.content}
                        >
                          <svg focusable="false" data-icon="copy" width="1em" height="1em" fill="currentColor" aria-hidden="true" viewBox="64 64 896 896"><path d="M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v530.7c0 8.5 3.4 16.6 9.4 22.6l173.3 173.3c2.2 2.2 4.7 4 7.4 5.5v1.9h4.2c3.5 1.3 7.2 2 11 2H704c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32zM350 856.2L263.9 770H350v86.2zM664 888H414V746c0-22.1-17.9-40-40-40H232V264h432v624z"></path></svg>
                        </button>
                      </div>
                       {/* <span className="copy-row__label">{label}</span> */}
                      <div className="copy-row__actions">
                        <button
                          className="row-action"
                          onClick={() => openEdit(item)}
                        >
                          {STRINGS.edit}
                        </button>
                        <button
                          className="row-action row-action--danger"
                          onClick={() => handleDelete(item.id)}
                        >
                          {STRINGS.delete}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {isModalOpen && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{editingItem ? STRINGS.edit : STRINGS.add}</h2>
            <form onSubmit={handleSubmit} className="modal__form">
              <label>
                {STRINGS.shortcutLabel}
                <input
                  value={form.label}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  placeholder={STRINGS.labelPlaceholder}
                />
              </label>
              <label>
                {STRINGS.content}
                <textarea
                  rows={5}
                  value={form.content}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      content: event.target.value
                    }))
                  }
                  placeholder={STRINGS.contentPlaceholder}
                />
              </label>
              <div className="modal__actions">
                <button type="button" className="ghost" onClick={closeModal}>
                  {STRINGS.cancel}
                </button>
                <button type="submit" className="primary">
                  {editingItem ? STRINGS.save : STRINGS.add}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={closeSettings}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{STRINGS.settings}</h2>
            <form onSubmit={saveSettings} className="modal__form">
              <label className="settings-row">
                <span>{STRINGS.settingsSaveToggle}</span>
                <input
                  type="checkbox"
                  checked={!!settingsDraft.selectionSaveEnabled}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      selectionSaveEnabled: event.target.checked
                    }))
                  }
                />
              </label>
              <label>
                {STRINGS.settingsShortcut}
                <input
                  value={settingsDraft.searchShortcut || ''}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      searchShortcut: event.target.value
                    }))
                  }
                  placeholder={STRINGS.settingsHint}
                />
              </label>
              <div className="modal__actions">
                <button type="button" className="ghost" onClick={closeSettings}>
                  {STRINGS.cancel}
                </button>
                <button type="submit" className="primary">
                  {STRINGS.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'is-visible' : ''}`}>{toast}</div>

      <button className="settings-fab" onClick={openSettings} aria-label={STRINGS.settings}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.5 3.5a6.8 6.8 0 0 0-.08-1l2.02-1.56-2-3.46-2.46 1a7.1 7.1 0 0 0-1.74-1l-.38-2.6h-4l-.38 2.6a7.1 7.1 0 0 0-1.74 1l-2.46-1-2 3.46 2.02 1.56a6.8 6.8 0 0 0 0 2l-2.02 1.56 2 3.46 2.46-1c.54.43 1.12.78 1.74 1l.38 2.6h4l.38-2.6c.62-.22 1.2-.57 1.74-1l2.46 1 2-3.46-2.02-1.56c.05-.33.08-.66.08-1z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  )
}

function SearchOverlay() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  const fetchResults = async (keyword) => {
    if (!keyword.trim()) {
      const latest = await api.listFrequentItems(5)
      setResults(latest)
      setActiveIndex(0)
      return
    }
    const data = await api.searchItems(keyword.trim())
    setResults(data.slice(0, 8))
    setActiveIndex(0)
  }

  useEffect(() => {
    document.body.classList.add('is-search')
    document.documentElement.classList.add('is-search')
    return () => {
      document.body.classList.remove('is-search')
      document.documentElement.classList.remove('is-search')
    }
  }, [])

  useEffect(() => {
    let timer = setTimeout(() => {
      fetchResults(query)
    }, 120)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    api.onSearchOpen(() => {
      setQuery('')
      setResults([])
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
      fetchResults('')
    })
  }, [])

  const copyFromResult = async (item) => {
    if (!item) return
    const text = item.content || ''
    if (!text) return
    await api.copyText(text)
    await api.recordUsage(item.id)
    api.closeSearch()
  }

  const formatResultText = (item) => {
    const label = item.label?.trim()
    if (label && item.content) return `${label} - ${item.content}`
    return label || item.content || STRINGS.unnamed
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        api.closeSearch()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) =>
          Math.min(prev + 1, Math.max(results.length - 1, 0))
        )
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = results[activeIndex]
        if (target) {
          copyFromResult(target)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, activeIndex])

  return (
    <div className="spotlight" onClick={() => api.closeSearch()}>
      <div
        className="spotlight__panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="spotlight__input">
          <span className="spotlight__icon">Ctrl</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={STRINGS.searchPlaceholderSpotlight}
            autoFocus
          />
          <span className="spotlight__hint">{STRINGS.searchHint}</span>
        </div>
        <div className="spotlight__results">
          {results.length === 0 && (
            <div className="spotlight__empty">{STRINGS.searchEmpty}</div>
          )}
          {results.map((item, index) => (
            <button
              key={item.id}
              className={`spotlight__item ${index === activeIndex ? 'is-active' : ''
                }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => copyFromResult(item)}
            >
              <span className="spotlight__text">{formatResultText(item)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  if (isSearchMode) {
    return <SearchOverlay />
  }

  return (
    <div className="app">
      <CopyList />
    </div>
  )
}
