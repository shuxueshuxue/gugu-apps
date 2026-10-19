import { randomUUID } from 'node:crypto'
import { openStore, checkDay, dayOf } from './store.js'
const PAGE_ONLY = { ui: { visibility: ['app'] } }
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string' }
function checkedTime(time) {
  if (time !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('time must be HH:MM (00:00–23:59)')
  return time
}
function titleOf(title) { const line = String(title || '').trim(); if (!line) throw new Error('title is empty'); return line }
const fields = {
  title: { type: 'string', description: "One line, in the person's words." },
  detail: string, tags: { type: 'array', items: string },
  time: { type: 'string', description: 'HH:MM. Omit an unknown exact time; preserve “afternoon” in detail.' },
}
export const record = {
  description: 'Proactively record a definite personal plan (todo) or something that happened (memory), from messages this agent receives. No explicit request to record is needed. Query first to avoid duplicates.',
  inputSchema: schema({ kind: { type: 'string', enum: ['todo', 'memory'] }, ...fields, date: { type: 'string', description: 'YYYY-MM-DD; today if omitted.' } }, ['kind', 'title']),
  async run({ kind, title, detail, tags, date, time }, { agent, session } = {}) {
    if (!['todo', 'memory'].includes(kind)) throw new Error('kind must be todo or memory')
    const line = titleOf(title), now = new Date(), day = checkDay(date || dayOf(now)), at = checkedTime(time)
    const store = openStore(), list = store.get(day)
    const duplicate = list.find((e) => e.kind === kind && e.title === line)
    if (duplicate) return JSON.stringify({ date: day, entry: duplicate, alreadyRecorded: true })
    const entry = { id: randomUUID(), kind, title: line, at: Date.now() }
    if (agent) { entry.by = agent; if (session) entry.session = session }
    if (kind === 'todo') entry.done = false
    if (at) entry.time = at
    // Do not invent an occurrence time for an undated retrospective statement.
    if (detail) entry.detail = String(detail)
    if (tags) entry.tags = tags.map(String)
    list.push(entry); store.commit({ [day]: list })
    return JSON.stringify({ date: day, entry })
  },
}
export const query = {
  description: 'Find existing calendar entries before recording, completing or rescheduling. Optional inclusive dates and title/detail text. No dates searches all recorded days. Returns IDs and dates for update.',
  inputSchema: schema({ from: string, to: string, text: string, kind: { type: 'string', enum: ['todo', 'memory'] } }),
  async run({ from, to, text, kind } = {}) {
    if (from) checkDay(from); if (to) checkDay(to)
    if (from && to && from > to) throw new Error('from must not be after to')
    const store = openStore(), found = [], needle = text?.toLocaleLowerCase()
    for (const date of store.dates()) {
      if ((from && date < from) || (to && date > to)) continue
      for (const entry of store.get(date)) {
        if (kind && entry.kind !== kind) continue
        if (needle && !`${entry.title}\n${entry.detail || ''}`.toLocaleLowerCase().includes(needle)) continue
        found.push({ date, ...entry })
      }
    }
    return JSON.stringify(found)
  },
}
export const update = {
  description: 'Update an existing calendar entry by date and ID returned by query. Complete/reopen a todo, change details, or move it to new_date keeping its ID and original source. Do not create another memory just to complete a todo.',
  inputSchema: schema({ date: string, id: string, new_date: string, done: { type: 'boolean' }, ...fields }, ['date', 'id']),
  async run({ date, id, new_date, done, title, detail, tags, time }) {
    const day = checkDay(date), target = checkDay(new_date || day), at = checkedTime(time), store = openStore(), list = store.get(day)
    const entry = list.find((e) => e.id === id)
    if (!entry) throw new Error(`no entry ${id} on ${day}`)
    if (done !== undefined) {
      if (entry.kind !== 'todo') throw new Error('only a todo can be completed')
      entry.done = done
    }
    if (title !== undefined) entry.title = titleOf(title)
    if (detail !== undefined) entry.detail = detail
    if (tags !== undefined) entry.tags = tags
    if (time !== undefined) entry.time = at
    entry.updatedAt = Date.now()
    const changes = { [day]: list }
    if (target !== day) {
      const dest = store.get(target)
      if (dest.some((e) => e.id === id)) throw new Error(`entry ${id} already exists on ${target}`)
      changes[day] = list.filter((e) => e.id !== id)
      changes[target] = [...dest, entry]
    }
    store.commit(changes)
    return JSON.stringify({ date: target, entry })
  },
}
export const month = {
  description: 'Read one calendar month for the page.', _meta: PAGE_ONLY,
  inputSchema: schema({ month: string }, ['month']),
  async run({ month }) {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM')
    const store = openStore(), days = {}
    for (const date of store.dates(month)) if (date.startsWith(`${month}-`)) days[date] = store.get(date)
    return JSON.stringify({ version: 2, days })
  },
}
export const set_done = { ...update, description: 'Check or uncheck a todo on the page.', _meta: PAGE_ONLY }
export const remove = {
  description: 'Delete an entry on the page.', _meta: PAGE_ONLY,
  inputSchema: schema({ date: string, id: string }, ['date', 'id']),
  async run({ date, id }) {
    const day = checkDay(date), store = openStore(), list = store.get(day)
    if (!list.some((e) => e.id === id)) throw new Error(`no entry ${id} on ${day}`)
    store.commit({ [day]: list.filter((e) => e.id !== id) }); return 'ok'
  },
}
