// Helpers for tools.js (Node): the data folder, argument checks, and naming an agent the way agents write it.
import { readFile, writeFile, rename, readdir, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'

export const EVENTS = ['failed', 'gone', 'stuck', 'waiting', 'done']
export const DEFAULT_EVENTS = ['failed', 'gone', 'stuck']

const dir = () => {
  const d = process.env.GUGU_EXTENSION_DATA_DIR
  if (!d) throw new Error('GUGU_EXTENSION_DATA_DIR is not set: this program only runs under gugu')
  return d
}

export async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(dir(), name), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`雷达 could not read its ${name}: ${error.message}`)
  }
}

/**
 * One subscription, one file (subs/<id>.json): two writers (an agent's watch, a person's 「撤掉」) never rewrite each
 * other's subscriptions, the way a shared subs.json read-modify-write would.
 */
const SUBS = 'subs'
const subFile = (id) => {
  if (!/^w[a-z0-9]+$/.test(id)) throw new Error(`${id} is not a subscription id`)
  return path.join(dir(), SUBS, `${id}.json`)
}

export async function listSubs() {
  let names
  try {
    names = await readdir(path.join(dir(), SUBS))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const subs = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      subs.push(JSON.parse(await readFile(path.join(dir(), SUBS, name), 'utf8')))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`雷达 could not read subscription ${name}: ${error.message}`)
    }
  }
  return subs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function writeSub(sub) {
  await mkdir(path.join(dir(), SUBS), { recursive: true })
  const file = subFile(sub.id)
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(sub, null, 1))
  await rename(tmp, file)
}

/** false when it was already gone. */
export async function removeSub(id) {
  try {
    await unlink(subFile(id))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** session:<id> | aid:<id> | user:<uuid> → its row in agents.json, or null. */
export function resolveAgent(snapshot, address) {
  const text = String(address ?? '').trim()
  const [kind, ...rest] = text.split(':')
  const id = rest.join(':')
  if (!id) return null
  if (kind === 'session') return snapshot.agents.find((a) => a.sessionId === id) ?? null
  if (kind === 'aid' || kind === 'user') return snapshot.agents.find((a) => a.agentId === `user:${id}`) ?? null
  return null
}

export function watchArgs(args) {
  const target = String(args.target ?? '').trim()
  if (!/^(session|aid|user):\S+$/.test(target)) throw new Error('target is session:<id>, aid:<id> or user:<uuid>')
  const events = args.events === undefined ? DEFAULT_EVENTS : args.events
  if (!Array.isArray(events) || events.length === 0) throw new Error(`events is a list of: ${EVENTS.join(', ')}`)
  const unknown = events.filter((e) => !EVENTS.includes(e))
  if (unknown.length) throw new Error(`unknown event ${unknown.join(', ')}; events are: ${EVENTS.join(', ')}`)
  const stuckMinutes = args.stuck_minutes === undefined ? 30 : Number(args.stuck_minutes)
  if (!Number.isFinite(stuckMinutes) || stuckMinutes < 1) throw new Error('stuck_minutes is a number of minutes, at least 1')
  const to = args.to === undefined ? null : String(args.to).trim()
  return { target, events: [...new Set(events)], stuckMinutes, to }
}
