/**
 * 雷达 —— 页签:谁在盯谁、最近投了什么、投没投到、后台最后一次检查是什么时候。
 * 状态全在后台页的账里(state.json)与订阅文件(subs/<id>.json,一条一个);这里只画,外加「撤掉」一条订阅(经雷达自己的程序删那个文件)。
 */
const g = window.gugu
const $ = (id) => document.getElementById(id)

let state = null
let subs = {}
let agents = []

const EVENT_NAMES = { failed: '出错', gone: '引擎没了', stuck: '卡住', waiting: '等人', done: '跑完' }

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

/** Its title now, else the one saved when it was watched (an archived session is no longer listed). */
const titleOf = (agentId, saved) => agents.find((a) => a.agentId === agentId)?.title ?? saved ?? agentId
const statusOf = (agentId) => {
  const a = agents.find((row) => row.agentId === agentId)
  if (!a) return '不在这台电脑上'
  return a.detail ? `${a.status ?? '没有状态'} / ${a.detail}` : a.status ?? '没有状态'
}

async function load() {
  const [rawState, files, rawAgents] = await Promise.all([g.readData('state.json'), g.listData('subs'), g.readData('agents.json')])
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
  agents = rawAgents === null ? [] : JSON.parse(rawAgents).agents ?? []
}

async function unwatch(id) {
  try {
    // The person stops it: no agent stamp on this call, so 雷达's program lets them stop any subscription.
    const result = await g.callProgram('unwatch', { id })
    if (result?.isError) throw new Error(result.content?.[0]?.text ?? 'unwatch failed')
    await load()
    render()
  } catch (error) {
    g.reportError(`撤不掉这条订阅:${error?.message ?? error}`)
  }
}

function render() {
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

  const rows = Object.values(subs)
  $('subs').replaceChildren(
    rows.length === 0
      ? h('gugu-empty', { icon: 'radar' }, h('strong', {}, '还没有订阅'), h('small', {}, 'agent 用 radar 的 watch 工具订阅别的 agent'))
      : h('ul', { class: 'list' }, rows.map((s) => {
          return h('li', {},
            h('div', {},
              h('strong', {}, `${titleOf(s.by, s.titles?.by)} 盯着 ${titleOf(s.target, s.titles?.target)}`),
              h('span', {}, `${s.events.map((e) => EVENT_NAMES[e] ?? e).join('、')}${s.to !== s.by ? ` · 投给 ${titleOf(s.to, s.titles?.to)}` : ''} · 现在 ${statusOf(s.target)}`)),
            h('button', { onclick: () => void unwatch(s.id) }, '撤掉'))
        })),
  )

  const ended = [...(state?.ended ?? [])].reverse().slice(0, 10)
  $('ended').hidden = ended.length === 0
  $('ended').replaceChildren(
    h('h5', {}, '已结束的订阅'),
    h('ul', { class: 'list' }, ended.map((e) => h('li', {}, h('div', {}, h('strong', {}, `盯着 ${e.target}`), h('span', {}, e.why)), h('gugu-time', { datetime: e.at })))),
  )

  const log = [...(state?.log ?? [])].reverse().slice(0, 50)
  $('log').replaceChildren(
    log.length === 0
      ? h('gugu-empty', { icon: 'bell' }, h('strong', {}, '还没投过'))
      : h('ul', { class: 'list' }, log.map((e) =>
          h('li', {},
            h('div', {},
              h('strong', {}, `${e.targetTitle} ${EVENT_NAMES[e.event] ?? e.event} → ${titleOf(e.to, subs[e.sub]?.titles?.to)}`),
              e.ok ? h('span', {}, '投到了') : h('span', { class: 'failed' }, `没投到:${e.error}`)),
            h('gugu-time', { datetime: e.at })))),
  )
}

$('refresh').addEventListener('click', () => {
  g.sendToBackground({ type: 'check' }).catch((error) => g.reportError(`叫不动后台:${error?.message ?? error}`))
})

g.onBackgroundMessage((message) => {
  if (message?.type !== 'state') return
  state = message.state
  load().then(render, (error) => g.reportError(`读不了订阅表:${error?.message ?? error}`))
})

load().then(render, (error) => {
  $('alert').hidden = false
  $('alert').textContent = `读不了雷达的账:${error?.message ?? error}`
})
setInterval(render, 30_000)
