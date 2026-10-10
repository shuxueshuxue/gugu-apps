/**
 * 雷达 —— 后台页:盯着这台电脑上的 agent,订阅的事一发生就投一条消息给订阅者。
 *
 * 订阅一条一个文件 subs/<id>.json(agent 用 watch / unwatch 写,页签上「不再关注」也删);这里只读它们。
 * 自己的账在 state.json:每个 agent 上次看到的状态、每条订阅已经投过哪些事、结束了的订阅、投递记录。
 * agents.json 是给工具看的「这台电脑上有哪些 agent」,每次有变化就重写。
 *
 * 一件事只投一次:同一条订阅的同一件事,要等被盯的 agent 下一次开始干活(转成 working)才会再投。
 */

import { LEVELS, wants } from './levels.js'
import { wordsFor } from './words.js'

const TICK_MS = 30_000
const LOG_MAX = 200
const ENDED_MAX = 50
const g = window.gugu

let state = { version: 3, checkedAt: null, last: {}, fired: {}, ended: [], log: [], paths: {}, error: null }
let agentsJson = ''
let firstLook = true

const nowIso = () => new Date().toISOString()

async function load() {
  const raw = await g.readData('state.json')
  if (raw === null) return
  const saved = JSON.parse(raw)
  if (saved.version !== 3) throw new Error(`state.json is version ${saved.version}; this build reads 3`)
  state = { ...state, ...saved }
}

/** Every subscription: one file each under subs/ (tools.js writes them; a person's 「撤掉」 removes one). */
async function readSubs() {
  const files = (await g.listData('subs')).filter((e) => e.kind === 'file' && e.path.endsWith('.json'))
  const subs = {}
  for (const { path } of files) {
    const raw = await g.readData(path)
    if (raw === null) continue // removed between the listing and the read
    const sub = JSON.parse(raw)
    subs[sub.id] = sub
  }
  return subs
}

/** A subscription whose target is gone ends: its file is removed (by 雷达's own program), its last word kept in a short list. */
async function endSub(sub, why, { loud = false } = {}) {
  // Once per subscription: a removal that keeps failing is retried every look, but said and kept in the list only once.
  const first = !state.ended.some((e) => e.id === sub.id)
  if (first && loud) g.reportError(`雷达删掉了一条订阅 ${sub.id}：${why}`)
  if (first) state.ended = [...state.ended, { at: nowIso(), id: sub.id, target: sub.titles?.target ?? sub.target, why }].slice(-ENDED_MAX)
  try {
    await g.callProgram('unwatch', { id: sub.id })
  } catch (error) {
    if (first) g.reportError(`雷达没能删掉结束了的订阅 ${sub.id}:${error?.message ?? error}`)
  }
}

/** Why an agent is gone, in a person's words. */
function goneWhy(W, row) {
  if (!row.sessionId) return W.goneArchived
  if (row.failure?.kind === 'start-failed') return W.startFailed
  if (row.failure) return W.engineQuit
  return W.goneUnknown
}

/** What the agent said last, for 「做完了」: an MCP that went deaf still leaves its conclusion here. */
async function lastWords(W, agentId) {
  try {
    const page = await g.readAgentHistory(agentId)
    const said = [...page.messages].reverse().find((m) => m.sender !== 'user' && m.text?.trim())
    if (!said) return W.saidNothing
    const text = said.text.trim()
    return W.said(text.length > 1500 ? `${text.slice(0, 1500)}${W.cut}` : text)
  } catch (error) {
    return W.cannotRead(error?.message ?? error)
  }
}

/** The reminder, in a person's words and in gugu's language right now — the told agent reads what a person would. */
async function describe(W, event, row, extra) {
  const who = row.title
  if (event === 'failed') return W.told.failed(who)
  if (event === 'gone') return W.told.gone(who, goneWhy(W, row))
  if (event === 'stuck') return W.told.stuck(who, extra)
  if (event === 'waiting') return W.told.waiting(who, (row.detail && W.waits[row.detail]) || W.waitAny)
  return W.told.done(who, await lastWords(W, row.agentId))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The engine's failure, read again a moment after the error showed (null if there still is none). */
async function failureSoon(agentId) {
  await sleep(3000)
  return (await g.listAgents()).find((row) => row.agentId === agentId)?.failure ?? null
}

async function fire(sub, event, row, extra) {
  const fired = (state.fired[sub.id] ??= {})
  if (fired[event]) return
  fired[event] = true
  const W = wordsFor((await g.getContext())?.locale)
  const text = W.reminder(await describe(W, event, row, extra), row.sessionId, sub.id)
  const entry = { at: nowIso(), sub: sub.id, target: sub.target, targetTitle: row.title, event, to: sub.to, ok: false, error: null }
  // A path is where reminders travel: from the agent they are about to the one they go to. Its count is kept (only the
  // ones that arrived), all subscriptions on it together; its last failure stays until one arrives again.
  const key = `${sub.target}>${sub.to}`
  const path = (state.paths[key] ??= { sent: 0, lastAt: null, failed: null })
  try {
    await g.messageAgent(sub.to, text)
    entry.ok = true
    path.sent += 1
    path.lastAt = entry.at
    path.failed = null
  } catch (error) {
    // 投不到要说出来:页签上标红,❌ 吞掉。
    // gugu's message is for the App's author (English); its code is what the tab says in the person's language
    entry.error = String(error?.message ?? error)
    entry.code = error?.code ?? null
    path.failed = { at: entry.at, error: entry.error, code: entry.code }
  }
  state.log = [...state.log, entry].slice(-LOG_MAX)
}

/** When this agent started its current stretch of work, as far as 雷达 saw it (the first look counts as the start). */
function workingSince(row, before) {
  return before?.status === 'working' && before.workingSince ? before.workingSince : nowIso()
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
    if (!LEVELS[sub.level]) {
      // 读不懂的订阅(旧格式,没有 level):❌ 静默不投 —— 说一声,删掉。
      await endSub(sub, `这条订阅没有雷达认得的 level（${sub.level ?? '没写'}），是旧格式`, { loud: true })
      continue
    }
    if (!byId.has(sub.to)) {
      // 收提醒的那个不在了:和被关注的不在了一样,这条到此为止(这条路的次数留在 state.paths 里)。
      await endSub(sub, '收提醒的任务不在了')
      continue
    }
    const row = byId.get(sub.target)
    const before = state.last[sub.target]
    if (!row) {
      // 不在清单里了:会话被归档或删除。这条订阅到此为止。
      const title = before?.title ?? sub.titles?.target ?? sub.target
      if (wants(sub, 'gone')) await fire(sub, 'gone', { title, agentId: sub.target, sessionId: null })
      await endSub(sub, '被盯的会话不在了')
      continue
    }
    if (!firstLook && before && before.status !== row.status) {
      if (row.status === 'error') {
        // 引擎死时,状态常比 failure 先到一步(连接先断、那一轮先按出错收尾):等一下再读一次这一行。
        if (!row.failure) row.failure = await failureSoon(row.agentId)
        // 引擎自己没了(failure 有值)算 gone;只订了 failed 的,照样告诉它出错了。
        if (row.failure && wants(sub, 'gone')) await fire(sub, 'gone', row)
        else if (wants(sub, 'failed')) await fire(sub, 'failed', row)
      } else if (row.status === 'needs_user' && wants(sub, 'waiting')) {
        await fire(sub, 'waiting', row)
      } else if (before.status === 'working' && row.status === 'idle' && wants(sub, 'done')) {
        // 被打断(plain)不是跑完。细分问不到(null,或这一版咕咕不交这一格)时分不出来,只能按跑完算。
        if ((row.detail ?? null) !== 'plain') await fire(sub, 'done', row)
      }
    }
    if (row.status === 'working' && wants(sub, 'stuck')) {
      // 只认「最后一次调工具」。拿不到(终端 agent、没打开的面板 agent:问不到,不是零)就不判卡住 ——
      // ❌ 拿 updatedAt 顶:那是排序键,一条一直在调工具的终端车道跑过阈值也会被报卡住。
      // 上一轮最后那次调工具会一直留着:从「这次开始干活」和「最后一次调工具」里取晚的那个算起,刚开工的一轮不算卡住。
      const action = Date.parse(row.lastActionAt ?? '')
      const since = Math.max(action, Date.parse(workingSince(row, before)))
      const minutes = Math.floor((now - since) / 60_000)
      if (Number.isFinite(action) && minutes >= sub.stuckMinutes) await fire(sub, 'stuck', row, minutes)
    }
  }

  state.last = Object.fromEntries(list.map((row) => [row.agentId, {
    status: row.status, detail: row.detail ?? null, title: row.title,
    workingSince: row.status === 'working' ? workingSince(row, state.last[row.agentId]) : null,
  }]))
  for (const id of Object.keys(state.fired)) if (!subs[id]) delete state.fired[id]
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
