/**
 * 雷达 —— 页签:谁在关注谁,画成一张图。
 *
 * 一条线是一条提醒走的路:从被关注的 agent(事情出在它身上)指向收提醒的那一个;线上只写这条路已经送到过几次。
 * 谁订的、订到什么程度,悬停或点开时用一整句话说。在任务里打开是以这个任务为中心的局部图(1–3 层),否则是整张图。
 * 数据只来自雷达自己的订阅文件(subs/<id>.json)、后台页的账(state.json)和 listAgents —— 不读任何会话内容。
 */
import { LEVELS } from './levels.js'

const g = window.gugu
const $ = (id) => document.getElementById(id)

/* ---------- words: a person's, in their language ---------- */
const WORDS = {
  zh: {
    title: '雷达', thisTask: '这个任务', all: '全部', depth: '看几层',
    checked: '后台上次查看', notYet: '后台还没查看过',
    late: (m) => `后台已经 ${m} 分钟没查看了，可能没在运行。`, notRunning: '后台还没运行起来。', lastLookFailed: (m) => `后台上一次查看没成功：${m}`,
    legendWorking: '在干活', legendWaiting: '等你批准', legendIdle: '闲着', legendTrouble: '出问题了', legendPath: '提醒的方向，数字是已提醒的次数',
    recent: '最近的提醒', noneYet: '还没提醒过', arrived: '送到了', notArrived: (why) => `没送到：${why}`,
    emptyLocal: '还没有谁在关注它，它也没在关注谁。', emptyAll: '还没有谁在关注谁。agent 用雷达的 watch 工具关注别的 agent。',
    remind: (target, to) => `${target} 的事 → 提醒 ${to}`,
    stop: '不再关注', open: '打开这个任务', none: '没有和它有关的关注。',
    couldNot: (what, m) => `${what}没成功：${m}`,
    // node sentences
    working: (n, ago) => (ago ? `${n} 正在干活，${ago}刚动过。` : `${n} 正在干活。`),
    idle: (n) => `${n} 闲着。`, waiting: (n, what) => `${n} 在等你${what}。`, trouble: (n) => `${n} 出问题了。`,
    troubleWhy: (n, why) => `${n} 出问题了：${why}。`, gone: (n) => `${n} 不在了。`, noStatus: (n) => `${n} 现在的状态看不到。`,
    waits: { approval: '批准一个操作', question: '回答一个问题', plan: '看一份计划', dialog: '处理一个对话框' }, waitAny: '处理一件事',
    engineQuit: '它的引擎意外退出了', startFailed: '它没能启动起来',
    // edge sentences
    levels: { trouble: '出问题时', needs_you: '出问题或者需要你批准时', everything: '有任何动静时' },
    watchSelf: (to, target, when) => `${to} 在关注 ${target}：${target}${when}会提醒 ${to}。`,
    watchFor: (by, to, target, when) => `${by} 让 ${to} 在 ${target}${when}收到提醒。`,
    sentTimes: (n, ago) => `已提醒 ${n} 次，最近一次${ago}。`, sentNever: '还没提醒过。',
    lastFailed: (why) => `上一次没送到：${why}。`,
    includes: '具体包括：', listSep: '、', end: '。',
    events: { failed: '停下来报错', gone: '不在了（引擎退出、任务被归档或删除）', stuck: (m) => `很久没动静（${m} 分钟没有新动作）`, waiting: '在等人批准或回答', done: '做完一轮' },
    eventDone: { failed: '停下来报错了', gone: '不在了', stuck: '好像卡住了', waiting: '在等人', done: '做完了' },
    notHere: '收提醒的那个任务已经不在这台电脑上了',
    ago: (s) => (s < 60 ? '刚刚' : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 86400)} 天前`),
  },
  en: {
    title: 'Radar', thisTask: 'This task', all: 'Everyone', depth: 'Reach',
    checked: 'Last looked', notYet: 'Not looked yet',
    late: (m) => `It has not looked for ${m} minutes; it may not be running.`, notRunning: 'It is not running yet.', lastLookFailed: (m) => `Its last look did not work: ${m}`,
    legendWorking: 'Working', legendWaiting: 'Waiting for you', legendIdle: 'Idle', legendTrouble: 'In trouble', legendPath: 'Where reminders go; the number is how many went',
    recent: 'Recent reminders', noneYet: 'No reminders yet', arrived: 'Arrived', notArrived: (why) => `Did not arrive: ${why}`,
    emptyLocal: 'Nobody keeps an eye on it, and it keeps an eye on nobody.', emptyAll: 'Nobody keeps an eye on anyone yet. Agents use Radar\'s watch tool for that.',
    remind: (target, to) => `${target} → tell ${to}`,
    stop: 'Stop', open: 'Open this task', none: 'Nothing involves it.',
    couldNot: (what, m) => `${what} did not work: ${m}`,
    working: (n, ago) => (ago ? `${n} is working; it last did something ${ago}.` : `${n} is working.`),
    idle: (n) => `${n} is idle.`, waiting: (n, what) => `${n} is waiting for you to ${what}.`, trouble: (n) => `${n} is in trouble.`,
    troubleWhy: (n, why) => `${n} is in trouble: ${why}.`, gone: (n) => `${n} is gone.`, noStatus: (n) => `${n}'s state cannot be seen.`,
    waits: { approval: 'approve something', question: 'answer a question', plan: 'look at a plan', dialog: 'deal with a dialog' }, waitAny: 'do something',
    engineQuit: 'its engine quit unexpectedly', startFailed: 'it could not start',
    levels: { trouble: 'is in trouble', needs_you: 'is in trouble or needs you', everything: 'does anything' },
    watchSelf: (to, target, when) => `${to} keeps an eye on ${target}: when ${target} ${when}, ${to} is told.`,
    watchFor: (by, to, target, when) => `${by} has ${to} told when ${target} ${when}.`,
    sentTimes: (n, ago) => `Told ${n} time${n === 1 ? '' : 's'}, last ${ago}.`, sentNever: 'Not told yet.',
    lastFailed: (why) => `The last one did not arrive: ${why}.`,
    includes: 'That covers: ', listSep: ', ', end: '.',
    events: { failed: 'stopping with an error', gone: 'being gone (its engine quit, or its task was archived or deleted)', stuck: (m) => `going quiet (nothing new for ${m} minutes)`, waiting: 'waiting for someone to approve or answer', done: 'finishing a round' },
    eventDone: { failed: 'stopped with an error', gone: 'is gone', stuck: 'seems stuck', waiting: 'is waiting', done: 'finished' },
    notHere: 'the task to tell is no longer on this computer',
    ago: (s) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`),
  },
}
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
    next[sub.id] = sub
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
    const when = W.levels[sub.level] ?? W.levels.trouble
    return sub.by === sub.to
      ? W.watchSelf(titleOf(sub.to), titleOf(sub.target), when)
      : W.watchFor(titleOf(sub.by), titleOf(sub.to), titleOf(sub.target), when)
  })
  lines.push(path.sent > 0 ? W.sentTimes(path.sent, agoOf(path.lastAt)) : W.sentNever)
  if (path.failed) lines.push(W.lastFailed(whyNot(path.failed.error)))
  return lines
}

function includesLine(sub) {
  const events = LEVELS[sub.level] ?? LEVELS.trouble
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
  const when = W.levels[sub.level] ?? W.levels.trouble
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
  W = String(ctx?.locale ?? 'zh').startsWith('zh') ? WORDS.zh : WORDS.en
  renderWords()
  render()
})

;(async () => {
  ctx = await g.getContext()
  W = String(ctx?.locale ?? 'zh').startsWith('zh') ? WORDS.zh : WORDS.en
  renderWords()
  mode = ctx?.session?.agentId ? 'local' : 'all'
  await refresh()
  setTimeout(() => graph.fit(), 800)
  new ResizeObserver(() => graph.fit()).observe($('graph'))
  setInterval(renderBar, 30_000)
})()
