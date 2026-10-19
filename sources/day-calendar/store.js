import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const dayOf = (d) => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function checkDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date))
  const d = new Date(0)
  if (m) { d.setFullYear(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0) }
  if (!m || dayOf(d) !== date) throw new Error(`date must be a real day as YYYY-MM-DD, got ${JSON.stringify(date)}`)
  return date
}
const pause = new Int32Array(new SharedArrayBuffer(4))
function read(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw new Error(`${file}: ${e.message}`) }
}
function atomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value))
  for (let n = 0; ; n++) {
    try { renameSync(tmp, file); return }
    catch (e) {
      if (n >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { unlinkSync(tmp); throw e }
      Atomics.wait(pause, 0, 0, 20)
    }
  }
}
function entries(value, date) {
  if (!value || value.version !== 2 || value.date !== date || !Array.isArray(value.entries)) throw new Error(`invalid day file: ${date}`)
  return value.entries
}

// One synchronous writer, shared by page and agents. A durable pending write makes a move to another day
// recoverable: replay all files before any reader returns, then remove the pending transaction.
export function openStore() {
  const root = process.env.GUGU_EXTENSION_DATA_DIR
  if (!root) throw new Error('GUGU_EXTENSION_DATA_DIR is not set')
  mkdirSync(root, { recursive: true })
  const pending = join(root, 'pending-days.json')
  const marker = join(root, 'daily-storage-v2.json')
  const file = (date) => { checkDay(date); return join(root, 'days', date.slice(0, 4), date.slice(5, 7), `${date}.json`) }
  function recover() {
    const tx = read(pending)
    if (tx === undefined) return
    if (!tx || tx.version !== 1 || !Array.isArray(tx.days)) throw new Error('invalid pending-days.json')
    for (const day of tx.days) { entries(day, day.date); atomic(file(day.date), day) }
    if (tx.migration) atomic(marker, { version: 2 })
    unlinkSync(pending)
  }
  function commit(days, migration = false) {
    atomic(pending, { version: 1, days: Object.entries(days).map(([date, list]) => ({ version: 2, date: checkDay(date), entries: list })), migration })
    recover()
  }
  recover()
  const migrated = read(marker)
  if (migrated !== undefined && (!migrated || migrated.version !== 2)) throw new Error('invalid daily-storage-v2.json')
  if (migrated === undefined) {
    const old = read(join(root, 'journal.json'))
    const days = {}
    if (old !== undefined) {
      if (!old || old.version !== 1 || !old.days || typeof old.days !== 'object' || Array.isArray(old.days)) throw new Error('invalid legacy journal.json')
      for (const [date, list] of Object.entries(old.days)) {
        checkDay(date)
        if (!Array.isArray(list)) throw new Error(`invalid legacy entries: ${date}`)
        const existing = read(file(date))
        if (existing !== undefined && JSON.stringify(entries(existing, date)) !== JSON.stringify(list)) throw new Error(`migration conflict: ${date}`)
        days[date] = list
      }
    }
    // Keep journal.json unchanged as the legacy backup. The marker prevents deleted entries reappearing.
    commit(days, true)
  }
  return {
    get(date) { const value = read(file(date)); return value === undefined ? [] : entries(value, date) },
    commit,
    dates(month) {
      const base = join(root, 'days')
      function dirs(path) { try { return readdirSync(path, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
      const dates = []
      for (const y of dirs(base).filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name) && (!month || e.name === month.slice(0, 4)))) {
        for (const m of dirs(join(base, y.name)).filter((e) => e.isDirectory() && /^\d{2}$/.test(e.name) && (!month || e.name === month.slice(5, 7)))) {
          for (const f of dirs(join(base, y.name, m.name)).filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))) {
            const date = checkDay(f.name.slice(0, -5))
            if (!date.startsWith(`${y.name}-${m.name}-`)) throw new Error(`misplaced day file: ${f.name}`)
            dates.push(date)
          }
        }
      }
      return dates.sort()
    },
  }
}
