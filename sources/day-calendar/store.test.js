import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record, query, update, month, remove } from './tools.js'
import { checkDay, openStore } from './store.js'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'calendar-'))
  process.env.GUGU_EXTENSION_DATA_DIR = root
  t.after(() => { rmSync(root, { recursive: true, force: true }); delete process.env.GUGU_EXTENSION_DATA_DIR })
  return root
}
const dayFile = (root, d) => join(root, 'days', d.slice(0, 4), d.slice(5, 7), `${d}.json`)
const result = async (tool, args, ctx) => JSON.parse(await tool.run(args, ctx))
test('migration preserves every entry and its source, keeps old backup, never resurrects removed data', async (t) => {
  const root = fixture(t), original = { version: 1, days: {
    '2026-10-19': [{ id: 'one', kind: 'todo', title: '报告', done: true, by: 'a', session: 's' }],
    '2026-11-01': [{ id: 'two', kind: 'memory', title: '开会' }],
  } }
  writeFileSync(join(root, 'journal.json'), JSON.stringify(original))
  assert.equal((await result(query, {})).length, 2)
  for (const [date, entries] of Object.entries(original.days)) assert.deepEqual(JSON.parse(readFileSync(dayFile(root, date))), { version: 2, date, entries })
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'journal.json'))), original)
  await remove.run({ date: '2026-10-19', id: 'one' })
  assert.equal((await result(query, {})).length, 1)
})
test('record, query, completion and cross-year move preserve ID and source; retries do not duplicate', async (t) => {
  const root = fixture(t)
  const first = await result(record, { kind: 'todo', title: '打网球', date: '2026-12-31', detail: '下午' }, { agent: 'a', session: 's' })
  assert.equal(first.entry.time, undefined)
  assert.equal((await result(record, { kind: 'todo', title: '打网球', date: '2026-12-31' })).alreadyRecorded, true)
  await update.run({ date: first.date, id: first.entry.id, done: true, new_date: '2027-01-01' })
  assert.deepEqual(await result(query, { from: '2026-12-31', to: '2026-12-31' }), [])
  const moved = await result(query, { text: '网球' })
  assert.equal(moved.length, 1); assert.equal(moved[0].id, first.entry.id); assert.equal(moved[0].session, 's'); assert.equal(moved[0].done, true)
  assert.ok(existsSync(dayFile(root, '2027-01-01')))
  assert.equal((await result(month, { month: '2026-12' })).days['2027-01-01'], undefined)
})
test('pending cross-day writes recover before query exposes entries', async (t) => {
  const root = fixture(t); openStore()
  const entry = { id: 'move', title: '报告', kind: 'todo', done: false }
  openStore().commit({ '2026-10-19': [entry] })
  writeFileSync(join(root, 'pending-days.json'), JSON.stringify({ version: 1, days: [
    { version: 2, date: '2026-10-19', entries: [] }, { version: 2, date: '2026-11-01', entries: [entry] },
  ] }))
  const list = await result(query, {})
  assert.equal(list.length, 1); assert.equal(list[0].date, '2026-11-01'); assert.equal(existsSync(join(root, 'pending-days.json')), false)
})
test('invalid dates, corruption, time and missing IDs fail explicitly without altering entries', async (t) => {
  const root = fixture(t)
  assert.throws(() => checkDay('2026-02-31'))
  await assert.rejects(record.run({ kind: 'todo', title: 'x', time: '25:99' }))
  await assert.rejects(update.run({ date: '2026-10-19', id: 'missing', done: true }))
  await record.run({ date: '2026-10-19', kind: 'memory', title: 'x' })
  writeFileSync(dayFile(root, '2026-10-19'), '{bad')
  await assert.rejects(query.run({}), /2026-10-19/)
})
test('migration conflict is not silently overwritten or marked complete', (t) => {
  const root = fixture(t), date = '2026-10-19'
  mkdirSync(join(root, 'days', '2026', '10'), { recursive: true })
  writeFileSync(dayFile(root, date), JSON.stringify({ version: 2, date, entries: [{ id: 'new' }] }))
  writeFileSync(join(root, 'journal.json'), JSON.stringify({ version: 1, days: { [date]: [{ id: 'old' }] } }))
  assert.throws(() => openStore(), /migration conflict/)
  assert.equal(existsSync(join(root, 'daily-storage-v2.json')), false)
})

test('JSON null is corruption, never absence or an empty calendar', async (t) => {
  const root = fixture(t)
  for (const name of ['journal.json', 'daily-storage-v2.json', 'pending-days.json']) {
    writeFileSync(join(root, name), 'null')
    assert.throws(() => openStore(), /invalid/)
    rmSync(join(root, name))
  }
  openStore()
  const file = dayFile(root, '2026-10-19')
  mkdirSync(join(root, 'days', '2026', '10'), { recursive: true })
  writeFileSync(file, 'null')
  await assert.rejects(query.run({}), /invalid day file/)
  await assert.rejects(record.run({ kind: 'todo', title: 'must not replace corruption', date: '2026-10-19' }), /invalid day file/)
  assert.equal(readFileSync(file, 'utf8'), 'null')
})
