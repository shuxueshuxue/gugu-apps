// A month, one marker per day, and the chosen day's to-dos and memories.
// Read one month's daily files through the same program agents use.
(function () {
  const api = window.gugu
  const $ = (id) => document.getElementById(id)

  function el(tag, props, ...kids) {
    const n = document.createElement(tag)
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue
        if (k === 'class') n.className = v
        else if (k === 'text') n.textContent = v
        else n.setAttribute(k, v === true ? '' : String(v))
      }
    }
    for (const c of kids) if (c != null) n.append(c)
    return n
  }

  const pad = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const dateOf = (k) => {
    const [y, m, d] = k.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  // ---- words ----------------------------------------------------------------
  let en = false
  const W = {
    zh: {
      weekdays: ['一', '二', '三', '四', '五', '六', '日'],
      week: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      month: (y, m) => `${y}年${m + 1}月`,
      prev: '上个月', next: '下个月',
      day: (d) => `${d.getMonth() + 1}月${d.getDate()}日 ${W.zh.week[d.getDay()]}`,
      rel: { '-1': '昨天', '0': '今天', '1': '明天' },
      todo: '待办', memory: '记事',
      empty: '这一天还没有记录',
      add: '加一条待办，回车',
      del: '删掉', toggle: '勾选', jump: '去记下它的任务',
      readFail: (m) => `读不到日历：${m}`,
      saveFail: (m) => `没存上：${m}`,
      jumpGone: '任务列表里找不到记下它的那个任务了',
      jumpFail: (m) => `去不了那个任务：${m}`,
    },
    en: {
      weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      month: (y, m) => new Date(y, m, 1).toLocaleDateString('en', { year: 'numeric', month: 'long' }),
      prev: 'Previous month', next: 'Next month',
      day: (d) => d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
      rel: { '-1': 'Yesterday', '0': 'Today', '1': 'Tomorrow' },
      todo: 'TO DO', memory: 'MEMORY',
      empty: 'Nothing recorded this day',
      add: 'Add a to-do, press Enter',
      del: 'Delete', toggle: 'Toggle', jump: 'Go to the task that recorded it',
      readFail: (m) => `Could not read the calendar: ${m}`,
      saveFail: (m) => `Not saved: ${m}`,
      jumpGone: 'The task that recorded it is not in your task list any more',
      jumpFail: (m) => `Could not go to that task: ${m}`,
    },
  }
  const t = () => (en ? W.en : W.zh)

  // ---- state ----------------------------------------------------------------
  const now = new Date()
  let view = { y: now.getFullYear(), m: now.getMonth() }
  let selected = keyOf(now)
  let days = {}
  let raw
  let rawOk = true
  // Whether this page is on screen (gugu's layout.visible: a hidden App page still reads its document as visible).
  let shown = true
  // What the bar says: a read error goes once a read succeeds, a save error once a change does.
  let errKind = null

  function showErr(msg, kind) {
    errKind = msg ? kind : null
    $('err').hidden = !msg
    $('err').textContent = msg || ''
  }

  let loading = 0
  async function load() {
    const request = ++loading
    const month = `${view.y}-${pad(view.m + 1)}`
    let next
    try {
      const res = await api.callProgram('month', { month })
      const text = (res.content || []).map((c) => c.text || '').join('')
      if (res.isError) throw new Error(text || 'month failed')
      next = text
      if (request !== loading || month !== `${view.y}-${pad(view.m + 1)}`) return false
    } catch (e) {
      showErr(t().readFail((e && e.message) || String(e)), 'read')
      return false
    }
    if (errKind === 'jump') showErr('')
    if (next === raw) {
      if (errKind === 'read' && rawOk) showErr('')
      return false
    }
    raw = next
    try {
      const v = next ? JSON.parse(next) : null
      days = (v && v.days) || {}
    } catch (e) {
      rawOk = false
      showErr(t().readFail(`calendar: ${e.message}`), 'read')
      return false
    }
    rawOk = true
    if (errKind === 'read') showErr('')
    return true
  }

  // Every change goes through the App's own program, the one writer of daily files, so an agent's
  // record landing at the same moment is never overwritten by this page's copy.
  async function change(tool, args) {
    try {
      const res = await api.callProgram(tool, args)
      if (res && res.isError) {
        const text = (res.content || []).map((c) => c.text || '').join(' ').trim()
        throw new Error(text || tool)
      }
      if (errKind === 'save') showErr('')
    } catch (e) {
      showErr(t().saveFail((e && e.message) || String(e)), 'save')
      // The page already showed the change; draw the file as it is instead.
      raw = undefined
    }
    if (await load()) render()
  }

  // An agent's entry knows its session: a click takes the person there, as a click on it in the task list would.
  const canJump = (e) => !!e.session && typeof api.showSession === 'function'
  function jump(e) {
    api.showSession(e.session).then(() => { if (errKind === 'jump') showErr('') }, (err) => {
      showErr(err && err.code === 'not-found' ? t().jumpGone : t().jumpFail((err && err.message) || String(err)), 'jump')
    })
  }
  function jumpButton(e) {
    const b = el('button', { type: 'button', class: 'jump', 'aria-label': t().jump, title: t().jump }, el('gugu-icon', { name: 'arrow-up-right' }))
    b.addEventListener('click', () => jump(e))
    return b
  }

  // Pending to-dos: a ring. All to-dos done: a filled dot. Only memories: a dot of their own colour.
  function markerOf(list) {
    if (!list || !list.length) return null
    const todos = list.filter((e) => e.kind === 'todo')
    if (todos.length) return todos.some((e) => !e.done) ? 'pending' : 'done'
    return 'memory'
  }

  // ---- render ---------------------------------------------------------------
  function renderMonth() {
    $('month').textContent = t().month(view.y, view.m)
    $('prev').setAttribute('aria-label', t().prev)
    $('next').setAttribute('aria-label', t().next)
    $('weekdays').replaceChildren(...t().weekdays.map((w) => el('span', { text: w })))
    const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
    const length = new Date(view.y, view.m + 1, 0).getDate()
    const today = keyOf(new Date())
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'blank' }))
    for (let d = 1; d <= length; d++) {
      const k = `${view.y}-${pad(view.m + 1)}-${pad(d)}`
      const marker = markerOf(days[k])
      const cls = ['cell']
      if (k === selected) cls.push('selected')
      if (k === today) cls.push('today')
      const b = el('button', { type: 'button', class: cls.join(' '), 'aria-pressed': k === selected ? 'true' : 'false', 'data-day': k },
        el('span', { class: 'num', text: String(d) }),
        el('span', { class: 'marker' }, marker ? el('i', { class: `dot ${marker}` }) : null))
      b.addEventListener('click', () => select(k))
      cells.push(b)
    }
    $('grid').replaceChildren(...cells)
  }

  function renderDay() {
    const d = dateOf(selected)
    const t0 = new Date()
    const diff = Math.round((d - new Date(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 864e5)
    $('day-title').textContent = t().day(d)
    $('day-sub').textContent = t().rel[String(diff)] || ''
    $('todo-label').textContent = t().todo
    $('memory-label').textContent = t().memory
    $('add-input').placeholder = t().add

    const list = days[selected] || []
    const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.at || 0) - (b.at || 0)
    const todos = list.filter((e) => e.kind === 'todo').sort(byTime)
    const memories = list.filter((e) => e.kind !== 'todo').sort(byTime)

    $('todo-sec').hidden = !todos.length
    $('todos').replaceChildren(...todos.map((e) => {
      const row = el('div', { class: e.done ? 'todo done' : 'todo' })
      const toggle = el('button', { type: 'button', class: 'todo-main', 'aria-pressed': e.done ? 'true' : 'false', 'aria-label': t().toggle },
        el('span', { class: 'mark' }, e.done ? el('gugu-icon', { name: 'check' }) : null),
        el('span', { class: 'title', text: e.title }),
        e.time ? el('small', { class: 'time', text: e.time }) : null)
      toggle.addEventListener('click', () => {
        e.done = !e.done
        render()
        change('set_done', { date: selected, id: e.id, done: e.done })
      })
      row.append(toggle)
      if (canJump(e)) row.append(jumpButton(e))
      row.append(delButton(e))
      return row
    }))

    $('memory-sec').hidden = !memories.length
    $('memories').replaceChildren(...memories.map((e) => {
      const tags = Array.isArray(e.tags) ? e.tags : []
      const jumps = canJump(e)
      // A memory has no click of its own: an agent's is one button, the whole line, to the task that recorded it.
      const body = el(jumps ? 'button' : 'div', jumps ? { type: 'button', class: 'memory-body jumps', title: t().jump } : { class: 'memory-body' },
        el('span', { class: 'memory-line' },
          el('span', { class: 'bullet' }, el('i')),
          el('span', { class: 'title', text: e.title }),
          e.time ? el('small', { class: 'time', text: e.time }) : null,
          jumps ? el('gugu-icon', { class: 'go', name: 'arrow-up-right' }) : null),
        tags.length || e.detail
          ? el('span', { class: 'memory-more' },
            ...tags.map((tag) => el('em', { class: 'tag', text: tag })),
            e.detail ? el('small', { class: 'detail', text: e.detail }) : null)
          : null)
      if (jumps) body.addEventListener('click', () => jump(e))
      return el('div', { class: 'memory' }, body, delButton(e))
    }))

    $('empty').hidden = !!list.length
    $('empty').textContent = t().empty
  }

  function delButton(e) {
    const b = el('button', { type: 'button', class: 'del', 'aria-label': t().del }, el('gugu-icon', { name: 'x' }))
    b.addEventListener('click', () => {
      const day = selected
      days[day] = (days[day] || []).filter((x) => x.id !== e.id)
      if (!days[day].length) delete days[day]
      render()
      change('remove', { date: day, id: e.id })
    })
    return b
  }

  function render() {
    // Browsing another month must not show the previously selected day under it.
    if (!selected.startsWith(`${view.y}-${pad(view.m + 1)}-`)) selected = `${view.y}-${pad(view.m + 1)}-01`
    renderMonth()
    renderDay()
  }

  function select(k) {
    selected = k
    const d = dateOf(k)
    view = { y: d.getFullYear(), m: d.getMonth() }
    days = {}; raw = undefined
    render()
    load().then((changed) => { if (changed) render() })
  }

  // ---- wiring ---------------------------------------------------------------
  $('prev').addEventListener('click', () => {
    const d = new Date(view.y, view.m - 1, 1)
    select(keyOf(d))
  })
  $('next').addEventListener('click', () => {
    const d = new Date(view.y, view.m + 1, 1)
    select(keyOf(d))
  })
  $('month').addEventListener('click', () => select(keyOf(new Date())))
  $('add').addEventListener('submit', (ev) => {
    ev.preventDefault()
    const input = $('add-input')
    const title = input.value.trim()
    if (!title) return
    input.value = ''
    change('record', { kind: 'todo', title, date: selected })
  })

  // Coming back on screen reads at once: what an agent recorded meanwhile shows without waiting for the next tick.
  function noteLayout(ctx) {
    const was = shown
    shown = !(ctx && ctx.layout && ctx.layout.visible === false)
    if (shown && !was) load().then((changed) => { if (changed) render() })
  }

  async function start() {
    try {
      const ctx = await api.getContext()
      en = !!(ctx && ctx.locale && /^en/i.test(ctx.locale))
      noteLayout(ctx)
    } catch (e) {
      showErr(`getContext: ${(e && e.message) || e}`, 'context')
    }
    if (typeof api.onContextChanged === 'function') {
      api.onContextChanged((next) => {
        if (next && errKind === 'context') showErr('')
        noteLayout(next)
        if (!next || !next.locale) return
        const was = en
        en = /^en/i.test(next.locale)
        if (was !== en) render()
      })
    }
    await load()
    render()
    // Agents write through the `record` tool at any time; pick it up while the panel is on screen.
    setInterval(async () => {
      if (!shown || document.visibilityState === 'hidden') return
      if (await load()) render()
    }, 3000)
    // A new day moves "today" along.
    let today = keyOf(new Date())
    setInterval(() => {
      const k = keyOf(new Date())
      if (k === today) return
      if (selected === today) selected = k
      today = k
      render()
    }, 60 * 1000)
  }
  start()
})()
