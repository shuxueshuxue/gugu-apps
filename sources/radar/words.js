/**
 * 雷达's words, in a person's language — the tab's and the reminders' alike (an agent reads a reminder the way a person
 * would). One table per language; both have the same keys.
 */
export const WORDS = {
  zh: {
    title: '雷达', thisTask: '这个任务', all: '全部', depth: '看几层',
    checked: '后台上次查看', notYet: '后台还没查看过',
    late: (m) => `后台已经 ${m} 分钟没查看了，可能没在运行。`, notRunning: '后台还没运行起来。', lastLookFailed: (m) => `后台上一次查看没成功：${m}`,
    legendWorking: '在干活', legendWaiting: '等你批准', legendIdle: '闲着', legendTrouble: '出问题了', legendPath: '提醒的方向，数字是已提醒的次数',
    recent: '最近的提醒', noneYet: '还没提醒过', arrived: '送到了', notArrived: (why) => `没送到：${why}`,
    emptyLocal: '还没有谁在关注它，它也没在关注谁。', emptyAll: '还没有谁在关注谁。agent 用雷达的 watch 工具关注别的 agent。',
    remind: (target, to) => `${target} 的事 → 提醒 ${to}`,
    stop: '不再关注', open: '打开这个任务', none: '没有和它有关的关注。',
    couldNot: (what, m) => `${what}没成功：${m}`,
    // node sentences
    working: (n, ago) => (!ago ? `${n} 正在干活。` : ago === '刚刚' ? `${n} 正在干活，刚刚还动过。` : `${n} 正在干活，${ago}刚动过。`),
    idle: (n) => `${n} 闲着。`, waiting: (n, what) => `${n} 在等你${what}。`, trouble: (n) => `${n} 出问题了。`,
    troubleWhy: (n, why) => `${n} 出问题了：${why}。`, gone: (n) => `${n} 不在了。`, noStatus: (n) => `${n} 现在的状态看不到。`,
    waits: { approval: '批准一个操作', question: '回答一个问题', plan: '看一份计划', dialog: '处理一个对话框' }, waitAny: '处理一件事',
    engineQuit: '它的引擎意外退出了', startFailed: '它没能启动起来',
    // edge sentences
    levels: { trouble: '出问题时', needs_you: '出问题或者等人处理时', everything: '有任何动静时' },
    watchSelf: (to, target, when) => `${to} 在关注 ${target}：${target} ${when}会提醒 ${to}。`,
    watchFor: (by, to, target, when) => `${by} 让 ${to} 在 ${target} ${when}收到提醒。`,
    sentTimes: (n, ago) => `已提醒 ${n} 次，最近一次：${ago}。`, sentNever: '还没提醒过。',
    lastFailed: (why) => `上一次没送到：${why}。`,
    includes: '具体包括：', listSep: '、', end: '。',
    events: { failed: '停下来报错', gone: '不在了（引擎退出、任务被归档或删除）', stuck: (m) => `很久没动静（${m} 分钟没有新动作）`, waiting: '在等人批准或回答', done: '做完一轮' },
    eventDone: { failed: '停下来报错了', gone: '不在了', stuck: '好像卡住了', waiting: '在等人', done: '做完了' },
    notHere: '收提醒的那个任务已经不在这台电脑上了',
    // reminders (what the told agent reads)
    reminder: (body, sessionId, id) => `雷达提醒：${body}\n（${sessionId ? `它的任务 session:${sessionId}，` : ''}这条不用回复。不想再收到：用 radar 的 unwatch，编号 ${id}。）`,
    told: {
      failed: (who) => `${who} 停下来报错了。`, gone: (who, why) => `${who} 不在了：${why}。`,
      stuck: (who, m) => `${who} 好像卡住了：${m} 分钟没有新动作。`, waiting: (who, what) => `${who} 在等人${what}。`,
      done: (who, words) => `${who} 做完了。${words}`,
    },
    goneArchived: '这个任务被归档或删除了', goneUnknown: '原因没读到',
    said: (text) => `它最后说：\n${text}`, saidNothing: '它这一轮没有说话。', cut: '…（太长截断了，全文在它的任务里）',
    cannotRead: (m) => `（读不到它最后说的话：${m}）`,
    ago: (s) => (s < 60 ? '刚刚' : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 86400)} 天前`),
  },
  en: {
    title: 'Radar', thisTask: 'This task', all: 'Everyone', depth: 'Reach',
    checked: 'Last looked', notYet: 'Not looked yet',
    late: (m) => `It has not looked for ${m} minutes; it may not be running.`, notRunning: 'It is not running yet.', lastLookFailed: (m) => `Its last look did not work: ${m}`,
    legendWorking: 'Working', legendWaiting: 'Waiting for you', legendIdle: 'Idle', legendTrouble: 'In trouble', legendPath: 'Where reminders go; the number is how many went',
    recent: 'Recent reminders', noneYet: 'No reminders yet', arrived: 'Arrived', notArrived: (why) => `Did not arrive: ${why}`,
    emptyLocal: 'Nobody keeps an eye on it, and it keeps an eye on nobody.', emptyAll: 'Nobody keeps an eye on anyone yet. Agents use Radar\'s watch tool for that.',
    remind: (target, to) => `${target} → tell ${to}`,
    stop: 'Stop', open: 'Open this task', none: 'Nothing involves it.',
    couldNot: (what, m) => `${what} did not work: ${m}`,
    working: (n, ago) => (ago ? `${n} is working; it last did something ${ago}.` : `${n} is working.`),
    idle: (n) => `${n} is idle.`, waiting: (n, what) => `${n} is waiting for you to ${what}.`, trouble: (n) => `${n} is in trouble.`,
    troubleWhy: (n, why) => `${n} is in trouble: ${why}.`, gone: (n) => `${n} is gone.`, noStatus: (n) => `${n}'s state cannot be seen.`,
    waits: { approval: 'approve something', question: 'answer a question', plan: 'look at a plan', dialog: 'deal with a dialog' }, waitAny: 'do something',
    engineQuit: 'its engine quit unexpectedly', startFailed: 'it could not start',
    levels: { trouble: 'is in trouble', needs_you: 'is in trouble or needs you', everything: 'does anything' },
    watchSelf: (to, target, when) => `${to} keeps an eye on ${target}: when ${target} ${when}, ${to} is told.`,
    watchFor: (by, to, target, when) => `${by} has ${to} told when ${target} ${when}.`,
    sentTimes: (n, ago) => `Told ${n} time${n === 1 ? '' : 's'}, last ${ago}.`, sentNever: 'Not told yet.',
    lastFailed: (why) => `The last one did not arrive: ${why}.`,
    includes: 'That covers: ', listSep: ', ', end: '.',
    events: { failed: 'stopping with an error', gone: 'being gone (its engine quit, or its task was archived or deleted)', stuck: (m) => `going quiet (nothing new for ${m} minutes)`, waiting: 'waiting for someone to approve or answer', done: 'finishing a round' },
    eventDone: { failed: 'stopped with an error', gone: 'is gone', stuck: 'seems stuck', waiting: 'is waiting', done: 'finished' },
    notHere: 'the task to tell is no longer on this computer',
    reminder: (body, sessionId, id) => `Radar: ${body}\n(${sessionId ? `Its task is session:${sessionId}. ` : ''}No need to reply. To stop these: radar's unwatch, id ${id}.)`,
    told: {
      failed: (who) => `${who} stopped with an error.`, gone: (who, why) => `${who} is gone: ${why}.`,
      stuck: (who, m) => `${who} seems stuck: nothing new for ${m} minutes.`, waiting: (who, what) => `${who} is waiting for someone to ${what}.`,
      done: (who, words) => `${who} finished. ${words}`,
    },
    goneArchived: 'its task was archived or deleted', goneUnknown: 'the reason could not be read',
    said: (text) => `Its last words:\n${text}`, saidNothing: 'It said nothing this round.', cut: '… (too long, cut here; the whole text is in its task)',
    cannotRead: (m) => `(its last words could not be read: ${m})`,
    ago: (s) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`),
  },
}

/** The table for a gugu locale ('zh-CN', 'en-US', …); Chinese unless it is clearly not. */
export const wordsFor = (locale) => (String(locale ?? 'zh').startsWith('zh') ? WORDS.zh : WORDS.en)
