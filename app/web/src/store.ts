// 状态、读写文件、撤销、外部改动检测。
import { L } from './i18n';
import { fs, Info } from './bridge';
import type { Backup, Item, Memo, Paper, UIState } from './types';
import { animalName } from './types';
import { dayLabel, hm, stamp, toast, ymd } from './util';

export const BACKUP = 'lists/backup.json';
export const UI_FILE = '.diem/ui.json';
export const paperPath = (id: string) => `ideas/${id}.json`;

export const S = {
  info: null as Info | null,
  papers: new Map<string, Paper>(),
  cur: '',
  backup: { items: [] } as Backup,
  memos: [] as Memo[],
  ui: {
    mode: 'think',
    collapsed: { paper: false, list: false, time: false },
    widths: { paperPlan: 420, listThink: 300, time: 300 },
  } as UIState,
  /** 时间轴正在看哪一天 */
  // 浏览器调试可以用 ?day=YYYY-MM-DD 打开某一天 / ?day=YYYY-MM-DD opens a given day in the browser
  day: new URLSearchParams(location.search).get('day') ?? ymd(),
  mtimes: {} as Record<string, number>,
  /** 正在改文字时不做外部重载，免得把光标冲掉 */
  editing: false,
};

export const paper = (): Paper => S.papers.get(S.cur)!;

/** 在别处按下鼠标时：正在改的字先收好（等于点了别处），再接着拖。
 *  按在正在改的那个框里面就返回 false，照常打字。标记没清掉但其实没在改（框被重画掉了）也顺手清掉 */
export function releaseEdit(target: Element): boolean {
  if (!S.editing) return true;
  const a = document.activeElement as HTMLElement | null;
  const typing = a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  if (!typing) { S.editing = false; return true; }
  if (a.contains(target)) return false;
  a.blur();
  // 窗口没拿到焦点时 blur 不一定触发，自己补发一次，保证改的字存上
  if (S.editing) a.dispatchEvent(new FocusEvent('blur'));
  if (S.editing) S.editing = false;
  return true;
}
export const itemById = (id: string): Item | undefined => S.backup.items.find(i => i.id === id);

// ───────── 渲染 ─────────

let renderer: () => void = () => {};
export function setRenderer(fn: () => void) { renderer = fn; }
let raf = 0;
export function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => renderer());
}

// ───────── 读 ─────────

function normalizePaper(p: Partial<Paper>): Paper {
  return {
    id: p.id!, title: p.title ?? '', created: p.created ?? ymd(),
    blocks: p.blocks ?? [], arrows: p.arrows ?? [], rules: p.rules ?? [], side: p.side ?? [], slips: p.slips ?? [],
    ...(p.tidied ? { tidied: p.tidied } : {}),
    ...(p.archived ? { archived: p.archived } : {}),
  };
}

async function readJSON<T>(path: string): Promise<T | null> {
  const r = await fs.read(path);
  if (!r) return null;
  S.mtimes[path] = r.mtime;
  try { return JSON.parse(r.text) as T; } catch {
    toast(L(`${path} 不是合法的 JSON，先没读它`, `${path} is not valid JSON; skipped it`));
    return null;
  }
}

async function loadPaperFile(path: string) {
  const p = await readJSON<Paper>(path);
  if (!p) return;
  const id = path.slice('ideas/'.length, -'.json'.length);
  S.papers.set(id, normalizePaper({ ...p, id }));
}

async function loadMemo(path: string) {
  const m = await readJSON<Memo>(path);
  if (!m) return;
  m.id = m.id || path;
  (m as any)._path = path;
  S.memos = S.memos.filter(x => (x as any)._path !== path);
  S.memos.push(m);
  S.memos.sort((a, b) => (a.time < b.time ? 1 : -1));
}

export async function loadAll() {
  S.info = await fs.info();
  const ui = await readJSON<Partial<UIState>>(UI_FILE);
  if (ui) S.ui = { ...S.ui, ...ui, collapsed: { ...S.ui.collapsed, ...ui.collapsed }, widths: { ...S.ui.widths, ...ui.widths } };

  S.papers.clear();
  for (const e of await fs.list('ideas')) {
    if (!e.dir && e.name.endsWith('.json')) await loadPaperFile(`ideas/${e.name}`);
  }
  if (S.papers.size === 0) newPaperState();
  if (!activePapers().length) newPaperState();
  S.cur = S.ui.cur && S.papers.get(S.ui.cur) && !S.papers.get(S.ui.cur)!.archived ? S.ui.cur : activePapers().at(-1)!.id;

  const b = await readJSON<Backup>(BACKUP);
  S.backup = { items: b?.items ?? [] };

  S.memos = [];
  for (const e of await fs.list('memo')) {
    if (!e.dir && e.name.endsWith('.json')) await loadMemo(`memo/${e.name}`);
  }
}

export function sortedPapers(): Paper[] {
  return [...S.papers.values()].sort((a, b) => (a.created + a.id < b.created + b.id ? -1 : 1));
}

/** 纸夹里的纸（不算扔进纸箱的） */
export const activePapers = (): Paper[] => sortedPapers().filter(p => !p.archived);

/** 纸箱里的纸，最近扔的在上面 */
export const boxedPapers = (): Paper[] => [...S.papers.values()].filter(p => p.archived).sort((a, b) => (a.archived! < b.archived! ? 1 : -1));

/** 空白的纸：什么都没写，扔了不可惜 */
export const blankPaper = (p: Paper) => !p.blocks.length && !p.arrows.length && !p.rules.length && !p.side.length && !p.slips.length;

/** 新建一张纸（只改内存，调用方负责 commit/markDirty） */
export function newPaperState(): Paper {
  const today = ymd();
  let id = `paper-${today.replace(/-/g, '')}`;
  for (let n = 2; S.papers.has(id); n++) id = `paper-${today.replace(/-/g, '')}-${n}`;
  const p: Paper = {
    id, title: L(`就是那张纸 · ${dayLabel(today).split(' ')[0]}`, `The paper · ${dayLabel(today)}`), created: today,
    blocks: [], arrows: [], rules: [], side: [], slips: [],
  };
  S.papers.set(id, p);
  markDirty(paperPath(id));
  return p;
}

// ───────── 写 ─────────

const dirty = new Set<string>();
let flushTimer = 0;

function serialize(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of S.papers.values()) out[paperPath(p.id)] = JSON.stringify(p, null, 2) + '\n';
  out[BACKUP] = JSON.stringify(S.backup, null, 2) + '\n';
  return out;
}

export function markDirty(path: string) {
  dirty.add(path);
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 300);
}

export async function flush() {
  clearTimeout(flushTimer);
  const now = serialize();
  for (const path of [...dirty]) {
    dirty.delete(path);
    let text: string | undefined = now[path];
    if (path.startsWith('memo/')) {
      const m = S.memos.find(x => (x as any)._path === path);
      if (m) { const { _path, ...rest } = m as any; text = JSON.stringify(rest, null, 2) + '\n'; }
    }
    if (text == null) continue;
    const res = await fs.write(path, text, S.mtimes[path] ?? -1);
    if (res.conflict) {
      // 外面（Claude Code / jot）刚改过这个文件：以外面为准，重新读进来
      await reloadFile(path);
      toast(L('这个文件刚在外面被改过，已换成新的；你刚才那一步没存上，请再做一次', 'This file just changed outside the app and was reloaded. Your last step was not saved; please do it again'));
      render();
    } else {
      S.mtimes[path] = res.mtime;
    }
  }
}

let uiTimer = 0;
export function saveUI() {
  S.ui.cur = S.cur;
  clearTimeout(uiTimer);
  uiTimer = window.setTimeout(() => {
    fs.write(UI_FILE, JSON.stringify(S.ui, null, 2) + '\n').then(r => (S.mtimes[UI_FILE] = r.mtime));
  }, 400);
}

// ───────── 撤销 / 重做 / 版本 ─────────

const undoStack: Record<string, string>[] = [];
const redoStack: Record<string, string>[] = [];
/** 这次打开 app 后已经存过版本的纸 */
const versioned = new Set<string>();

/** 所有改动都走这里：自动记撤销、标脏、每张纸本次打开后第一次改动前存一版 */
export function commit(fn: () => void) {
  const before = serialize();
  fn();
  const after = serialize();
  const changed = Object.keys(after).filter(k => before[k] !== after[k]);
  if (changed.length) {
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    for (const path of changed) {
      markDirty(path);
      if (path.startsWith('ideas/') && before[path] && !versioned.has(path)) {
        versioned.add(path);
        const id = path.slice(6, -5);
        fs.write(`ideas/.versions/${id}/${stamp()}-${L('打开后第一次改动前', 'before-first-change')}.json`, before[path]);
      }
    }
  }
  render();
}

function applySnapshot(snap: Record<string, string>) {
  const now = serialize();
  for (const [path, text] of Object.entries(snap)) {
    if (now[path] === text) continue;
    const obj = JSON.parse(text);
    if (path === BACKUP) S.backup = obj;
    else S.papers.set(obj.id, normalizePaper(obj));
    markDirty(path);
  }
  render();
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) { toast(L('没有可以撤销的了', 'Nothing to undo')); return; }
  redoStack.push(serialize());
  applySnapshot(prev);
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(serialize());
  applySnapshot(next);
}

export async function saveVersion(id: string, reason: string) {
  const p = S.papers.get(id);
  if (!p) return;
  await fs.write(`ideas/.versions/${id}/${stamp()}-${reason}.json`, JSON.stringify(p, null, 2) + '\n');
}

export async function listVersions(id: string) {
  const list = await fs.list(`ideas/.versions/${id}`);
  return list.filter(e => e.name.endsWith('.json')).map(e => e.name).sort().reverse();
}

export async function restoreVersion(path: string) {
  const r = await fs.read(path);
  if (!r) { toast(L('找不到这个版本', "Can't find that version")); return; }
  const p = normalizePaper(JSON.parse(r.text));
  await saveVersion(p.id, L('回到旧版本前', 'before-restore'));
  commit(() => { S.papers.set(p.id, p); S.cur = p.id; });
  toast(L('已回到这一版（回去之前的样子也存了一版）', 'Restored (the state before was saved too)'));
}

// ───────── 外部改动 ─────────

async function reloadFile(path: string) {
  const pw = patternWatch.find(w => w.re.test(path));
  if (path in extraWatch) {
    await extraWatch[path]();
  } else if (pw) {
    await pw.load(path);
  } else if (path === BACKUP) {
    const b = await readJSON<Backup>(BACKUP);
    if (b) S.backup = { items: b.items ?? [] };
  } else if (/^ideas\/[^/]+\.json$/.test(path)) {
    await loadPaperFile(path);
  } else if (/^memo\/[^/]+\.json$/.test(path)) {
    await loadMemo(path);
  }
}

/** 其他模块要跟的文件：路径 → 重读函数 */
export const extraWatch: Record<string, () => Promise<void>> = {};
/** 按路径规则跟的文件（比如 sync/*.jsonl） */
export const patternWatch: { re: RegExp; load: (path: string) => Promise<void> }[] = [];
/** 外面（Claude Code / Codex / jot）改了文件时通知：同步本用它兜底 */
export const externalHooks: ((paths: string[], st: Record<string, number>) => void)[] = [];

const watched = (p: string) => p in extraWatch || patternWatch.some(w => w.re.test(p)) || p === BACKUP || /^ideas\/[^/]+\.json$/.test(p) || /^memo\/[^/]+\.json$/.test(p);

/** 上一轮看到的整个工作目录；用来发现外面改了哪些文件（不只是 app 在跟的那几个） */
let lastStat: Record<string, number> | null = null;
/** 不算「外面改的」：电脑 / 手机记录由 recorder 写，手机记的一笔由「这一天」自己收，同步本和 archive 由脚本写且自己会记 */
const quiet = (p: string) => /^(usage|sync|archive|phone)\//.test(p);

function externalChanges(st: Record<string, number>): string[] {
  const prev = lastStat;
  lastStat = st;
  if (!prev) return [];
  return Object.keys(st).filter(p => !quiet(p) && prev[p] !== st[p] && S.mtimes[p] !== st[p]);
}

export function startWatching() {
  let busy = false;
  setInterval(async () => {
    if (busy || document.hidden || S.editing || dirty.size) return;
    busy = true;
    try {
      const st = await fs.stat();
      const outside = externalChanges(st);
      if (outside.length) for (const fn of externalHooks) fn(outside, st);
      const changed = Object.keys(st).filter(p => watched(p) && S.mtimes[p] !== st[p]);
      if (!changed.length || S.editing || dirty.size) return;
      for (const p of changed) { await reloadFile(p); S.mtimes[p] = st[p]; }
      const fresh = S.memos.find(m => changed.includes((m as any)._path) && m.status === 'pending');
      if (fresh) toast(L(`${animalName(fresh.by)} 递来一条 memo：${fresh.title}`, `${animalName(fresh.by)} left a memo: ${fresh.title}`));
      render();
    } finally { busy = false; }
  }, 1500);
}

// ───────── 日志：log/YYYY-MM-DD.md ─────────

const logHeaders = new Set<string>();
export async function log(text: string, day = ymd()) {
  const path = `log/${day}.md`;
  if (!logHeaders.has(path)) {
    const r = await fs.read(path);
    if (!r) S.mtimes[path] = (await fs.write(path, `# ${dayLabel(day)}\n\n`)).mtime;
    logHeaders.add(path);
  }
  const d = new Date();
  const r = await fs.append(path, `- ${hm(d.getHours() * 60 + d.getMinutes())} ${text}\n`);
  S.mtimes[path] = r.mtime;
}
