/**
 * 雷达 —— 后台页:盯着这台电脑上的 agent,订阅的事一发生就投一条消息给订阅者。
 *
 * 订阅在 subs.json(agent 用 watch / unwatch 写,页签上「撤掉」也写);这里只读它。
 * 自己的账在 state.json:每个 agent 上次看到的状态、每条订阅已经投过哪些事、结束了的订阅、投递记录。
 * agents.json 是给工具看的「这台电脑上有哪些 agent」,每次有变化就重写。
 *
 * 一件事只投一次:同一条订阅的同一件事,要等被盯的 agent 下一次开始干活(转成 working)才会再投。
 */

const TICK_MS = 30_000
const LOG_MAX = 200
const g = window.gugu

let state = { version: 1, checkedAt: null, last: {}, fired: {}, ended: {}, log: [], error: null }
let agentsJson = ''
let firstLook = true

const nowIso = () => new Date().toISOString()

async function load() {
  const raw = await g.readData('state.json')
  if (raw === null) return
  const saved = JSON.parse(raw)
  if (saved.version !== 1) throw new Error(`state.json is version ${saved.version}; this build reads 1`)
  state = { ...state, ...saved }
}

async function readSubs() {
  const raw = await g.readData('subs.json')
  if (raw === null) return {}
  return JSON.parse(raw).subs ?? {}
}

const WAITS = { approval: '批准一个操作', question: '回答一个问题', plan: '看一份计划', dialog: '处理一个对话框' }

function name(row) {
  return `${row.title}(session:${row.sessionId})`
}

/** What the agent said last, for a 「跑完了」: an MCP that went deaf still leaves its conclusion here. */
async function lastWords(agentId) {
  try {
    const page = await g.readAgentHistory(agentId)
    const said = [...page.messages].reverse().find((m) => m.sender !== 'user' && m.text?.trim())
    if (!said) return '\n(这一页里它没有说话。)'
    const text = said.text.trim()
    return `\n它最后说:\n${text.length > 1500 ? `${text.slice(0, 1500)}…(截断,全文在它的会话里)` : text}`
  } catch (error) {
    return `\n(读不到它最后说的话:${error?.message ?? error})`
  }
}

async function describe(event, row, sub, extra) {
  if (event === 'failed') return `雷达:${name(row)} 这一轮出错停下了。`
  if (event === 'gone') {
    if (!row.sessionId) return `雷达:${row.title} 不在了(会话被归档或删除)。`
    const why = row.failure ? `${row.failure.message}${row.failure.signal ? `(信号 ${row.failure.signal})` : ''}` : '原因没读到'
    return `雷达:${name(row)} 的引擎没了:${why}。`
  }
  if (event === 'stuck') return `雷达:${name(row)} 还在 working,但已经 ${extra} 分钟没有新的工具调用了。`
  if (event === 'waiting') return `雷达:${name(row)} 在等人${row.detail && WAITS[row.detail] ? `${WAITS[row.detail]}` : ''}。`
  return `雷达:${name(row)} 这一轮跑完了。${await lastWords(row.agentId)}`
}

async function fire(sub, event, row, extra) {
  const fired = (state.fired[sub.id] ??= {})
  if (fired[event]) return
  fired[event] = true
  const text = `${await describe(event, row, sub, extra)}\n(订阅 ${sub.id};这条不用回。不想再收:unwatch ${sub.id})`
  const entry = { at: nowIso(), sub: sub.id, target: sub.target, targetTitle: row.title, event, to: sub.to, ok: false, error: null }
  try {
    await g.messageAgent(sub.to, text)
    entry.ok = true
  } catch (error) {
    // 投不到要说出来:页签上标红,❌ 吞掉。
    entry.error = String(error?.message ?? error)
  }
  state.log = [...state.log, entry].slice(-LOG_MAX)
}

/** One look at every agent here: what moved since the last look, against every subscription. */
async function check() {
  const list = await g.listAgents()
  const subs = await readSubs()
  const byId = new Map(list.map((row) => [row.agentId, row]))
  const now = Date.now()

  const snapshot = JSON.stringify({ agents: list.map(({ agentId, sessionId, title, status, detail }) => ({ agentId, sessionId, title, status, detail: detail ?? null })) })
  if (snapshot !== agentsJson) {
    agentsJson = snapshot
    await g.writeData('agents.json', JSON.stringify({ at: nowIso(), ...JSON.parse(snapshot) }))
  }

  // 一个 agent 重新开始干活:订阅它的那些,每件事都可以再投一次。
  for (const row of list) {
    const before = state.last[row.agentId]
    if (before && before.status !== 'working' && row.status === 'working') {
      for (const sub of Object.values(subs)) if (sub.target === row.agentId) delete state.fired[sub.id]
    }
  }

  for (const sub of Object.values(subs)) {
    if (state.ended[sub.id]) continue
    const row = byId.get(sub.target)
    const before = state.last[sub.target]
    if (!row) {
      // 不在清单里了:会话被归档或删除。这条订阅到此为止。
      const title = before?.title ?? sub.target
      if (sub.events.includes('gone')) await fire(sub, 'gone', { title, agentId: sub.target, sessionId: null })
      state.ended[sub.id] = { at: nowIso(), why: '被盯的会话不在了' }
      continue
    }
    if (!firstLook && before && before.status !== row.status) {
      if (row.status === 'error') {
        // 引擎自己没了(failure 有值)算 gone;只订了 failed 的,照样告诉它出错了。
        if (row.failure && sub.events.includes('gone')) await fire(sub, 'gone', row)
        else if (sub.events.includes('failed')) await fire(sub, 'failed', row)
      } else if (row.status === 'needs_user' && sub.events.includes('waiting')) {
        await fire(sub, 'waiting', row)
      } else if (before.status === 'working' && row.status === 'idle' && sub.events.includes('done')) {
        // 被打断(plain)不是跑完;旧版咕咕没有 detail,只能按跑完算。
        if (row.detail === undefined || row.detail === 'done') await fire(sub, 'done', row)
      }
    }
    if (row.status === 'working' && sub.events.includes('stuck')) {
      const since = Math.max(Date.parse(row.lastActionAt ?? '') || 0, Date.parse(row.updatedAt ?? '') || 0)
      const minutes = Math.floor((now - since) / 60_000)
      if (since > 0 && minutes >= sub.stuckMinutes) await fire(sub, 'stuck', row, minutes)
    }
  }

  state.last = Object.fromEntries(list.map((row) => [row.agentId, { status: row.status, detail: row.detail ?? null, title: row.title }]))
  for (const id of Object.keys(state.fired)) if (!subs[id]) delete state.fired[id]
  for (const id of Object.keys(state.ended)) if (!subs[id]) delete state.ended[id]
  firstLook = false
  state.checkedAt = nowIso()
  state.error = null
}

let running = null
let again = false
async function tick() {
  if (running) { again = true; return running }
  running = (async () => {
    do {
      again = false
      try {
        await check()
      } catch (error) {
        state.error = { at: nowIso(), message: String(error?.message ?? error) }
        g.reportError(`雷达这一轮没看成:${state.error.message}`)
      }
      try {
        await g.writeData('state.json', JSON.stringify(state))
        await g.broadcastToViews({ type: 'state', state })
      } catch (error) {
        g.reportError(`雷达存不下自己的账:${error?.message ?? error}`)
      }
    } while (again)
  })()
  try { await running } finally { running = null }
}

g.onViewMessage((message) => {
  if (message?.type === 'check') void tick()
})

;(async () => {
  try {
    await load()
  } catch (error) {
    g.reportError(`雷达读不了自己的账(state.json):${error?.message ?? error}`)
  }
  g.onAgentsChanged(() => void tick())
  setInterval(() => void tick(), TICK_MS)
  await tick()
})()
