/**
 * 雷达 —— 页签:谁在关注谁,画成一张图。
 *
 * 一条线是一条提醒走的路:从被关注的 agent(事情出在它身上)指向收提醒的那一个;线上只写这条路已经送到过几次。
 * 谁订的、订到什么程度,悬停或点开时用一整句话说。在任务里打开是以这个任务为中心的局部图(1–3 层),否则是整张图。
 * 数据只来自雷达自己的订阅文件(subs/<id>.json)、后台页的账(state.json)和 listAgents —— 不读任何会话内容。
 */
import { LEVELS } from './levels.js'
import { WORDS, wordsFor } from './words.js'

const g = window.gugu
const $ = (id) => document.getElementById(id)

let W = WORDS.zh
const agoOf = (iso) => (iso ? W.ago(Math.max(0, (Date.now() - Date.parse(iso)) / 1000)) : null)
/** A failed delivery's reason, for a person. */
const whyNot = (error) => (/not an agent this App reaches/.test(error ?? '') ? W.notHere : error)

let ctx = null
let mode = 'local'
let depth = 1
let state = null
let subs = {}
let agents = new Map() // agentId -> listAgents row
let lastPulseAt = null
let selected = null // { kind: 'node' | 'edge', id }

/** A DOM element; text is always text, never markup. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'onclick') el.addEventListener('click', v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) el.append(child)
  return el
}

const graph = window.RadarGraph.create($('graph'), {
  onNodeClick: (n) => { selected = { kind: 'node', id: n.id }; renderSide() },
  onEdgeClick: (e) => { selected = { kind: 'edge', id: e.id }; renderSide() },
  onHover: (n, ev) => showTip(n ? [nodeSentence(n.id)] : null, ev),
  onEdgeHover: (e, ev) => showTip(e ? pathSentences(e) : null, ev),
})

let saved = new Map() // agentId -> its title when it was watched (an archived one is no longer listed)
const titleOf = (agentId) => agents.get(agentId)?.title ?? saved.get(agentId) ?? agentId
const centerId = () => (mode === 'local' ? ctx?.session?.agentId ?? null : null)

async function load() {
  const [rawState, files, rows] = await Promise.all([g.readData('state.json'), g.listData('subs'), g.listAgents()])
  if (rawState !== null) state = JSON.parse(rawState)
  const next = {}
  for (const { path, kind } of files) {
    if (kind !== 'file' || !path.endsWith('.json')) continue
    const raw = await g.readData(path)
    if (raw === null) continue
    const sub = JSON.parse(raw)
    // A file without a level 雷达 knows is not a relation: the background page says so and ends it. Never draw it.
    if (LEVELS[sub.level]) next[sub.id] = sub
  }
  subs = next
  agents = new Map(rows.map((row) => [row.agentId, row]))
  saved = new Map()
  for (const sub of Object.values(subs)) for (const k of ['by', 'target', 'to']) if (sub.titles?.[k]) saved.set(sub[k], sub.titles[k])
}

/* ---------- sentences ---------- */
function nodeSentence(agentId) {
  const n = titleOf(agentId)
  const row = agents.get(agentId)
  if (!row) return W.gone(n)
  if (row.status === 'working') return W.working(n, agoOf(row.lastActionAt))
  if (row.status === 'idle') return W.idle(n)
  if (row.status === 'needs_user') return W.waiting(n, W.waits[row.detail] ?? W.waitAny)
  if (row.status === 'error') {
    if (row.failure) return W.troubleWhy(n, row.failure.kind === 'start-failed' ? W.startFailed : W.engineQuit)
    return W.trouble(n)
  }
  return W.noStatus(n)
}

/** Every path a reminder can travel (who it is about → who is told), with the subscriptions and the count behind it. */
function allPaths() {
  const paths = new Map()
  for (const sub of Object.values(subs)) {
    const id = `p:${sub.target}>${sub.to}`
    const path = paths.get(id) ?? { id, source: sub.target, target: sub.to, subs: [] }
    path.subs.push(sub)
    paths.set(id, path)
  }
  return [...paths.values()].map((p) => {
    const kept = state?.paths?.[`${p.source}>${p.target}`] ?? { sent: 0, lastAt: null, failed: null }
    return { ...p, sent: kept.sent, lastAt: kept.lastAt, failed: kept.failed, label: kept.sent > 0 ? String(kept.sent) : '' }
  })
}

function pathSentences(path) {
  const lines = path.subs.map((sub) => {
    const when = W.levels[sub.level]
    return sub.by === sub.to
      ? W.watchSelf(titleOf(sub.to), titleOf(sub.target), when)
      : W.watchFor(titleOf(sub.by), titleOf(sub.to), titleOf(sub.target), when)
  })
  lines.push(path.sent > 0 ? W.sentTimes(path.sent, agoOf(path.lastAt)) : W.sentNever)
  if (path.failed) lines.push(W.lastFailed(whyNot(path.failed.error)))
  return lines
}

function includesLine(sub) {
  const events = LEVELS[sub.level]
  return W.includes + events.map((e) => (e === 'stuck' ? W.events.stuck(sub.stuckMinutes) : W.events[e])).join(W.listSep) + W.end
}

/* ---------- the graph ---------- */
function model() {
  let edges = allPaths()
  const center = centerId()
  let ids
  if (center) {
    // within `depth` steps of this task's agent, along the paths either way — and along who set a path up, so the one
    // who asked for a reminder that goes to someone else is still one step away
    const near = new Map()
    const link = (a, b) => {
      for (const [x, y] of [[a, b], [b, a]]) { if (!near.has(x)) near.set(x, new Set()); near.get(x).add(y) }
    }
    for (const sub of Object.values(subs)) { link(sub.target, sub.to); link(sub.by, sub.target) }
    ids = new Set([center])
    let frontier = [center]
    for (let d = 0; d < depth; d++) {
      const next = []
      for (const id of frontier) for (const n of near.get(id) ?? []) if (!ids.has(n)) { ids.add(n); next.push(n) }
      frontier = next
    }
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  } else {
    ids = new Set(Object.values(subs).flatMap((s) => [s.by, s.target, s.to]))
  }
  const nodes = [...ids].map((id) => {
    const row = agents.get(id)
    return { id, label: titleOf(id), status: row ? row.status : 'gone', center: id === center }
  })
  return { nodes, edges }
}

function showTip(lines, ev) {
  const tip = $('tip')
  if (!lines) { tip.hidden = true; return }
  const r = $('stage').getBoundingClientRect()
  tip.replaceChildren(...lines.map((line) => h('p', {}, line)))
  tip.style.left = `${Math.max(0, Math.min(ev.clientX - r.left + 12, r.width - 260))}px`
  tip.style.top = `${ev.clientY - r.top + 12}px`
  tip.hidden = false
}

async function unwatch(id) {
  try {
    // The person stops it: no agent stamp on this call, so 雷达's program lets them stop any of them.
    const result = await g.callProgram('unwatch', { id })
    if (result?.isError) throw new Error(result.content?.[0]?.text ?? 'unwatch failed')
    await refresh()
  } catch (error) {
    g.reportError(W.couldNot(W.stop, error?.message ?? error))
  }
}

function subLine(sub) {
  const when = W.levels[sub.level]
  const sentence = sub.by === sub.to
    ? W.watchSelf(titleOf(sub.to), titleOf(sub.target), when)
    : W.watchFor(titleOf(sub.by), titleOf(sub.to), titleOf(sub.target), when)
  return h('li', {}, h('p', { class: 'sentence' }, sentence), h('button', { onclick: () => void unwatch(sub.id) }, W.stop))
}

function logList(entries) {
  if (entries.length === 0) return h('gugu-empty', { icon: 'bell' }, h('strong', {}, W.noneYet))
  return h('ul', { class: 'list' }, entries.map((e) =>
    h('li', {},
      h('div', {},
        h('strong', {}, W.remind(`${e.targetTitle} ${W.eventDone[e.event] ?? ''}`.trim(), titleOf(e.to))),
        e.ok ? h('span', {}, W.arrived) : h('span', { class: 'failed' }, W.notArrived(whyNot(e.error)))),
      h('gugu-time', { datetime: e.at }))))
}

function renderSide() {
  const detail = $('detail')
  let log = [...(state?.log ?? [])].reverse()
  if (centerId()) {
    const on = new Set(model().nodes.map((n) => n.id))
    log = log.filter((e) => on.has(e.target) || on.has(e.to))
  }
  let shownLog = log
  detail.hidden = !selected
  if (selected?.kind === 'node') {
    const row = agents.get(selected.id)
    const related = Object.values(subs).filter((s) => s.by === selected.id || s.target === selected.id || s.to === selected.id)
    detail.replaceChildren(...[
      h('h5', {}, titleOf(selected.id)),
      h('p', {}, nodeSentence(selected.id)),
      // 打开这个任务:一条咕咕自己的链接(linkTo),人点它,咕咕打开那个任务、把雷达切到前台(gugu#7029)。
      row?.sessionId ? h('a', { id: 'open-session', class: 'button', role: 'button', href: '#' }, W.open) : null,
      related.length ? h('ul', { class: 'list' }, related.map(subLine)) : h('p', { class: 'muted' }, W.none),
    ].filter(Boolean))
    if (row?.sessionId) {
      g.linkTo({ tab: 'radar', session: row.sessionId }).then(
        (link) => { const a = $('open-session'); if (a) a.href = link },
        (error) => g.reportError(W.couldNot(W.open, error?.message ?? error)),
      )
    }
    shownLog = log.filter((e) => e.target === selected.id || e.to === selected.id || subs[e.sub]?.by === selected.id)
  } else if (selected?.kind === 'edge') {
    const path = allPaths().find((p) => p.id === selected.id)
    detail.replaceChildren(...(path
      ? [
          h('h5', {}, W.remind(titleOf(path.source), titleOf(path.target))),
          ...pathSentences(path).slice(path.subs.length).map((line) => h('p', {}, line)),
          h('ul', { class: 'list' }, path.subs.map((sub) => [subLine(sub), h('li', {}, h('p', { class: 'sentence muted' }, includesLine(sub)))]).flat()),
        ]
      : []))
    shownLog = path ? log.filter((e) => e.target === path.source && e.to === path.target) : []
  }
  $('log').replaceChildren(logList(shownLog.slice(0, 50)))
}

function renderBar() {
  const checked = $('checked')
  checked.replaceChildren()
  if (state?.checkedAt) checked.append(`${W.checked} `, h('gugu-time', { datetime: state.checkedAt }))
  else checked.append(W.notYet)
  const problems = []
  if (state?.error) problems.push(W.lastLookFailed(state.error.message))
  const age = state?.checkedAt ? Date.now() - Date.parse(state.checkedAt) : Infinity
  if (age > 2 * 60_000) problems.push(state?.checkedAt ? W.late(Math.floor(age / 60_000)) : W.notRunning)
  $('alert').hidden = problems.length === 0
  $('alert').textContent = problems.join(' ')
  $('mode-local').disabled = !ctx?.session?.agentId
  $('mode-local').setAttribute('aria-selected', String(mode === 'local'))
  $('mode-all').setAttribute('aria-selected', String(mode === 'all'))
  $('depth-box').hidden = mode !== 'local'
}

function renderWords() {
  document.documentElement.lang = W === WORDS.zh ? 'zh-CN' : 'en'
  $('title').textContent = W.title
  $('graph').setAttribute('aria-label', W.title)
  $('mode-local').textContent = W.thisTask
  $('mode-all').textContent = W.all
  $('depth-label').textContent = W.depth
  $('recent').textContent = W.recent
  for (const [id, key] of [['l-working', 'legendWorking'], ['l-waiting', 'legendWaiting'], ['l-idle', 'legendIdle'], ['l-trouble', 'legendTrouble'], ['l-path', 'legendPath']]) {
    $(id).textContent = W[key]
  }
}

function render() {
  renderBar()
  const m = model()
  graph.update(m)
  const center = centerId()
  const empty = $('empty')
  if (center && m.edges.length === 0 && m.nodes.length <= 1) {
    empty.textContent = W.emptyLocal
    empty.hidden = false
  } else if (!center && m.nodes.length === 0) {
    empty.textContent = W.emptyAll
    empty.hidden = false
  } else empty.hidden = true
  renderSide()
  // a path that just carried a reminder flashes
  const fresh = (state?.log ?? []).filter((e) => e.ok && lastPulseAt !== null && e.at > lastPulseAt)
  if (fresh.length) graph.pulse(fresh.map((e) => `p:${e.target}>${e.to}`))
  lastPulseAt = state?.log?.at(-1)?.at ?? lastPulseAt ?? ''
}

async function refresh() {
  try {
    await load()
    render()
  } catch (error) {
    $('alert').hidden = false
    $('alert').textContent = W.couldNot(W.title, error?.message ?? error)
  }
}

$('refresh').addEventListener('click', () => {
  g.sendToBackground({ type: 'check' }).catch((error) => g.reportError(W.couldNot(W.title, error?.message ?? error)))
})
$('mode-local').addEventListener('click', () => { mode = 'local'; selected = null; render(); setTimeout(() => graph.fit(), 600) })
$('mode-all').addEventListener('click', () => { mode = 'all'; selected = null; render(); setTimeout(() => graph.fit(), 600) })
$('depth').addEventListener('change', (ev) => { depth = Number(ev.target.value); render(); setTimeout(() => graph.fit(), 600) })
$('graph').addEventListener('click', (ev) => { if (ev.target === $('graph')) { selected = null; renderSide() } })

g.onBackgroundMessage((message) => {
  if (message?.type === 'state') void refresh()
})
g.onAgentsChanged(() => void refresh())
g.onContextChanged((next) => {
  ctx = { ...ctx, ...next }
  W = wordsFor(ctx?.locale)
  renderWords()
  render()
})

;(async () => {
  ctx = await g.getContext()
  W = wordsFor(ctx?.locale)
  renderWords()
  mode = ctx?.session?.agentId ? 'local' : 'all'
  await refresh()
  setTimeout(() => graph.fit(), 800)
  new ResizeObserver(() => graph.fit()).observe($('graph'))
  setInterval(renderBar, 30_000)
})()
