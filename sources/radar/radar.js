/**
 * 雷达 —— 页签:订阅关系画成一张图。
 *
 * 在任务里打开:以这个任务的 agent 为中心的局部图(1–3 跳);不在任务里、或点「全部」:整张图。
 * 节点是 agent(颜色 = 它此刻的状态),边是订阅:「谁 → 盯着谁」实线、标订了哪些事;投给第三方时,
 * 再画一条「被盯的 → 收信的」虚线。刚投出的那条边闪一下,投递失败的边标红。
 * 数据只来自雷达自己的订阅文件(subs/<id>.json)、后台页的账(state.json)和 listAgents —— 不读任何会话内容。
 */
const g = window.gugu
const $ = (id) => document.getElementById(id)
const EVENT_NAMES = { failed: '出错', gone: '引擎没了', stuck: '卡住', waiting: '等人', done: '跑完' }
const STATUS_NAMES = { working: '在干活', needs_user: '等人', idle: '空闲', error: '出错' }

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
  onHover: (n, ev) => showTip(n, ev),
})

const titleOf = (agentId, saved) => agents.get(agentId)?.title ?? saved ?? agentId
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
    next[sub.id] = sub
  }
  subs = next
  agents = new Map(rows.map((row) => [row.agentId, row]))
}

/** Every edge of the whole graph, with the subscriptions behind it. */
function allEdges() {
  const edges = new Map()
  const lastBySub = new Map()
  for (const e of state?.log ?? []) lastBySub.set(e.sub, e)
  const add = (id, source, target, kind, sub) => {
    const edge = edges.get(id) ?? { id, source, target, kind, subs: [], events: new Set(), failed: false }
    edge.subs.push(sub.id)
    for (const ev of sub.events) edge.events.add(ev)
    const last = lastBySub.get(sub.id)
    // a failed delivery belongs to the edge that carries it: the 「投给」 one when it goes to a third agent
    if (last && !last.ok && (kind === 'deliver' || sub.to === sub.by)) edge.failed = true
    edges.set(id, edge)
  }
  for (const sub of Object.values(subs)) {
    add(`w:${sub.by}>${sub.target}`, sub.by, sub.target, 'watch', sub)
    if (sub.to !== sub.by) add(`d:${sub.target}>${sub.to}`, sub.target, sub.to, 'deliver', sub)
  }
  return [...edges.values()].map((e) => ({ ...e, label: e.kind === 'deliver' ? '投给' : [...e.events].map((ev) => EVENT_NAMES[ev] ?? ev).join('、') }))
}

function model() {
  let edges = allEdges()
  const center = centerId()
  let ids
  if (center) {
    // local graph: everything within `depth` hops of this task's agent, edges taken both ways
    // one hop = every agent a subscription ties it to: who it watches, who watches it, who its messages go to, whose
    // messages come to it (that last pair has no edge of its own when the watched agent is out of range, so it is
    // taken from the subscriptions, not from the drawn edges)
    const near = new Map()
    const link = (a, b) => {
      for (const [x, y] of [[a, b], [b, a]]) { if (!near.has(x)) near.set(x, new Set()); near.get(x).add(y) }
    }
    for (const sub of Object.values(subs)) { link(sub.by, sub.target); link(sub.target, sub.to); link(sub.by, sub.to) }
    ids = new Set([center])
    let frontier = [center]
    for (let d = 0; d < depth; d++) {
      const next = []
      for (const id of frontier) for (const n of near.get(id) ?? []) if (!ids.has(n)) { ids.add(n); next.push(n) }
      frontier = next
    }
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    ids.delete(center)
    ids = new Set([center, ...ids])
  } else {
    ids = new Set(edges.flatMap((e) => [e.source, e.target]))
  }
  const saved = new Map()
  for (const sub of Object.values(subs)) for (const k of ['by', 'target', 'to']) if (sub.titles?.[k]) saved.set(sub[k], sub.titles[k])
  const nodes = [...ids].map((id) => {
    const row = agents.get(id)
    return { id, label: titleOf(id, saved.get(id)), status: row?.status ?? null, detail: row?.detail ?? null, center: id === center, row }
  })
  return { nodes, edges }
}

function statusText(row) {
  if (!row) return '不在这台电脑上了'
  return `${STATUS_NAMES[row.status] ?? row.status ?? '没有状态'}${row.detail ? ` · ${row.detail}` : ''}`
}

function showTip(n, ev) {
  const tip = $('tip')
  if (!n) { tip.hidden = true; return }
  const r = $('stage').getBoundingClientRect()
  tip.replaceChildren(
    h('strong', {}, n.label),
    h('div', {}, statusText(n.row)),
    n.row?.lastActionAt ? h('div', {}, '最后一次动作 ', h('gugu-time', { datetime: n.row.lastActionAt })) : h('div', { class: 'muted' }, '最后一次动作:问不到'),
  )
  tip.style.left = `${Math.max(0, Math.min(ev.clientX - r.left + 12, r.width - 250))}px`
  tip.style.top = `${ev.clientY - r.top + 12}px`
  tip.hidden = false
}

async function unwatch(id) {
  try {
    // The person stops it: no agent stamp on this call, so 雷达's program lets them stop any subscription.
    const result = await g.callProgram('unwatch', { id })
    if (result?.isError) throw new Error(result.content?.[0]?.text ?? 'unwatch failed')
    await refresh()
  } catch (error) {
    g.reportError(`撤不掉这条订阅:${error?.message ?? error}`)
  }
}

function subLine(sub) {
  const to = sub.to !== sub.by ? ` · 投给 ${titleOf(sub.to, sub.titles?.to)}` : ''
  return h('li', {},
    h('div', {},
      h('strong', {}, `${titleOf(sub.by, sub.titles?.by)} 盯着 ${titleOf(sub.target, sub.titles?.target)}`),
      h('span', {}, `${sub.events.map((e) => EVENT_NAMES[e] ?? e).join('、')}${to}`)),
    h('button', { onclick: () => void unwatch(sub.id) }, '撤掉'))
}

function logList(entries) {
  if (entries.length === 0) return h('gugu-empty', { icon: 'bell' }, h('strong', {}, '还没投过'))
  return h('ul', { class: 'list' }, entries.map((e) =>
    h('li', {},
      h('div', {},
        h('strong', {}, `${e.targetTitle} ${EVENT_NAMES[e.event] ?? e.event} → ${titleOf(e.to, subs[e.sub]?.titles?.to)}`),
        e.ok ? h('span', {}, '投到了') : h('span', { class: 'failed' }, `没投到:${e.error}`)),
      h('gugu-time', { datetime: e.at }))))
}

function renderSide() {
  const detail = $('detail')
  const log = [...(state?.log ?? [])].reverse()
  let shownLog = log
  detail.hidden = !selected
  if (selected?.kind === 'node') {
    const row = agents.get(selected.id)
    const related = Object.values(subs).filter((s) => s.by === selected.id || s.target === selected.id || s.to === selected.id)
    detail.replaceChildren(
      h('h5', {}, titleOf(selected.id)),
      h('p', {}, statusText(row)),
      row?.lastActionAt ? h('p', {}, '最后一次动作 ', h('gugu-time', { datetime: row.lastActionAt })) : null,
      // 打开那条会话:咕咕还没给 App 这个口子(页面里点链接会被拦),先如实说。
      h('button', { disabled: true, title: '需要咕咕补一个口子:App 里点链接打开会话' }, '打开会话(需要咕咕补一个口子)'),
      related.length ? h('ul', { class: 'list' }, related.map(subLine)) : h('p', { class: 'muted' }, '没有和它有关的订阅'),
    )
    shownLog = log.filter((e) => e.target === selected.id || e.to === selected.id || subs[e.sub]?.by === selected.id)
  } else if (selected?.kind === 'edge') {
    const edge = allEdges().find((e) => e.id === selected.id)
    const list = (edge?.subs ?? []).map((id) => subs[id]).filter(Boolean)
    detail.replaceChildren(
      h('h5', {}, edge ? `${titleOf(edge.source)} → ${titleOf(edge.target)}` : '这条边不在了'),
      h('ul', { class: 'list' }, list.map(subLine)),
    )
    const ids = new Set(edge?.subs ?? [])
    shownLog = log.filter((e) => ids.has(e.sub))
  }
  $('log').replaceChildren(logList(shownLog.slice(0, 50)))
}

function renderBar() {
  const checked = $('checked')
  checked.replaceChildren()
  if (state?.checkedAt) checked.append('后台最后检查 ', h('gugu-time', { datetime: state.checkedAt }))
  else checked.append('后台还没检查过')
  const problems = []
  if (state?.error) problems.push(`后台上一轮没看成:${state.error.message}`)
  const age = state?.checkedAt ? Date.now() - Date.parse(state.checkedAt) : Infinity
  if (age > 2 * 60_000) problems.push(state?.checkedAt ? `后台已经 ${Math.floor(age / 60_000)} 分钟没检查了,它可能没在跑。` : '后台还没跑起来。')
  $('alert').hidden = problems.length === 0
  $('alert').textContent = problems.join(' ')
  $('mode-local').disabled = !ctx?.session?.agentId
  $('mode-local').setAttribute('aria-selected', String(mode === 'local'))
  $('mode-all').setAttribute('aria-selected', String(mode === 'all'))
  $('depth-box').hidden = mode !== 'local'
}

function render() {
  renderBar()
  const m = model()
  graph.update(m)
  const center = centerId()
  const empty = $('empty')
  if (center && m.edges.length === 0) {
    empty.textContent = '还没有谁在盯它,它也没在盯谁。'
    empty.hidden = false
  } else if (!center && m.nodes.length === 0) {
    empty.textContent = '还没有订阅。agent 用雷达的 watch 工具订阅别的 agent。'
    empty.hidden = false
  } else empty.hidden = true
  renderSide()
  // edges that just carried a message flash
  const fresh = (state?.log ?? []).filter((e) => e.ok && lastPulseAt !== null && e.at > lastPulseAt)
  const ids = []
  for (const e of fresh) {
    const sub = subs[e.sub]
    if (sub) ids.push(sub.to !== sub.by ? `d:${sub.target}>${sub.to}` : `w:${sub.by}>${sub.target}`)
  }
  if (ids.length) graph.pulse(ids)
  lastPulseAt = state?.log?.at(-1)?.at ?? lastPulseAt ?? ''
}

async function refresh() {
  try {
    await load()
    render()
  } catch (error) {
    $('alert').hidden = false
    $('alert').textContent = `读不了雷达的账:${error?.message ?? error}`
  }
}

$('refresh').addEventListener('click', () => {
  g.sendToBackground({ type: 'check' }).catch((error) => g.reportError(`叫不动后台:${error?.message ?? error}`))
})
$('mode-local').addEventListener('click', () => { mode = 'local'; selected = null; render(); setTimeout(() => graph.fit(), 600) })
$('mode-all').addEventListener('click', () => { mode = 'all'; selected = null; render(); setTimeout(() => graph.fit(), 600) })
$('depth').addEventListener('change', (ev) => { depth = Number(ev.target.value); render(); setTimeout(() => graph.fit(), 600) })
$('graph').addEventListener('click', (ev) => { if (ev.target === $('graph')) { selected = null; renderSide() } })

g.onBackgroundMessage((message) => {
  if (message?.type === 'state') void refresh()
})
g.onAgentsChanged(() => void refresh())
g.onContextChanged((next) => { ctx = { ...ctx, ...next }; render() })

;(async () => {
  ctx = await g.getContext()
  mode = ctx?.session?.agentId ? 'local' : 'all'
  await refresh()
  setTimeout(() => graph.fit(), 800)
  new ResizeObserver(() => graph.fit()).observe($('graph'))
  setInterval(renderBar, 30_000)
})()
