const $ = (sel) => document.querySelector(sel)

let me = { authed: false, configured: false }
let shopsCache = []

// ---------- utils ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data
}

function toast(msg, type = '') {
  const el = $('#toast') || Object.assign(document.createElement('div'), { id: 'toast' })
  if (!el.isConnected) document.body.appendChild(el)
  el.textContent = msg
  el.className = `show ${type}`
  clearTimeout(el._t)
  el._t = setTimeout(() => (el.className = ''), 3500)
}

const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0))

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// ---------- auth ----------

async function checkAuth() {
  me = await api('/api/auth?action=status')
  if (me.authed) showApp()
  else {
    $('#auth-screen').hidden = false
    if (!me.configured) {
      $('#auth-error').textContent = 'ADMIN_PASSWORD не задан в настройках Vercel'
    }
  }
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/api/auth', { method: 'POST', body: { password: $('#auth-password').value } })
    $('#auth-screen').hidden = true
    showApp()
  } catch (err) {
    $('#auth-error').textContent = err.message
  }
})

$('#logout-btn').addEventListener('click', () =>
  api('/api/auth?action=logout', { method: 'POST' }).then(() => location.reload()),
)

function showApp() {
  $('#auth-screen').hidden = true
  $('#app-screen').hidden = false
  loadShops()
  loadFeedbacks()
}

// ---------- tabs ----------

document.querySelectorAll('nav button[data-tab]').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button[data-tab]').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('main section').forEach((s) => (s.hidden = true))
    $(`#tab-${btn.dataset.tab}`).hidden = false
  }),
)

// ---------- shops ----------

async function loadShops() {
  try {
    shopsCache = await api('/api/shops')
    renderShops()
    renderShopFilter()
  } catch (err) {
    if (err.message.includes('Не авторизован')) location.reload()
  }
}

function renderShops() {
  const el = $('#shops-list')
  el.innerHTML = ''
  if (shopsCache.length === 0) {
    el.innerHTML = `<div class="empty"><span class="icon">🏪</span>Магазинов пока нет.<br>Добавьте первый выше — понадобится WB API токен.</div>`
    return
  }
  const modeNames = { templates: 'Шаблоны', llm: 'LLM' }
  for (const s of shopsCache) {
    const card = document.createElement('div')
    card.className = 'card shop-card'
    card.innerHTML = `
      <div class="shop-info">
        <strong>${esc(s.name)}</strong>
        <span class="badge">${modeNames[s.mode] || s.mode}</span>
        ${s.enabled ? '' : '<span class="badge off">выключен</span>'}
        <div class="meta">токен: ${esc(s.tokenMask)}</div>
      </div>
      <div class="shop-actions">
        <select class="mode-select" data-id="${s.id}">
          <option value="templates" ${s.mode === 'templates' ? 'selected' : ''}>Шаблоны</option>
          <option value="llm" ${s.mode === 'llm' ? 'selected' : ''}>LLM</option>
        </select>
        <button class="ghost toggle" data-id="${s.id}">${s.enabled ? 'Выключить' : 'Включить'}</button>
        <button class="danger del" data-id="${s.id}" data-name="${esc(s.name)}">Удалить</button>
      </div>`
    card.querySelector('.mode-select').addEventListener('change', async (e) => {
      try {
        await api('/api/shops-action', { method: 'POST', body: { id: s.id, action: 'mode', mode: e.target.value } })
        toast('Режим обновлён', 'ok')
        loadShops()
      } catch (err) { toast(err.message, 'error') }
    })
    card.querySelector('.toggle').addEventListener('click', async () => {
      try {
        await api('/api/shops-action', { method: 'POST', body: { id: s.id, action: 'toggle', enabled: !s.enabled } })
        loadShops()
      } catch (err) { toast(err.message, 'error') }
    })
    card.querySelector('.del').addEventListener('click', async (e) => {
      if (!confirm(`Удалить магазин «${e.target.dataset.name}»? История его отзывов тоже удалится.`)) return
      try {
        await api('/api/shops-action', { method: 'POST', body: { id: s.id, action: 'delete' } })
        toast('Магазин удалён', 'ok')
        loadShops()
        loadFeedbacks()
      } catch (err) { toast(err.message, 'error') }
    })
    el.appendChild(card)
  }
}

function renderShopFilter() {
  const sel = $('#filter-shop')
  const current = sel.value
  sel.innerHTML = '<option value="">Все магазины</option>' +
    shopsCache.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  sel.value = current
}

$('#shop-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const msg = $('#shop-msg')
  msg.textContent = 'Проверяю токен…'
  msg.className = 'hint'
  try {
    await api('/api/shops-add', {
      method: 'POST',
      body: {
        name: $('#shop-name').value.trim(),
        token: $('#shop-token').value.trim(),
        mode: $('#shop-mode').value,
      },
    })
    e.target.reset()
    msg.textContent = 'Магазин добавлен ✓'
    msg.className = 'hint ok'
    loadShops()
  } catch (err) {
    msg.textContent = err.message
    msg.className = 'hint error'
  }
})

// ---------- feedbacks ----------

async function loadFeedbacks() {
  const shopId = $('#filter-shop').value
  const status = $('#filter-status').value
  const params = new URLSearchParams()
  if (shopId) params.set('shop_id', shopId)
  if (status) params.set('status', status)
  try {
    const list = await api(`/api/feedbacks?${params}`)
    renderFeedbacks(list)
  } catch (err) {
    if (err.message.includes('Не авторизован')) location.reload()
  }
}

function renderFeedbacks(list) {
  const el = $('#feedbacks-list')
  el.innerHTML = ''
  if (list.length === 0) {
    el.innerHTML = `<div class="empty"><span class="icon">💬</span>Пока нет обработанных отзывов.<br>Они появятся после первого запуска бота (кнопка «Запустить сейчас» или ежедневно в 10:00 МСК).</div>`
    return
  }
  for (const fb of list) {
    const card = document.createElement('div')
    card.className = 'card'
    const answerHtml = fb.answer
      ? `<div class="fb-answer"><span class="label">Ответ бота (${fb.source === 'template' ? 'шаблон' : 'LLM'})</span>${esc(fb.answer)}</div>`
      : ''
    const errorHtml = fb.error
      ? `<div class="fb-error">⚠️ ${esc(fb.error)}</div>`
      : ''
    card.innerHTML = `
      <div class="fb-head">
        <span class="stars">${stars(fb.rating)}</span>
        <span class="fb-product">${esc(fb.product_name || 'Товар')}</span>
        <span class="fb-shop">${esc(fb.shop_name || '')}</span>
        <span class="fb-date">${fmtDate(fb.processed_at)}</span>
      </div>
      <div class="fb-text">${esc(fb.text || '(отзыв без текста)')}</div>
      ${answerHtml}
      ${errorHtml}
    `
    el.appendChild(card)
  }
}

$('#filter-shop').addEventListener('change', loadFeedbacks)
$('#filter-status').addEventListener('change', loadFeedbacks)
$('#refresh-btn').addEventListener('click', () => { loadShops(); loadFeedbacks() })

$('#run-now-btn').addEventListener('click', async (e) => {
  const btn = e.target
  btn.disabled = true
  btn.textContent = 'Запускаю…'
  try {
    const r = await api('/api/cron-run', { method: 'POST' })
    toast(`Готово: отвечено ${r.answered}, ошибок ${r.failed}`, r.failed ? 'error' : 'ok')
    loadFeedbacks()
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Запустить сейчас'
  }
})

// ---------- init ----------

checkAuth()
