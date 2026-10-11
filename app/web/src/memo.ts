// memo 条：AI 在 Claude Code 里留下的说明。
// 小事：已经改完了（pending），你可以接受、整组撤回、逐条撤回。
// 大事：只是提议（proposed），文件还没动；纸上和时间轴上用虚线预览，你「照这样做」「逐条挑」或者「不要」，由 app 执行。
import { L } from './i18n';
import { commit, log, markDirty, paperPath, restoreVersion, S, BACKUP, saveVersion } from './store';
import { openDoc } from './doc';
import { ANIMALS, animalName, Change, editedSince, Memo } from './types';
import { $, fill, h, toast } from './util';

let expanded: string | null = null;
/** 点完一条，下一条刚换上来的 0.4 秒里不响应：连点时不会误点到下一条的按钮 */
let busyUntil = 0;
const guard = (fn: () => void) => () => { if (Date.now() < busyUntil) return; busyUntil = Date.now() + 400; fn(); };
/** 逐条挑：没勾上的 change 下标 */
const unpicked = new Map<string, Set<number>>();
/** 预览开关（默认开） */
let preview = true;

const pathOf = (m: Memo) => (m as any)._path as string;
const live = (m: Memo) => m.status === 'pending' || m.status === 'proposed';

export function renderMemos() {
  const bar = $('#memo')!;
  // 提议排在前面：它在等你拿主意
  const queue = S.memos.filter(live).sort((a, b) => (a.status === 'proposed' ? 0 : 1) - (b.status === 'proposed' ? 0 : 1));
  if (!queue.length) { bar.replaceChildren(); bar.hidden = true; return; }
  bar.hidden = false;
  const m = queue[0];
  const who = m.by !== 'me' ? ANIMALS[m.by] : null;
  const proposed = m.status === 'proposed';
  const liveChanges = m.changes.filter(c => !c.reverted && !c.kept);
  const open = expanded === m.id || (proposed && expanded !== `closed:${m.id}`);
  bar.classList.toggle('proposed', proposed);
  fill(bar,
    h('div', { class: 'memo-row' },
      h('span', { class: 'memo-who' }, who ? `${who.emoji} ${animalName(m.by)}` : m.by),
      h('span', { class: 'memo-time' }, m.time.slice(11, 16)),
      proposed ? h('span', { class: 'memo-tag' }, L('提议 · 还没动', 'Proposal · nothing changed yet')) : null,
      h('span', { class: 'memo-title' }, m.title),
      m.changes.length ? h('span', { class: 'memo-n' }, proposed ? L(`要动 ${m.changes.length - (unpicked.get(m.id)?.size ?? 0)} 处`, `${m.changes.length - (unpicked.get(m.id)?.size ?? 0)} changes`) : L(`动了 ${liveChanges.length} 处`, `${liveChanges.length} changed`)) : null,
      h('span', { class: 'grow' }),
      queue.length > 1 ? h('span', { class: 'memo-more' }, L(`还有 ${queue.length - 1} 条`, `${queue.length - 1} more`)) : null,
      m.changes.length ? h('button', { class: 'text-btn', type: 'button', onclick: () => { expanded = open ? `closed:${m.id}` : m.id; renderMemos(); } }, open ? L('收起', 'Hide') : proposed ? L('逐条挑', 'Pick one by one') : L('看看改了哪些', 'See what changed')) : null,
      ...(proposed ? [
        h('label', { class: 'memo-preview', title: L('在纸上和时间轴上用虚线显示要挪到哪', 'Show proposed moves as dashed outlines') },
          h('input', { type: 'checkbox', checked: preview, onchange: () => { preview = !preview; renderMemos(); window.dispatchEvent(new Event('diem:preview')); } }), L('预览', 'Preview')),
        h('button', { class: 'pill', type: 'button', onclick: guard(() => decline(m)) }, L('不要', 'No thanks')),
        h('button', { class: 'pill primary', type: 'button', onclick: guard(() => carryOut(m)) }, L('照这样做', 'Do it')),
      ] : [
        // 撤回不放在这一行：连着点「接受」时按钮会挪位，容易误点成撤回（10/4 她说的）。要撤回就点开「看看改了哪些」
        h('button', { class: 'pill primary', type: 'button', onclick: guard(() => accept(m)) }, L('接受', 'Accept')),
      ]),
    ),
    open ? h('div', { class: 'memo-detail' },
      m.why ? h('p', { class: 'memo-why' }, m.why) : null,
      h('ul', null, ...(proposed ? pickRows(m) : rows(m))),
      !proposed && (m.restore || liveChanges.length) ? h('div', { class: 'memo-undo' },
        m.restore ? h('button', { class: 'link-btn', type: 'button', onclick: () => backToBefore(m) }, L('回到整理前', 'Back to before')) : null,
        liveChanges.length ? h('button', { class: 'link-btn', type: 'button', onclick: () => { if (confirm(L(`撤回「${m.title}」的全部改动？`, `Undo every change in "${m.title}"?`))) revertAll(m); } }, L('全部撤回', 'Undo all')) : null) : null) : null,
  );
}

// ───────── 已经改完的：撤回 ─────────

/** 有 group 的按目的合成一行：「归到 工作 · 这几天：A、B、C」；没有的一条一行 */
function rows(m: Memo) {
  const out: HTMLElement[] = [];
  const seen = new Set<string>();
  m.changes.forEach((c, i) => {
    if (!c.group) {
      out.push(h('li', { class: c.reverted ? 'reverted' : '' },
        h('span', null, lbl(c)),
        c.reverted ? h('small', null, L('已撤回', 'Undone'))
          : c.kept ? h('small', null, L('你后来改过，留着', 'You changed it since; kept'))
          : h('button', { class: 'link-btn', type: 'button', onclick: () => revertOne(m, i) }, L('撤回这条', 'Undo this'))));
      return;
    }
    if (seen.has(c.group)) return;
    seen.add(c.group);
    const idx = groupIdx(m, c.group);
    const alive = idx.filter(j => !m.changes[j].reverted && !m.changes[j].kept);
    out.push(h('li', { class: 'grp' + (alive.length ? '' : ' reverted') },
      h('div', { class: 'grp-head' },
        h('b', null, c.group),
        alive.length ? h('button', { class: 'link-btn', type: 'button', onclick: () => revertGroup(m, alive) }, L('撤回这组', 'Undo group')) : h('small', null, L('已撤回', 'Undone'))),
      h('div', { class: 'grp-who' }, ...labels(m, idx))));
  });
  return out;
}

/** 这处改动挂着笔记（after.doc）：名字能点开看 */
function lbl(c: Change): Node | string {
  const doc = (c.after as { doc?: unknown } | null)?.doc;
  return typeof doc === 'string'
    ? h('button', { class: 'link-btn', type: 'button', title: L('打开笔记', 'Open note'), onclick: (e: Event) => { e.preventDefault(); openDoc(doc, c.label.split('\n')[0]); } }, c.label)
    : c.label;
}
const labels = (m: Memo, idx: number[]) => idx.flatMap((j, k) => (k ? ['、', lbl(m.changes[j])] : [lbl(m.changes[j])]));

const groupIdx = (m: Memo, g: string) => m.changes.map((x, j) => (x.group === g ? j : -1)).filter(j => j >= 0);

function revertGroup(m: Memo, idx: number[]) {
  const kept = revertSome(m, idx);
  log(L(`撤回 ${m.by} 的一组改动：${m.changes[idx[0]].group}${kept.length ? `（${kept.length} 处你后来改过，没动）` : ''}`, `Undid ${animalName(m.by)}'s group: ${m.changes[idx[0]].group}${kept.length ? ` (${kept.length} you changed since were kept)` : ''}`));
  toastKept(kept);
}

/** 撤回这几处；你后来又改过、或者已经做完的，留着不动（标 kept），返回这些的名字 */
function revertSome(m: Memo, idx: number[]): string[] {
  const ok = idx.filter(i => !blocked(m.changes[i]));
  const kept = idx.filter(i => !ok.includes(i));
  commit(() => { for (const i of [...ok].reverse()) back(m.changes[i]); });
  for (const i of ok) m.changes[i].reverted = true;
  for (const i of kept) m.changes[i].kept = true;
  settle(m);
  return kept.map(i => short(m.changes[i]));
}

const short = (c: Change) => `「${c.label.split('\n')[0]}」`;

function toastKept(kept: string[]) {
  if (kept.length) toast(L(`${kept.join('、')}在那之后你又改过或者做完了，没撤回，免得盖掉你写的`, `${kept.join(', ')}: you changed or finished these since, so they were kept`), 5000);
}

/** 每处都撤回了或者留着了，这条 memo 就算处理完 */
function settle(m: Memo) {
  if (m.changes.every(c => c.reverted || c.kept)) m.status = 'reverted';
  saveMemo(m);
}

function saveMemo(m: Memo) { markDirty(pathOf(m)); }

function accept(m: Memo) {
  m.status = 'accepted';
  saveMemo(m);
  log(L(`接受 ${m.by} 的 memo：${m.title}`, `Accepted ${animalName(m.by)}'s memo: ${m.title}`));
  if (m.by === '妥妥' || m.by === 'Toto') toast(L('等风来不如追风去', "Don't wait for the wind. Chase it."));
  renderMemos();
}

function revertAll(m: Memo) {
  const idx = m.changes.map((c, i) => (c.reverted || c.kept ? -1 : i)).filter(i => i >= 0);
  const kept = revertSome(m, idx);
  log(L(`撤回 ${m.by} 的整批改动：${m.title}${kept.length ? `（${kept.join('、')}你后来改过，没动）` : ''}`, `Undid all of ${animalName(m.by)}'s changes: ${m.title}${kept.length ? ` (kept ${kept.join(', ')}, changed since)` : ''}`));
  if (kept.length) toastKept(kept);
  else toast(L('这批改动都撤回了', 'All undone'));
}

/** 单撤一条：做完的不撤；你后来改过的，问一声再盖 */
function revertOne(m: Memo, i: number) {
  const c = m.changes[i];
  const why = blocked(c);
  if (why === 'done') {
    c.kept = true;
    settle(m);
    toast(L(`${short(c)}已经做完了，不撤回，你那天记的都留着`, `${short(c)} is already done, so it stays as you recorded it`), 5000);
    return;
  }
  if (why === 'edited' && !confirm(L(`${short(c)}在${m.by}改完之后，你又亲手改过。\n撤回会把它改回${m.by}动之前的样子，你后来写的会被盖掉。\n还是撤回？`, `You edited ${short(c)} after ${animalName(m.by)} changed it.\nUndoing puts it back to before ${animalName(m.by)}'s change and overwrites what you wrote.\nUndo anyway?`))) return;
  commit(() => back(c));
  c.reverted = true;
  settle(m);
  log(L(`撤回 ${m.by} 的一处改动：${c.label}`, `Undid one of ${animalName(m.by)}'s changes: ${c.label}`));
}

async function backToBefore(m: Memo) {
  if (!confirm(L('回到整理前的那一版？现在的样子会先存一版。', 'Go back to the version before the tidy-up? The current state is saved first.'))) return;
  await restoreVersion(m.restore!);
  m.status = 'reverted';
  m.changes.forEach(c => (c.reverted = true));
  saveMemo(m);
  log(L(`回到 ${m.by} 整理前的版本`, `Back to before ${animalName(m.by)}'s tidy-up`));
}

// ───────── 提议：逐条挑、照这样做、不要 ─────────

function pickRows(m: Memo) {
  const skip = unpicked.get(m.id) ?? new Set<number>();
  const toggle = (idx: number[], on: boolean) => {
    for (const i of idx) on ? skip.delete(i) : skip.add(i);
    unpicked.set(m.id, skip);
    renderMemos();
    window.dispatchEvent(new Event('diem:preview'));
  };
  const out: HTMLElement[] = [];
  const seen = new Set<string>();
  m.changes.forEach((c, i) => {
    const idx = c.group ? groupIdx(m, c.group) : [i];
    if (c.group) { if (seen.has(c.group)) return; seen.add(c.group); }
    const on = idx.some(j => !skip.has(j));
    out.push(h('li', { class: 'pick' + (on ? '' : ' off') },
      h('label', null,
        h('input', { type: 'checkbox', checked: on, onchange: () => toggle(idx, !on) }),
        c.group ? h('span', null, h('b', null, c.group), '：', ...labels(m, idx)) : h('span', null, lbl(c)))));
  });
  return out;
}

async function carryOut(m: Memo) {
  const skip = unpicked.get(m.id) ?? new Set<number>();
  const picked = m.changes.map((_, i) => i).filter(i => !skip.has(i));
  if (!picked.length) { decline(m); return; }
  // 动纸之前先存一版
  const papers = new Set(picked.map(i => m.changes[i].file).filter(f => f.startsWith('ideas/')).map(f => f.slice(6, -5)));
  for (const id of papers) await saveVersion(id, L(`${m.by}的提议执行前`, `before-${animalName(m.by)}-proposal`));
  const conflicts: string[] = [];
  commit(() => {
    for (const i of picked) {
      if (forward(m.changes[i])) m.changes[i].applied = true;
      else conflicts.push(m.changes[i].label);
    }
  });
  for (const i of skip) m.changes[i].reverted = true;
  m.status = 'accepted';
  (m as any).decidedAt = new Date().toISOString();
  saveMemo(m);
  unpicked.delete(m.id);
  log(L(`照 ${m.by} 的提议做了：${m.title}（${picked.length - conflicts.length} 处${skip.size ? `，没要 ${skip.size} 处` : ''}）`, `Did ${animalName(m.by)}'s proposal: ${m.title} (${picked.length - conflicts.length} changes${skip.size ? `, skipped ${skip.size}` : ''})`));
  toast(conflicts.length ? L(`做好了；有 ${conflicts.length} 处你之前改过，没动：${conflicts.join('、')}`, `Done. ${conflicts.length} you had changed were left alone: ${conflicts.join(', ')}`)
    : m.by === '妥妥' || m.by === 'Toto' ? L('等风来不如追风去', "Don't wait for the wind. Chase it.") : L('照这样做好了', 'Done'));
  window.dispatchEvent(new Event('diem:preview'));
}

function decline(m: Memo) {
  m.status = 'declined';
  (m as any).decidedAt = new Date().toISOString();
  saveMemo(m);
  unpicked.delete(m.id);
  log(L(`没要 ${m.by} 的提议：${m.title}`, `Declined ${animalName(m.by)}'s proposal: ${m.title}`));
  toast(L('好，没动', 'OK, nothing changed'));
  renderMemos();
  window.dispatchEvent(new Event('diem:preview'));
}

// ───────── 改动的正反两个方向 ─────────

function target(c: Change): { list?: any[]; obj?: any } {
  if (c.file === BACKUP && c.kind === 'item') return { list: S.backup.items };
  const id = c.file.replace(/^ideas\//, '').replace(/\.json$/, '');
  const p = S.papers.get(id);
  if (!p || c.file !== paperPath(id)) return {};
  if (c.kind === 'paper') return { obj: p };
  return { list: c.kind === 'block' ? p.blocks : c.kind === 'arrow' ? p.arrows : c.kind === 'rule' ? p.rules : undefined };
}

function setFields(obj: any, fields: Record<string, unknown>) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) delete obj[k];
    else obj[k] = v;
  }
}

/** 撤回之前看一眼：AI 改完之后你又动过（'edited'），或者已经做完了（'done'），就不该照 before 盖回去 */
function blocked(c: Change): 'done' | 'edited' | null {
  if (!c.after) return null;                                 // AI 删掉的：放回来不会盖掉什么
  const { list, obj } = target(c);
  const cur = obj ?? list?.find(x => x.id === c.id);
  return cur ? editedSince(cur, c.after) : null;
}

/** 撤回：按 before 恢复（先用 blocked 看过） */
function back(c: Change) {
  const { list, obj } = target(c);
  if (obj) { if (c.before) setFields(obj, c.before); return; }
  if (!list) { toast(L(`找不到 ${c.file}，这条没法撤回`, `Can't find ${c.file}, so this can't be undone`)); return; }
  const at = list.findIndex(x => x.id === c.id);
  if (c.before === null) {
    if (at >= 0) list.splice(at, 1);                       // AI 新建的：删掉
  } else if (c.after === null) {
    if (at < 0) list.push({ ...c.before, id: c.id });      // AI 删掉的：放回来
  } else if (at >= 0) {
    const o = list[at];
    for (const k of Object.keys(c.after)) if (!(k in c.before)) delete o[k];
    setFields(o, c.before);
    o.by = 'me';
  }
}

/** 执行提议：按 after 改。你在提议之后又亲手改过的（和 before 对不上），不动，返回 false */
function forward(c: Change): boolean {
  const { list, obj } = target(c);
  if (obj) { if (c.after) setFields(obj, c.after); return true; }
  if (!list) return false;
  const at = list.findIndex(x => x.id === c.id);
  if (c.before === null) {
    if (at < 0 && c.after) list.push({ ...c.after, id: c.id });
    return true;
  }
  if (at < 0) return false;
  const o = list[at];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!Object.entries(c.before).every(([k, v]) => same(o[k], v))) return false;
  if (c.after === null) list.splice(at, 1);
  else setFields(o, c.after);
  return true;
}

// ───────── 给纸和时间轴的预览 ─────────

/** 当前提议里、要对某个文件的某类东西做的改动（id → after）。预览关着或者没勾上的不算 */
export function proposedFor(file: string, kind: Change['kind']): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!preview) return out;
  const m = S.memos.find(x => x.status === 'proposed');
  if (!m) return out;
  const skip = unpicked.get(m.id) ?? new Set<number>();
  m.changes.forEach((c, i) => {
    if (c.file === file && c.kind === kind && c.after && !skip.has(i)) out.set(c.id, c.after);
  });
  return out;
}

export const proposalBy = () => S.memos.find(x => x.status === 'proposed')?.by;
