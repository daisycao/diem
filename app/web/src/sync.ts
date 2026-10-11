// 同步本：AI 在工作目录里做的每件事都有一行（sync/日期.jsonl）。
// 记录来自三处：Claude Code 的 hook（bin/sync-hook.mjs）、jot / day 这些脚本自己、
// 以及这里的兜底——文件被外面改了，同步本里却找不到对应的那一行，就记一条「没报备」。
import { L } from './i18n';
import { fs } from './bridge';
import { externalHooks, patternWatch, render, S } from './store';
import type { SyncLine } from './types';
import { ANIMALS } from './types';
import { $, fill, h, hm, isoNow, ymd } from './util';
import { sentToday } from './wowo';

let lines: SyncLine[] = [];
let loadedDay = '';
let open = false;

const pathFor = (day: string) => `sync/${day}.jsonl`;
/** notes/ 是你自己的笔记库（也可能交给别的 app，比如 Anew），这里不盯它报没报备 */
const watched = (p: string) => !p.startsWith('notes/');

export async function loadSync(path = pathFor(ymd())) {
  if (path !== pathFor(ymd())) return;
  loadedDay = ymd();
  const r = await fs.read(path);
  S.mtimes[path] = r?.mtime ?? 0;
  lines = (r?.text ?? '').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as SyncLine]; } catch { return []; } })
    .filter(l => !l.unreported || (l.files ?? []).some(watched));
}

export const unreportedToday = () => lines.filter(l => l.unreported).length;
/** 你自己在别的 app 里动的（agent: me）只用来对「报没报备」，不算进「今天 AI 做了什么」 */
const aiLines = () => lines.filter(l => l.agent !== 'me');

/** 外面改了文件：等几秒让 hook 写完，再看同步本里有没有这一笔（按文件自己的修改时间对，窗口藏起来一阵也不会错判） */
function onExternal(all: string[], st: Record<string, number>) {
  const paths = all.filter(watched);
  if (!paths.length) return;
  const when = new Map(paths.map(p => [p, st[p] * 1000]));
  setTimeout(async () => {
    await loadSync();
    // 这几秒里 app 自己又写过的（mtime 对得上）不算
    const now = await fs.stat();
    const near = (l: SyncLine, t: number) => Math.abs(new Date(l.t).getTime() - t) < 25_000;
    const missing = paths.filter(p => S.mtimes[p] !== now[p]).filter(p => {
      const t = when.get(p)!;
      return !lines.some(l => near(l, t) && (l.files?.includes(p) || (!l.files?.length && l.cmd)));
    });
    if (!missing.length) return;
    const line: SyncLine = { t: isoNow(), agent: 'unknown', tool: L('文件被改了', 'file changed'), files: missing, unreported: true };
    await fs.append(pathFor(ymd()), JSON.stringify(line) + '\n');
    await loadSync();
    render();
  }, 6000);
}

// ───────── 给人看的说法 ─────────

const WHO: Record<SyncLine['agent'], string> = { claude: 'Claude', codex: 'Codex', ai: 'AI', me: L('你', 'You'), unknown: '?' };

export function fileLabel(p: string): string {
  const paper = p.match(/^ideas\/([^/]+)\.json$/);
  if (paper) return L(`纸「${S.papers.get(paper[1])?.title ?? paper[1]}」`, `paper "${S.papers.get(paper[1])?.title ?? paper[1]}"`);
  if (p === 'lists/backup.json') return L('池塘', 'pond');
  if (p.startsWith('memo/')) return 'memo';
  if (p.startsWith('review/')) return `${L('日报', 'review')} ${p.slice(7).replace(/\.(json|html|md)$/, '')}`;
  if (p.startsWith('notes/')) return L(`笔记「${p.slice(6).replace(/\.md$/, '')}」`, `note "${p.slice(6).replace(/\.md$/, '')}"`);
  if (p.startsWith('photos/')) return L(`照片 ${p.slice(7)}`, `photo ${p.slice(7)}`);
  const named: Record<string, string> = {
    'interests.md': L('兴趣', 'interests'), 'consensus.md': L('共识', 'shared understanding'), '共识.md': L('共识', 'shared understanding'), 'inbox.md': 'inbox', 'fortune/palette.json': L('今日配色', "today's colors"),
  };
  return named[p] ?? p;
}

function describe(l: SyncLine): string {
  if (l.unreported) return L(`${(l.files ?? []).map(fileLabel).join('、')} 被改了，同步本里没对上记录（多半是你自己改的，看一眼就好）`, `${(l.files ?? []).map(fileLabel).join(', ')} changed with no matching log entry (probably you; just a heads-up)`);
  const files = [...new Set((l.files ?? []).map(fileLabel))].join('、');
  if (l.tool === 'jot') return `${L('记下来', 'Jotted')} → ${files || L('纸', 'paper')}${l.cmd ? `${L('：', ': ')}${l.cmd}` : ''}`;
  if (l.tool === 'day') return `${L('收日报素材', 'Gathered review material')}${l.cmd ? ` (${l.cmd})` : ''}`;
  if (l.tool === 'Bash') return `${L('跑命令', 'Ran')}${files ? L(`，动了 ${files}`, `, touched ${files}`) : ''}${L('：', ': ')}${l.cmd ?? ''}`;
  if (l.tool === 'Write') return `${L('写了', 'Wrote')} ${files}`;
  if (l.tool === 'Edit' || l.tool === 'MultiEdit') return `${L('改了', 'Edited')} ${files}`;
  return `${l.tool}${files ? `：${files}` : ''}${l.cmd ? `（${l.cmd}）` : ''}`;
}

/** 连着好几次改同一个文件的合成一行 */
function merged() {
  const out: { l: SyncLine; n: number; last: string }[] = [];
  for (const l of aiLines()) {
    const prev = out.at(-1);
    const key = (x: SyncLine) => `${x.agent}|${x.tool}|${(x.files ?? []).join(',')}|${x.unreported ? 1 : 0}|${x.tool === 'Bash' ? x.cmd : ''}`;
    if (prev && key(prev.l) === key(l) && new Date(l.t).getTime() - new Date(prev.last).getTime() < 120_000) {
      prev.n++; prev.last = l.t;
    } else out.push({ l, n: 1, last: l.t });
  }
  return out.reverse();
}

// ───────── 右上角：同步 ─────────

/** 同步本的数：今天 AI 做了几件、几处没对上（收在「我的」里） */
export function syncStatus(): { n: number; bad: number } {
  if (loadedDay && loadedDay !== ymd()) loadSync().then(render);
  if (open) renderPanel();
  return { n: aiLines().length, bad: unreportedToday() };
}

function renderPanel() {
  let panel = $('#sync-panel');
  if (!panel) {
    panel = h('aside', { id: 'sync-panel', class: 'side-panel', 'aria-label': L('同步本', 'Sync log') });
    document.body.append(panel);
  }
  const rows = merged();
  const wowo = sentToday();
  fill(panel,
    h('div', { class: 'sp-head' },
      h('b', null, L('今天 AI 做了什么', 'What the AI did today')),
      h('span', { class: 'grow' }),
      h('button', { class: 'text-btn', type: 'button', title: L('在访达里看同步本文件', 'Show the log file in Finder'), onclick: () => fs.reveal(pathFor(ymd())) }, L('文件', 'File')),
      h('button', { class: 'icon-btn', type: 'button', title: L('关上', 'Close'), onclick: () => toggleSync(false) }, '×')),
    h('p', { class: 'sp-note' }, L('工作目录里每一次写文件、跑命令都会自动记在这里，不靠 AI 自觉（要装 hook，见 README）。灰色斜体的是同步本里没对上的改动，留个底，不用处理。笔记（notes/）这里不管。',
      'Every file write and command in your Diem folder is logged here automatically, not on the honor system (needs the hook, see README). Grey italics are changes with no log entry, just for the record. Notes (notes/) are not tracked.')),
    rows.length ? h('ul', { class: 'sp-list' }, ...rows.map(({ l, n }) => h('li', { class: l.unreported ? 'bad' : '' },
      h('span', { class: 'sp-t' }, hm(new Date(l.t).getHours() * 60 + new Date(l.t).getMinutes())),
      h('span', { class: 'sp-who' }, WHO[l.agent]),
      h('span', { class: 'sp-what' }, describe(l), n > 1 ? h('small', null, ` ×${n}`) : null)))) :
      h('p', { class: 'sp-empty' }, L('今天 AI 还没动过工作目录。', "The AI hasn't touched your folder today.")),
    wowo.length ? h('div', { class: 'sp-sec' }, `${ANIMALS.喳喳.emoji} ${L('喳喳今天提醒过', 'Zaza reminded you today')}`) : null,
    wowo.length ? h('ul', { class: 'sp-list' }, ...wowo.map(w => h('li', null,
      h('span', { class: 'sp-t' }, w.time), h('span', { class: 'sp-what' }, w.text)))) : null,
  );
}

export function toggleSync(force?: boolean) {
  open = force ?? !open;
  if (open) renderPanel(); else $('#sync-panel')?.remove();
}

export function initSync() {
  patternWatch.push({ re: /^sync\/[^/]+\.jsonl$/, load: loadSync });
  externalHooks.push(onExternal);
}
