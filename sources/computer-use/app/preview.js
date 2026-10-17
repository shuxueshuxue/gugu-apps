// 预览:这条会话的 agent 用 Computer Use 时,它正在操作的那个窗口和它的每一步。
// 画面只来自程序交回来的真截图(preview_state);没有就是空的,❌ 画一张假的。
// 会话由咕咕盖章:callProgram 带的是这张页此刻所在的会话,页面拿不到别的会话的东西。
import { MotionPlayer } from './cursor.js';

const gugu = window.gugu;
const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'), shot: $('shot'), frame: $('frame'), canvas: $('cursor'), what: $('what'), when: $('when'),
  empty: $('empty'), emptyTitle: $('empty-title'), alert: $('alert'),
};
const LIVE_EVERY_MS = 700;
const CHANGED = 'notifications/computer-use/changed';

// 人话:这一页只在 agent 操作电脑时才有意义,所以不解释 Computer Use、不指路去别处看原因,每种状态一句话。
const TEXT = {
  'zh-CN': {
    outside: '在任务里打开，才能看到 agent 的操作',
    idle: 'agent 操作电脑时，画面会显示在这里',
    loading: '正在获取画面…',
    unseen: '暂时看不到画面',
    stale: '没有新画面：',
    failed: '没能',
    verbs: { click: '点击', double_click: '双击', right_click: '右键点击', drag: '拖动', scroll: '滚动', type_text: '输入',
      press_key: '按键', hotkey: '按键', set_value: '填写', invoke_menu: '选择菜单', launch_app: '打开', set_window_frame: '调整窗口',
      get_window_state: '查看窗口', get_accessibility_tree: '查看窗口', list_apps: '查看打开的 App', list_windows: '查看窗口', zoom: '放大查看',
      run_steps: '连续操作' },
    other: '操作',
  },
  'en-US': {
    outside: 'Open it in a task to see what the agent does',
    idle: 'When the agent uses the computer, it shows here',
    loading: 'Getting the picture…',
    unseen: 'Cannot see the screen right now',
    stale: 'No fresh picture: ',
    failed: 'Could not',
    verbs: { click: 'Click', double_click: 'Double-click', right_click: 'Right-click', drag: 'Drag', scroll: 'Scroll', type_text: 'Type',
      press_key: 'Press', hotkey: 'Press', set_value: 'Fill in', invoke_menu: 'Choose menu', launch_app: 'Open', set_window_frame: 'Move window',
      get_window_state: 'Look at window', get_accessibility_tree: 'Look at window', list_apps: 'See open apps', list_windows: 'Look at windows', zoom: 'Zoom in',
      run_steps: 'Do steps' },
    other: 'Act',
  },
};

let context = null;
const textFor = (locale) => TEXT[locale] ?? (String(locale).startsWith('zh') ? TEXT['zh-CN'] : TEXT['en-US']);
let text = TEXT['zh-CN'];
let shown = 0;
let animated = '';
let live = false;
let liveTimer = null;
let player = null;
let pending = null;
/** The action the cursor points at now: its point stays on the same window pixel when the frame changes size. */
let pointed = null;

const visible = () => context?.layout?.visible !== false;
const sessionId = () => context?.session?.id ?? null;

function describe(action) {
  const verb = text.verbs[action.tool] ?? text.other;
  const detail = action.args.text ?? action.args.key ?? (Array.isArray(action.args.keys) ? action.args.keys.join('+') : null)
    ?? action.args.value ?? action.args.direction ?? (action.tool === 'launch_app' ? action.args.app ?? action.args.bundle_id : null);
  const said = detail === null || detail === undefined ? verb : `${verb}「${detail}」`;
  // 失败的原话在对话里那一步的工具结果和 App 页(owner 10-16:统一页不再播报失败),这里只说没做成。
  return action.status === 'failed' ? `${text.failed}${said}` : said;
}

function showEmpty(title) {
  ui.stage.hidden = true;
  ui.empty.hidden = false;
  ui.emptyTitle.textContent = title;
}

function showError(error) {
  ui.alert.hidden = false;
  ui.alert.textContent = error instanceof Error ? error.message : String(error);
}

/**
 * Where a point is on the cursor canvas, or null when the frame is not drawn yet. A point is in the pixels of the
 * screenshot the agent acted on (`space`); the frame on screen may be a smaller live picture of the same window.
 * No space, no cursor: drawn on another picture it would point somewhere else.
 */
function onCanvas(point, space) {
  const { frame, canvas } = ui;
  if (!space || !frame.naturalWidth || !frame.clientWidth) return null;
  const { width, height } = space;
  const box = frame.getBoundingClientRect();
  const origin = canvas.getBoundingClientRect();
  return { x: box.left - origin.left + (point.x * box.width) / width, y: box.top - origin.top + (point.y * box.height) / height };
}

/** The agent's cursor goes where the latest action pointed, on the frame the agent was looking at: flies there as the
 *  action starts while someone watches (as cua's own cursor on the screen does), simply sits there when the page opens
 *  on it. No point, no cursor. */
async function animate(action) {
  const key = `${action.at}|${action.tool}`;
  if (key === animated || !action.point) return;
  await ui.frame.decode().catch(() => {});
  if (!onCanvas(action.point, action.space) || key === animated) return;
  animated = key;
  pointed = action;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!player) {
    player = new MotionPlayer(ui.canvas);
    player.place(onCanvas(action.point, action.space));
    return;
  }
  // Each place in turn: a batch of steps (`path`, a click shown where it clicked), else a drag from where it grabbed to
  // where it let go, else the one point. Projected again before each leg: the pane may be resized meanwhile, and a
  // newer step takes over.
  const legs = action.path ?? [...(action.from ? [action.from] : []), { ...action.point, click: /click/.test(action.tool) }];
  for (const leg of legs) {
    const at = pointed === action && onCanvas(leg, action.space);
    if (!at) return;
    await player.moveTo(at, { reducedMotion: reduced });
    if (pointed === action && leg.click) player?.click();
  }
}

/** The frame changed size (pane resized, a picture of another size): the cursor stays on the same window pixel, ❌ on the
 *  same canvas pixel. A move under way ends where it was going. */
function reproject() {
  const at = player && pointed && onCanvas(pointed.point, pointed.space);
  if (at) player.place(at);
}

function apply(state) {
  if (!state.session) { showEmpty(text.outside); return; }
  live = state.live && state.target?.pid !== undefined && state.target?.window_id !== undefined;
  const latest = state.actions.at(-1);
  const app = typeof state.target?.app === 'string' ? state.target.app : null;
  // The last picture stays up when a fresh one cannot be taken, but it says so: ❌ an old picture passing for a live one.
  const stale = live && typeof state.liveProblem === 'string' ? `${text.stale}${state.liveProblem}` : null;
  const said = [app, latest && describe(latest), stale].filter(Boolean).join(' · ');
  if (state.frame) {
    shown = state.frame.seq;
    ui.frame.src = `data:${state.frame.mimeType};base64,${state.frame.data}`;
    ui.when.setAttribute('datetime', state.frame.at);
  }
  if (shown === 0) {
    showEmpty(!latest ? text.idle : latest.status === 'running' ? text.loading : text.unseen);
    return;
  }
  ui.empty.hidden = true;
  ui.stage.hidden = false;
  ui.what.textContent = said;
  const latestPointed = state.actions.findLast((action) => action.point);
  if (latestPointed) void animate(latestPointed);
}

/** One read at a time; a change that arrives during a read asks for one more afterwards. */
async function refresh(options = {}) {
  if (pending) { pending.again = true; return; }
  pending = { again: false };
  try {
    if (!sessionId()) { showEmpty(text.outside); return; }
    const result = await gugu.callProgram('preview_state', { since: shown, live: Boolean(options.live) });
    if (result.isError) throw new Error(result.content?.find((block) => block.type === 'text')?.text ?? 'preview_state failed');
    ui.alert.hidden = true;
    apply(result.structuredContent);
  } catch (error) {
    // 空态和「桥断了」长得一样 —— 让第二种看得见。
    showError(error);
  } finally {
    const again = pending.again;
    pending = null;
    if (again) void refresh();
    schedule();
  }
}

/**
 * Fresh frames only while this page is on screen, and only when the program can take them. This page is its task's own
 * (one per task): two tasks side by side are two pages, each on screen, each kept fresh — ❌ only the focused one.
 */
function schedule() {
  clearTimeout(liveTimer);
  liveTimer = null;
  if (!live || !visible()) return;
  liveTimer = setTimeout(() => void refresh({ live: true }), LIVE_EVERY_MS);
}

function reset() {
  shown = 0;
  animated = '';
  pointed = null;
  ui.frame.removeAttribute('src');
  player?.destroy();
  player = null;
}

async function start() {
  try {
    context = await gugu.getContext();
  } catch (error) {
    showError(error);
    return;
  }
  text = textFor(context.locale);
  const resized = new ResizeObserver(reproject);
  resized.observe(ui.frame);
  resized.observe(ui.canvas);
  // Each change brings the whole context: moved to another task, or to a place with none, it is that place's now.
  gugu.onContextChanged((next) => {
    const moved = (next.session?.id ?? null) !== sessionId();
    context = next;
    text = textFor(context.locale);
    if (moved) reset();
    void refresh();
  });
  gugu.onProgramNotification((notification) => {
    if (notification.method === CHANGED) void refresh();
  });
  await refresh();
}

void start();
