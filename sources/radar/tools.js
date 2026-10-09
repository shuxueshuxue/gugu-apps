// 雷达's tools for agents: watch / unwatch / watching. Every export here is one tool (gugu's tools.js rule).
//
// Who calls is `agent` (user:<uuid>), stamped by gugu — never an argument; a call with no agent is the person, from
// 雷达's own tab (callProgram). Each subscription is its own file (subs/<id>.json); the background page reads them and
// does the watching. Which agents are on this computer comes from agents.json, which the background page rewrites
// whenever an agent moves: a target that is not in it is not here.
import { createHash } from 'node:crypto'
import { watchArgs, readJson, resolveAgent, listSubs, readSub, writeSub, removeSub, LEVELS, DEFAULT_LEVEL } from './store.js'

// One program serves every session (gugu starts one copy per App), so writes are taken one at a time here: two
// watches of the same (who, whom, for whom) in flight together do not overwrite each other half-way.
let lane = Promise.resolve()
const oneAtATime = (fn) => {
  const run = lane.then(fn, fn)
  lane = run.catch(() => {})
  return run
}

export const watch = {
  description:
    'Be told when another agent on this computer needs attention. level says how much you want to hear: ' +
    '"trouble" — when it stops with an error, when it is gone (its engine quit, or its task was archived or deleted), ' +
    'or when it seems stuck (working, with no new tool call for stuck_minutes; judged only for chat-panel agents that ' +
    'are open — a terminal agent is never called stuck); "needs_you" — all of that, and also when it waits for a person ' +
    '(an approval, a question, a plan); "everything" — all of that, and also every time it finishes, with its last words. ' +
    `Default "${DEFAULT_LEVEL}". Each thing is told once, until the agent starts working again. Asking again for the same ` +
    'agent and the same receiver changes that one subscription. The message arrives in the receiver\'s session from ' +
    '雷达, written in the language gugu shows right now; there is nothing to reply to, and the receiver can unwatch it. ' +
    'When the watched agent or the receiver is gone (archived or deleted), the subscription ends by itself. ' +
    'Agents on other computers cannot be watched yet.',
  inputSchema: {
    type: 'object',
    required: ['target'],
    properties: {
      target: { type: 'string', description: 'The agent to watch: session:<id>, aid:<id> or user:<uuid>.' },
      level: { type: 'string', enum: Object.keys(LEVELS), description: `How much to hear (see above). Default ${DEFAULT_LEVEL}.` },
      stuck_minutes: { type: 'number', minimum: 1, description: 'How long without a new tool call counts as stuck. Default 30.' },
      to: { type: 'string', description: 'Who is told (session:<id>, aid:<id>, user:<uuid>). Default: you.' },
    },
  },
  run(args, call) {
    return oneAtATime(() => watchOnce(args, call))
  },
}

async function watchOnce(args, { agent }) {
  if (!agent) throw new Error('watch is for agents: gugu did not say which agent is calling')
  const { target, level, stuckMinutes, to } = watchArgs(args)
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
  const titleOf = (agentId) => snapshot.agents.find((a) => a.agentId === agentId)?.title ?? null
  const told = receiver.agentId === agent ? 'you' : receiver.agentId

  // The same (who, whom, for whom) is one subscription — its id is that triple's hash, so asking again (even two
  // asks in flight together) lands on the same file: it widens it, never multiplies the messages.
  const id = `w${createHash('sha256').update(`${agent}|${watched.agentId}|${receiver.agentId}`).digest('hex').slice(0, 16)}`
  const same = await readSub(id)
  if (same) {
    same.level = level
    same.stuckMinutes = stuckMinutes
    await writeSub(same)
    return { id, changed: true, watching: `${watched.title} (session:${watched.sessionId})`, level, told }
  }
  // Titles as they were at watch time: an archived session is gone from the list, and its subscription still has a name.
  await writeSub({
    id, by: agent, target: watched.agentId, to: receiver.agentId, level, stuckMinutes, createdAt: new Date().toISOString(),
    titles: { by: titleOf(agent), target: watched.title, to: titleOf(receiver.agentId) },
  })
  return { id, watching: `${watched.title} (session:${watched.sessionId})`, level, told }
}

export const unwatch = {
  description: 'Stop a subscription you made, or one that sends its messages to you (its id from watch or watching).',
  inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  run(args, call) {
    return oneAtATime(() => unwatchOnce(args, call))
  },
}

async function unwatchOnce({ id }, { agent }) {
  const sub = (await listSubs()).find((s) => s.id === String(id))
  // No agent = the person, from 雷达's tab: they may stop any of them.
  if (!sub || (agent && sub.by !== agent && sub.to !== agent)) {
    throw new Error(`you have no subscription ${id} (none made by you or sent to you); watching lists them`)
  }
  await removeSub(sub.id)
  return `stopped ${sub.id}`
}

export const watching = {
  description: 'Your subscriptions, the ones that send to you, who watches you, and the last 10 things 雷达 sent about them.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  async run(_args, { agent }) {
    const all = await listSubs()
    const state = await readJson('state.json', { log: [] })
    const snapshot = await readJson('agents.json', { agents: [] })
    const name = (id, saved) => {
      const a = snapshot.agents.find((row) => row.agentId === id)
      return a ? `${a.title} (session:${a.sessionId})` : `${saved ?? id} (no longer on this computer)`
    }
    const row = (s) => ({ id: s.id, by: s.by === agent ? 'you' : name(s.by, s.titles?.by), target: name(s.target, s.titles?.target), to: s.to === agent ? 'you' : name(s.to, s.titles?.to), level: s.level })
    const mine = all.filter((s) => s.by === agent)
    const toMe = all.filter((s) => s.to === agent && s.by !== agent)
    const ids = new Set([...mine, ...toMe].map((s) => s.id))
    return {
      mine: mine.map(row),
      sent_to_me: toMe.map(row),
      watching_me: all.filter((s) => s.target === agent).map((s) => ({ id: s.id, by: name(s.by, s.titles?.by), level: s.level })),
      recent: (state.log ?? []).filter((e) => ids.has(e.sub)).slice(-10),
      background_checked_at: state.checkedAt ?? null,
    }
  },
}
