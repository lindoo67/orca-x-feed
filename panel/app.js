// X Feed panel. Plain script in an Orca frame: `window.orca` is injected before this runs.
'use strict'

const el = (id) => document.getElementById(id)

const inputEl = el('lookup-input')
const goBtn = el('lookup-go')
const clearBtn = el('lookup-clear')
const resultEl = el('result')
const savedEl = el('saved')
const statusEl = el('status')
const savedCountEl = el('saved-count')

let pending = null

// ---- worker calls -------------------------------------------------------

// One host method reaches the worker's `orca.panels.handle(name)` handlers.
// Output is wrapped in `{ output }` by the host.
async function request(name, input) {
  const { output } = await orca.host.call('plugin.request', { name, input, timeoutMs: 20000 })
  return output
}

// Any error the host or worker raises carries a machine `code`.
function describe(error) {
  if (error?.code === 'unknown_method') return '这个 Orca 版本还不认识该调用。'
  if (error?.code === 'not_permitted') return '这个操作需要一次真实点击。'
  if (error?.code === 'timeout') return 'worker 超时了，可能上游 X 接口没响应。'
  return error?.message || String(error ?? '未知错误')
}

// ---- render -------------------------------------------------------------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

function linkify(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<span class="lnk">$1</span>')
    .replace(/(^|[\s(])(@[A-Za-z0-9_]{1,15})/g, '$1<span class="men">$2</span>')
    .replace(/(^|[\s(])(#[A-Za-z0-9_]{1,80})/g, '$1<span class="tag">$2</span>')
}

function num(n) {
  if (n === null || n === undefined) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

function ago(ts) {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() / 1000) - Number(ts))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 172800) return '昨天'
  return new Date(Number(ts) * 1000).toLocaleDateString()
}

// Remote images never load in the frame (CSP `img-src 'self' data:`), so the worker
// hands us data: URLs already. A missing avatar falls back to initials.
// fxtwitter reports "Tue Mar 21 20:50:14 +0000 2006"; show just the date.
function joined(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value ?? '') : `${date.getFullYear()} 年加入`
}

function avatar(url, name) {
  if (url) return `<span class="ava" style="background-image:url('${esc(url)}')"></span>`
  const initial = esc(String(name || '?').trim().charAt(0).toUpperCase() || '?')
  return `<span class="ava ini">${initial}</span>`
}

function renderTweet(t) {
  const media = (t.media ?? [])
    .map((src) => `<img class="shot" src="${esc(src)}" alt="" loading="lazy" />`)
    .join('')
  const grid = t.media?.length > 1 ? 'grid' : ''
  const s = t.stats ?? {}

  return `
  <article class="card">
    <header class="who">
      ${avatar(t.author?.avatar, t.author?.name)}
      <div class="who-t">
        <strong>${esc(t.author?.name)}</strong>
        ${t.author?.verified ? '<span class="vf" title="已认证">✓</span>' : ''}
        <span class="hd">${esc(t.author?.handle)}</span>
        <span class="dot">·</span>
        <time class="tm">${esc(ago(t.createdTimestamp))}</time>
      </div>
      <button class="save" data-save="${esc(t.id)}" data-url="${esc(t.url)}"
              data-handle="${esc(t.author?.handle)}" data-text="${esc((t.text || '').slice(0, 280))}"
              title="收藏">☆</button>
    </header>
    ${t.replyingTo ? `<p class="reply-to">回复 @${esc(t.replyingTo)}</p>` : ''}
    <p class="body">${linkify(t.text)}</p>
    ${media ? `<div class="media ${grid}">${media}</div>` : ''}
    ${t.quote ? `<blockquote class="quote">${avatar(t.quote.author?.avatar, t.quote.author?.name)}
      <div><strong>${esc(t.quote.author?.name)}</strong> ${esc(t.quote.text)}</div></blockquote>` : ''}
    ${t.communityNote ? `<p class="note">⚠ ${esc(t.communityNote)}</p>` : ''}
    <footer class="metrics">
      <span title="回复">💬 ${num(s.replies)}</span>
      <span title="转推">🔁 ${num(s.retweets)}</span>
      <span title="喜欢">♡ ${num(s.likes)}</span>
      <span title="浏览">👁 ${num(s.views)}</span>
      <a class="open" data-open="${esc(t.url)}">在 X 打开 ↗</a>
    </footer>
  </article>`
}

function renderProfile(p) {
  const meta = [p.location, p.joined ? joined(p.joined) : ''].filter(Boolean).join(' · ')
  return `
  <article class="card prof">
    <div class="phead">
      ${avatar(p.avatar, p.name)}
      <div>
        <strong class="pname">${esc(p.name)}</strong>
        ${p.verified ? '<span class="vf">✓</span>' : ''}
        ${p.protected ? '<span class="lock">🔒 受保护</span>' : ''}
        <p class="hd">${esc(p.handle)}</p>
      </div>
    </div>
    ${p.description ? `<p class="pdesc">${linkify(p.description)}</p>` : ''}
    ${meta ? `<p class="pmeta">${esc(meta)}</p>` : ''}
    <div class="pstats">
      <span><b>${num(p.tweets)}</b> 推文</span>
      <span><b>${num(p.following)}</b> 关注</span>
      <span><b>${num(p.followers)}</b> 粉丝</span>
    </div>
    ${p.website ? `<p class="pweb">🔗 <span class="lnk">${esc(p.website)}</span></p>` : ''}
    <footer class="metrics"><a class="open" data-open="${esc(p.url)}">在 X 打开 ↗</a></footer>
  </article>`
}

function renderSaved(rows) {
  savedCountEl.textContent = rows.length ? `${rows.length}` : ''
  if (!rows.length) {
    savedEl.innerHTML = '<p class="none">还没有收藏。点开一条推文再按 ☆。</p>'
    return
  }
  savedEl.innerHTML = rows
    .map(
      (r) => `<div class="srow">
        <a class="stxt open" data-open="${esc(r.url)}" title="${esc(r.text)}">
          <span class="shd">${esc(r.handle || '')}</span>${esc(r.text || r.url)}
        </a>
        <button class="sdel" data-del="${esc(r.id)}" title="删除">×</button>
      </div>`
    )
    .join('')
}

// ---- actions ------------------------------------------------------------

async function lookup() {
  const query = inputEl.value.trim()
  if (!query) return
  setBusy(true)
  resultEl.innerHTML = '<p class="hint">抓取中…</p>'
  try {
    const out = await request('feed.lookup', { query })
    if (out?.kind === 'tweet') resultEl.innerHTML = renderTweet(out.tweet)
    else if (out?.kind === 'profile') resultEl.innerHTML = renderProfile(out.profile)
    else resultEl.innerHTML = `<p class="err">${esc(out?.message ?? '没有内容')}</p>`
  } catch (error) {
    resultEl.innerHTML = `<p class="err">${esc(describe(error))}</p>`
  } finally {
    setBusy(false)
  }
}

async function showSaved() {
  try {
    renderSaved(await request('feed.list', {}))
  } catch (error) {
    savedEl.innerHTML = `<p class="err">${esc(describe(error))}</p>`
  }
}

async function toggleSave(btn) {
  const id = btn.dataset.save
  const rows = await request('feed.list', {}).catch(() => [])
  const already = rows.some((r) => r.id === id)
  try {
    const out = already
      ? await request('feed.unsave', { id })
      : await request('feed.save', {
          item: { id, url: btn.dataset.url, handle: btn.dataset.handle, text: btn.dataset.text },
        })
    renderSaved(out.saved ?? (await request('feed.list', {})))
    btn.textContent = already ? '☆' : '★'
  } catch (error) {
    flash(describe(error))
  }
}

// `shell.openExternal` rejects with `not_permitted` unless it runs inside a real
// press, so every open goes through a click handler and nothing pre-opens URLs.
function openExternal(url) {
  if (!url || !/^https?:\/\//i.test(url)) return
  const opening = orca.shell?.openExternal?.(url)
  if (opening?.catch) opening.catch((error) => flash(describe(error)))
  else flash('这个 Orca 客户端不支持直接打开链接。')
}

// ---- misc UI ------------------------------------------------------------

function setBusy(on) {
  goBtn.disabled = on
  goBtn.textContent = on ? '…' : '查询'
}

let flashTimer = null
function flash(message) {
  statusEl.textContent = message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (statusEl.textContent = ''), 4000)
}

// Clicks are delegated once so re-rendered markup needs no rebinding. `open-external`
// is not a host method; the frame-level `shell.openExternal` is the only way out.
document.addEventListener('click', (event) => {
  const open = event.target.closest?.('[data-open]')
  if (open) { openExternal(open.dataset.open); return }
  const save = event.target.closest?.('[data-save]')
  if (save) { toggleSave(save); return }
  const del = event.target.closest?.('[data-del]')
  if (del) {
    request('feed.unsave', { id: del.dataset.del })
      .then((out) => renderSaved(out.saved ?? []))
      .catch((error) => flash(describe(error)))
  }
})

// Orca swaps `light`/`dark` on <html> and emits `theme`; restyle from the tokens.
function applyTheme(payload) {
  const scheme = payload?.colorScheme
  document.documentElement.classList.toggle('dark', scheme === 'dark')
  document.documentElement.classList.toggle('light', scheme === 'light')
}

async function boot() {
  if (!orca.host.has('plugin.request')) {
    resultEl.innerHTML = '<p class="err">这个 Orca 版本没有 plugin.request，无法与 worker 通信。</p>'
    return
  }
  await showSaved()
  inputEl.focus()
}

goBtn.addEventListener('click', () => { lookup(); showSaved() })
clearBtn.addEventListener('click', () => { inputEl.value = ''; inputEl.focus() })
inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); lookup(); showSaved() }
})

if (orca.on) {
  const subscription = orca.on('theme', applyTheme)
  addEventListener('pagehide', () => subscription?.dispose?.())
}

boot()
