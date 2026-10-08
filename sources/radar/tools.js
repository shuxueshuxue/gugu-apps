// 雷达's tools for agents: watch / unwatch / watching. Every export here is one tool (gugu's tools.js rule).
//
// Who calls is `agent` (user:<uuid>), stamped by gugu — never an argument. The subscriptions live in this App's data
// folder (subs.json); the background page reads them and does the watching. Which agents are on this computer comes
// from agents.json, which the background page rewrites whenever an agent moves: a target that is not in it is not here.
import { watchArgs, readJson, writeJson, resolveAgent, EVENTS, DEFAULT_EVENTS } from './store.js'

export const watch = {
  description:
    'Be told when another agent on this computer changes state. events: failed (its turn ended in an error), gone (its ' +
    'engine died, or the session was archived/deleted), stuck (working with no new tool call for stuck_minutes), waiting ' +
    '(it waits on a person: approval, a question, a plan), done (its turn finished). Default: failed, gone, stuck. ' +
    'Each event is sent once until the agent starts working again. The message arrives in your session from 雷达; ' +
    'there is nothing to reply to. Agents on other computers cannot be watched yet.',
  inputSchema: {
    type: 'object',
    required: ['target'],
    properties: {
      target: { type: 'string', description: 'The agent to watch: session:<id>, aid:<id> or user:<uuid>.' },
      events: { type: 'array', items: { type: 'string', enum: EVENTS }, description: `Default ${DEFAULT_EVENTS.join(', ')}.` },
      stuck_minutes: { type: 'number', minimum: 1, description: 'For stuck: minutes without a new tool call. Default 30.' },
      to: { type: 'string', description: 'Who is told (session:<id>, aid:<id>, user:<uuid>). Default: you.' },
    },
  },
  async run(args, { agent }) {
    if (!agent) throw new Error('watch is for agents: gugu did not say which agent is calling')
    const { target, events, stuckMinutes, to } = watchArgs(args)
    const snapshot = await readJson('agents.json', null)
    if (!snapshot) throw new Error("雷达's background page has not listed this computer's agents yet; is 雷达 enabled? Try again in a moment.")
    const watched = resolveAgent(snapshot, target)
    if (!watched) {
      throw new Error(
        `${target} is not an agent on this computer (list from ${snapshot.at}). 雷达 only sees this computer's agents for now; ` +
          'agents on other computers come with gugu\'s cross-machine work (PR-5).',
      )
    }
    const receiver = to ? resolveAgent(snapshot, to) : { agentId: agent }
    if (!receiver) throw new Error(`${to} is not an agent on this computer, so 雷达 cannot tell it anything.`)
    if (watched.agentId === receiver.agentId) throw new Error('an agent cannot watch itself: when it fails it cannot be told')
    const subs = await readJson('subs.json', { version: 1, subs: {} })
    const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    // Titles as they were at watch time: an archived session is gone from the list, and its subscription still has a name.
    const titleOf = (agentId) => snapshot.agents.find((a) => a.agentId === agentId)?.title ?? null
    subs.subs[id] = {
      id, by: agent, target: watched.agentId, to: receiver.agentId, events, stuckMinutes, createdAt: new Date().toISOString(),
      titles: { by: titleOf(agent), target: watched.title, to: titleOf(receiver.agentId) },
    }
    await writeJson('subs.json', subs)
    return { id, watching: `${watched.title} (session:${watched.sessionId})`, events, ...(events.includes('stuck') ? { stuck_minutes: stuckMinutes } : {}), told: receiver.agentId === agent ? 'you' : receiver.agentId }
  },
}

export const unwatch = {
  description: 'Stop one of your subscriptions (its id from watch or watching).',
  inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  async run({ id }, { agent }) {
    const subs = await readJson('subs.json', { version: 1, subs: {} })
    const sub = subs.subs[String(id)]
    if (!sub || sub.by !== agent) throw new Error(`you have no subscription ${id}; watching lists yours`)
    delete subs.subs[sub.id]
    await writeJson('subs.json', subs)
    return `stopped ${sub.id}`
  },
}

export const watching = {
  description: 'Your subscriptions, who watches you, and the last 10 things 雷达 sent about them.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  async run(_args, { agent }) {
    const subs = await readJson('subs.json', { version: 1, subs: {} })
    const state = await readJson('state.json', { ended: {}, log: [] })
    const snapshot = await readJson('agents.json', { agents: [] })
    const name = (id, saved) => {
      const a = snapshot.agents.find((row) => row.agentId === id)
      return a ? `${a.title} (session:${a.sessionId})` : `${saved ?? id} (no longer on this computer)`
    }
    const row = (s) => ({ id: s.id, target: name(s.target, s.titles?.target), to: s.to === agent ? 'you' : name(s.to, s.titles?.to), events: s.events, ended: state.ended?.[s.id] ?? null })
    const all = Object.values(subs.subs)
    const mine = all.filter((s) => s.by === agent)
    const ids = new Set(mine.map((s) => s.id))
    return {
      mine: mine.map(row),
      watching_me: all.filter((s) => s.target === agent).map((s) => ({ id: s.id, by: name(s.by, s.titles?.by), events: s.events })),
      recent: (state.log ?? []).filter((e) => ids.has(e.sub)).slice(-10),
      background_checked_at: state.checkedAt ?? null,
    }
  },
}
