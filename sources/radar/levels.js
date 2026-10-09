// How much an agent wants to hear: each level is all of the one before and more. The one table — tools.js (via
// store.js), the background page and the tab all read it.
export const LEVELS = {
  trouble: ['failed', 'gone', 'stuck'],
  needs_you: ['failed', 'gone', 'stuck', 'waiting'],
  everything: ['failed', 'gone', 'stuck', 'waiting', 'done'],
}
export const DEFAULT_LEVEL = 'trouble'
export const wants = (sub, event) => (LEVELS[sub.level] ?? []).includes(event)
