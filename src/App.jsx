import { useEffect, useMemo, useRef, useState } from 'react'

const api = typeof window !== 'undefined' ? window.api : null
const isSearchMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'search'

function formatDate(ts) {
  const date = new Date(ts)
  return date.toLocaleString()
}

function HomeMenu({ onOpenCopy }) {
  return (
    <div className="home">
      <header className="home__header">
        <h1>Copy App</h1>
        <p>文本快捷管理与搜索</p>
      </header>
      <section className="home__grid">
        <button className="menu-card" onClick={onOpenCopy}>
          <span className="menu-card__title">Copy</span>
          <span className="menu-card__desc">管理与拷贝文本</span>
        </button>
      </section>
    </div>
  )
}

function CopyList({ onBack }) {
  const [items, setItems] = useState([])
  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    let mounted = true
    api.listItems().then((data) => {
      if (mounted) setItems(data)
    })
    return () => {
      mounted = false
    }
  }, [])

  const handleAdd = async () => {
    const text = input.trim()
    if (!text) return
    const created = await api.createItem(text)
    setItems((prev) => [created, ...prev])
    setInput('')
  }

  const handleDelete = async (id) => {
    const ok = await api.deleteItem(id)
    if (ok) {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }
  }

  const handleCopy = async (text) => {
    await api.copyText(text)
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditingText(item.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  const saveEdit = async () => {
    if (!editingText.trim()) return
    const updated = await api.updateItem(editingId, editingText.trim())
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    )
    cancelEdit()
  }

  return (
    <div className="copy">
      <header className="copy__header">
        <button className="ghost" onClick={onBack}>
          返回
        </button>
        <div>
          <h1>Copy 列表</h1>
          <p>点击文本即可拷贝</p>
        </div>
      </header>

      <section className="copy__composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入要保存的文本，长度不限..."
          rows={4}
        />
        <button className="primary" onClick={handleAdd}>
          添加
        </button>
      </section>

      <section className="copy__list">
        {items.length === 0 && (
          <div className="empty">还没有内容，先添加一条吧。</div>
        )}
        {items.map((item) => {
          const isEditing = editingId === item.id
          return (
            <div key={item.id} className="copy-item">
              <div className="copy-item__meta">
                <span>更新于 {formatDate(item.updated_at)}</span>
              </div>
              {isEditing ? (
                <textarea
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  rows={4}
                />
              ) : (
                <button
                  className="copy-item__text"
                  onClick={() => handleCopy(item.text)}
                >
                  {item.text}
                </button>
              )}
              <div className="copy-item__actions">
                {isEditing ? (
                  <>
                    <button className="primary" onClick={saveEdit}>
                      保存
                    </button>
                    <button className="ghost" onClick={cancelEdit}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button className="ghost" onClick={() => startEdit(item)}>
                      编辑
                    </button>
                    <button
                      className="danger"
                      onClick={() => handleDelete(item.id)}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </section>
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
      const latest = await api.listItems()
      setResults(latest.slice(0, 6))
      setActiveIndex(0)
      return
    }
    const data = await api.searchItems(keyword.trim())
    setResults(data.slice(0, 8))
    setActiveIndex(0)
  }

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
          api.copyText(target.text).then(() => api.closeSearch())
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, activeIndex])

  return (
    <div className="spotlight">
      <div className="spotlight__input">
        <span className="spotlight__icon">⌘</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索已保存的文本..."
          autoFocus
        />
        <span className="spotlight__hint">Enter 复制</span>
      </div>
      <div className="spotlight__results">
        {results.length === 0 && (
          <div className="spotlight__empty">暂无结果</div>
        )}
        {results.map((item, index) => (
          <button
            key={item.id}
            className={`spotlight__item ${
              index === activeIndex ? 'is-active' : ''
            }`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => api.copyText(item.text).then(() => api.closeSearch())}
          >
            <span className="spotlight__text">{item.text}</span>
            <span className="spotlight__meta">
              {formatDate(item.updated_at)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('home')

  if (isSearchMode) {
    return <SearchOverlay />
  }

  return (
    <div className="app">
      {view === 'home' && <HomeMenu onOpenCopy={() => setView('copy')} />}
      {view === 'copy' && <CopyList onBack={() => setView('home')} />}
    </div>
  )
}
