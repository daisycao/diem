// 竖向时间轴：照 Quo Vadis 竖轴手账，平时显示早 7 点到晚 12 点；早起、或排到 7 点以前，就往上接（最早到 5 点）；熬夜、或排到 0 点以后，就往下接到凌晨。
import { addPlanned, addRecord, leftMenu, partDone, partDoneLater, setPlan, toggleItemDone } from './actions';
import { openDetail } from './detail';
import { ghost, highlight, track, zoneAt } from './drag';
import { showInfo, showMenu } from './menu';
import { focusBlock } from './paper';
import { BACKUP, commit, itemById, log, releaseEdit, render, S } from './store';
import { proposedFor } from './memo';
import { L } from './i18n';
import { ANIMALS, animalName, Item, Plan } from './types';

/** 时间轴上的一块：排着的事，或者做过的一截（piece 是它在 pieces 里的位置） */
interface Slot { it: Item; p: Plan; piece?: number }
import { whatOf } from './sites';
import { appColor, ensureUsage, usage, usageByApp } from './usage';
import { $, addDays, DAY_TURN, dayLabel, dur, fill, h, hm, isoNow, leftText, MIN_EST, nowMin, parseEst, relDay, toast, ymd } from './util';

/** 时间轴从几点画起：平时 7 点（比 8 点多留一小时，好往前拖）；更早有事、有记录，就再往上接一小时，最早到 5 点一天翻篇 */
export let DAY_START = 7 * 60;
/** 时间轴画到几点：平时 24 点，熬夜的时候临时往下接（最多到凌晨 5 点，那时一天翻篇） */
let DAY_END = 24 * 60;
const MAX_END = (24 + DAY_TURN) * 60;
const HOUR = 54;
const px = (min: number) => ((min - DAY_START) / 60) * HOUR;
/** 离红线这么近（分钟）就吸到红线上 */
const NOW_SNAP = 10;

function startOf(starts: number[]): number {
  const first = Math.min(8 * 60, ...starts.filter(t => t >= DAY_TURN * 60));
  return Math.max(DAY_TURN * 60, Math.min(7 * 60, Math.floor(first / 60) * 60 - 60));
}

/** 这一天要画到几点：排到 0 点以后的、记到的使用、还在熬夜的现在，都要露出来，再多留一小时好往下拖 */
function endOf(day: string, ends: number[]): number {
  const last = Math.max(0, ...ends, day === ymd() && nowMin() >= 22 * 60 ? nowMin() : 0);
  return last <= 23 * 60 ? 24 * 60 : Math.min(MAX_END, Math.max(24 * 60, Math.ceil(last / 60) * 60 + 60));
}

/** 屏幕上的 y → 这一天的分钟数（按 15 分钟吸附；今天拖到红线附近，开头或结尾就贴着红线） */
export function timeAt(clientY: number, len = 30): number {
  const grid = $('#tl-grid');
  if (!grid) return 540;
  const r = grid.getBoundingClientRect();
  const m = DAY_START + ((clientY - r.top) / HOUR) * 60;
  const clamp = (t: number) => Math.max(DAY_START, Math.min(DAY_END - Math.min(len, 60), t));
  let snapped = Math.round(m / 15) * 15, onNow = false;
  if (S.day === ymd()) {
    const n = nowMin();
    // 刚做完的事：底边贴红线；接下来要做的：顶边贴红线
    if (Math.abs(m + len - n) <= NOW_SNAP && Math.abs(m + len - n) < Math.abs(m - n)) { snapped = n - len; onNow = true; }
    else if (Math.abs(m - n) <= NOW_SNAP) { snapped = n; onNow = true; }
  }
  grid.querySelector('.tl-now')?.classList.toggle('snap', onNow);
  return clamp(snapped);
}

/** 拖着一件事经过时间轴：按预计时长画一块影子，落下去就是这么长。clientY 是 null 就收起来 */
export function dropShadow(clientY: number | null, len = MIN_EST, noEst = false) {
  const grid = $('#tl-grid');
  let el = document.getElementById('tl-shadow');
  if (clientY == null || !grid) { el?.remove(); grid?.querySelector('.tl-now')?.classList.remove('snap'); return; }
  if (!el) { el = h('div', { id: 'tl-shadow', class: 'tl-shadow' }); grid.append(el); }
  const start = timeAt(clientY, len);
  el.style.top = px(start) + 1 + 'px';
  el.style.height = Math.max(20, (len / 60) * HOUR - 2) + 'px';
  el.classList.toggle('min', noEst);
  el.textContent = `${hm(start)}–${hm(start + len)}` + (noEst ? L(' · 还没写多久，先放最小框', ' · no estimate yet, smallest box') : ` · ${dur(len)}`);
}

export function renderTimeline() {
  const today = ymd();
  const day = S.day;
  const items = S.backup.items.filter(i => i.plan?.date === day);
  const planned = items.reduce((s, i) => s + i.plan!.dur, 0);
  // 进度条（学 Sunsama 的 Today）：这一天排上的时间里做完了多少；做过的一截也算做完的
  const bits = S.backup.items.flatMap(i => (i.pieces ?? []).filter(p => p.date === day));
  const doneMin = items.filter(i => i.done).reduce((s, i) => s + i.plan!.dur, 0) + bits.reduce((s, p) => s + p.dur, 0);
  const allMin = planned + bits.reduce((s, p) => s + p.dur, 0);
  const pct = allMin ? Math.min(1, doneMin / allMin) : 0;
  const useOn = !!S.ui.labs?.usage;
  if (useOn) ensureUsage();
  const segs = useOn && usage.day === day ? usage.segs : [];
  const slotEnds = [...items.map(i => i.plan!.start + i.plan!.dur), ...bits.map(p => p.start + p.dur)];
  const useEnds = segs.map(g => g.e / 60);
  DAY_END = endOf(day, [...slotEnds, ...useEnds]);
  const slotStarts = [...items.map(i => i.plan!.start), ...bits.map(p => p.start)];
  const useStarts = segs.map(g => g.s / 60);
  DAY_START = startOf([...slotStarts, ...useStarts, ...(day === today ? [nowMin()] : [])]);

  const from = day === today ? Math.max(DAY_START, nowMin()) : DAY_START;
  const ahead = items.filter(i => !i.done && i.plan!.start + i.plan!.dur > from).reduce((s, i) => s + Math.min(i.plan!.dur, i.plan!.start + i.plan!.dur - from), 0);
  // 留白算到 24 点；熬过 0 点了就不算留白、也不说满了
  const late = from >= 24 * 60;
  const free = Math.max(0, 24 * 60 - from - ahead);
  const tight = day >= today && !late && ahead > (24 * 60 - from) * 0.6;
  // 电脑用了多久不写在头上占地方，点细条顶上的图标再浮出来
  const appLines = (list: [string, number][]) => list.map(([a, t]) => `${a}  ${dur(Math.max(1, Math.round(t / 60)))}`);
  const total = (list: [string, number][]) => dur(Math.round(list.reduce((s, [, t]) => s + t, 0) / 60));
  const macInfo = (el: Element) => { const apps = usageByApp(); showInfo(el, `${L('电脑', 'Mac')} ${total(apps)}`, appLines(apps)); };

  fill($('#time-head')!,
    h('button', { class: 'icon-btn', type: 'button', title: L('前一天', 'Previous day'), onclick: () => go(addDays(day, -1)) }, '‹'),
    h('div', { class: 'tl-day' },
      h('div', { class: 'tl-day-main' }, h('span', null, dayLabel(day))),
      h('div', { class: 'tl-day-sub' + (tight ? ' tight' : '') },
        relDay(day, today) + (planned ? L(` · 排了 ${dur(planned)}`, ` · ${dur(planned)} planned`) : '') + (day >= today && !late ? L(` · 留白 ${dur(free)}`, ` · ${dur(free)} free`) : '') + (tight ? L(' · 有点满了', ' · getting full') : '')),
      allMin ? h('div', { class: 'tl-progress', title: L(`做完 ${dur(doneMin)}，一共 ${dur(allMin)}`, `${dur(doneMin)} of ${dur(allMin)} done`) },
        h('div', { class: 'tl-progress-bar' }, h('div', { style: { width: pct * 100 + '%' } })),
        h('span', null, doneMin ? L(`做完 ${dur(doneMin)}`, `${dur(doneMin)} done`) : L('还没开始', 'Not started'))) : null),
    h('button', { class: 'icon-btn', type: 'button', title: L('后一天', 'Next day'), onclick: () => go(addDays(day, 1)) }, '›'),
    day !== today ? h('button', { class: 'text-btn', type: 'button', onclick: () => go(today) }, L('今天', 'Today')) : null,
  );

  const grid = h('div', { id: 'tl-grid', class: 'tl-grid', style: { height: px(DAY_END) + 'px' } });
  for (let t = DAY_START; t <= DAY_END; t += 30) {
    const hour = t % 60 === 0;
    grid.append(h('div', { class: 'tl-line' + (hour ? ' hour' : ''), style: { top: px(t) + 'px' } },
      hour ? h('span', { class: 'tl-hour' + (t > 24 * 60 ? ' late' : '') }, String(t <= 24 * 60 ? t / 60 : t / 60 - 24)) : null));
  }
  if (day === today) {
    const n = nowMin();
    if (n >= DAY_START) {
      grid.append(h('div', { class: 'tl-past', style: { height: px(Math.min(n, DAY_END)) + 'px' } }));
      if (n < DAY_END) grid.append(h('div', { class: 'tl-now', style: { top: px(n) + 'px' } }, h('span', null, hm(n))));
    }
  }
  // 细条顶上的小标签，滚动时一直贴在上面
  if (segs.length) grid.append(h('div', { class: 'tl-use-labels' },
    h('button', { class: 'mac', type: 'button', title: L('左边细条：电脑上在用什么，点一下看用了多久', 'Left strip: what you used on your Mac. Click for totals'), onclick: (e: Event) => macInfo(e.currentTarget as Element) }, icon('mac'))));
  // 左边一根细条：电脑上实际在用什么（实验功能，后台 diem-recorder 记的）
  for (const g of segs) {
    const s = Math.max(DAY_START, g.s / 60), e = Math.min(DAY_END, g.e / 60);
    if (e <= s) continue;
    grid.append(h('div', {
      class: 'tl-use', title: `${whatOf(g)}${g.title ? ` · ${g.title}` : ''}\n${hm(Math.floor(g.s / 60))}–${hm(Math.ceil(g.e / 60))}`,
      style: { top: px(s) + 'px', height: Math.max(1.5, px(e) - px(s)) + 'px', background: appColor(whatOf(g)) },
    }));
  }
  const slots: Slot[] = items.map(it => ({ it, p: it.plan! }));
  for (const it of S.backup.items) (it.pieces ?? []).forEach((p, k) => { if (p.date === day) slots.push({ it, p, piece: k }); });
  for (const [slot, lane, lanes] of layout(slots)) grid.append(slot.piece != null ? pieceEl(slot, lane, lanes) : blockEl(slot.it, lane, lanes));
  // 提议预览：妥妥想把事排到哪，画成虚线框
  for (const [id, after] of proposedFor(BACKUP, 'item')) {
    const plan = after.plan as Item['plan'];
    if (!plan || plan.date !== day) continue;
    const it = itemById(id);
    grid.append(h('div', {
      class: 'tb-ghost', title: L(`提议排在这里：${it?.title ?? after.title}`, `Proposed here: ${it?.title ?? after.title}`),
      style: { top: px(plan.start) + 1 + 'px', height: Math.max(20, (plan.dur / 60) * HOUR - 2) + 'px' },
    }, h('span', null, `${it?.title ?? after.title ?? ''} · ${hm(plan.start)}–${hm(plan.start + plan.dur)}`)));
  }

  const body = $('#time-body')!;
  const keep = body.scrollTop;
  const first = !body.firstChild;
  body.replaceChildren(grid);
  body.scrollTop = keep;
  if (first) body.scrollTop = Math.max(0, px(day === today ? nowMin() - 60 : 540));
}

/** 细条顶上的小图标 */
function icon(kind: 'mac' | 'phone'): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = kind === 'mac'
    ? '<rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/>'
    : '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.2h2"/>';
  return svg;
}

function go(day: string) {
  S.day = day;
  render();
}

/** 重叠的并排放 */
function layout(items: Slot[]): [Slot, number, number][] {
  const sorted = items.slice().sort((a, b) => a.p.start - b.p.start || b.p.dur - a.p.dur);
  const out: [Slot, number, number][] = [];
  let cluster: [Slot, number][] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = laneEnds.length;
    for (const [it, lane] of cluster) out.push([it, lane, n]);
    cluster = []; laneEnds = [];
  };
  for (const it of sorted) {
    const s = it.p.start, e = s + it.p.dur;
    if (s >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex(end => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    cluster.push([it, lane]);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

function blockEl(it: Item, lane: number, lanes: number): HTMLElement {
  const p = it.plan!;
  const who = it.by && it.by !== 'me' ? ANIMALS[it.by] : null;
  const height = Math.max(20, (p.dur / 60) * HOUR - 2);
  return h('div', {
    class: ['tb', it.done && 'done', height < 34 && 'short', it.star && 'star'].filter(Boolean).join(' '),
    dataset: { tid: it.id },
    style: { top: px(p.start) + 1 + 'px', height: height + 'px', left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` },
  },
    h('button', { class: 'box', type: 'button', 'aria-label': L('做完 / 没做完', 'Done / not done'), 'aria-pressed': String(!!it.done) }),
    h('div', { class: 'tb-main' },
      h('div', { class: 'tb-title' }, it.title),
      h('div', { class: 'tb-time' }, `${hm(p.start)}–${hm(p.start + p.dur)}`)),
    who ? h('span', { class: 'badge', title: L(`${animalName(it.by!)} 排的`, `Planned by ${animalName(it.by!)}`) }, who.emoji) : null,
    h('div', { class: 'tb-resize', title: L('拖动改时长', 'Drag to change length') }),
  );
}

/** 做过的一截：打过勾的样子，写着「做了一截」，不能拖 */
function pieceEl({ it, p, piece }: Slot, lane: number, lanes: number): HTMLElement {
  const height = Math.max(20, (p.dur / 60) * HOUR - 2);
  return h('div', {
    class: ['tb', 'piece', height < 34 && 'short'].filter(Boolean).join(' '),
    dataset: { tid: it.id, piece: String(piece) }, title: L(`「${it.title}」做了一截${it.done ? '，后来做完了' : it.left ? `，还剩${leftText(it.left)}` : ''}`, `Part of "${it.title}"${it.done ? ', finished later' : it.left ? `, ${leftText(it.left)} left` : ''}`),
    style: { top: px(p.start) + 1 + 'px', height: height + 'px', left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` },
  },
    h('span', { class: 'tb-mark' }, '✓'),
    h('div', { class: 'tb-main' },
      h('div', { class: 'tb-title' }, it.title),
      h('div', { class: 'tb-time' }, `${hm(p.start)}–${hm(p.start + p.dur)} · ${L('做了一截', 'partly done')}`)));
}

function dropPiece(it: Item, k: number) {
  const p = it.pieces![k];
  commit(() => { it.pieces = it.pieces!.filter((_, i) => i !== k); if (!it.pieces.length) delete it.pieces; it.updated = isoNow(); });
  log(L(`不算「${it.title}」${hm(p.start)}–${hm(p.start + p.dur)} 那一截`, `Removed the ${hm(p.start)}–${hm(p.start + p.dur)} part of "${it.title}"`), p.date);
}

// ───────── 事件 ─────────

function onPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  if (e.button !== 0 || !releaseEdit(t)) return;
  const el = t.closest('.tb') as HTMLElement | null;
  if (!el || t.closest('.box')) return;
  const it = itemById(el.dataset.tid!)!;
  // 做了一截的是记录，拖不动；拖的时候说一声怎么去掉
  if (el.dataset.piece != null) {
    let told = false;
    track(e, { onMove() { if (!told) { told = true; toast(L('「做了一截」是做过的记录，拖不动。记错了就右键它，选「不算这一截」', 'A done part is a record and stays put. Right-click it and choose "Remove this part" if it is wrong')); } }, onEnd() { /* 没有要做的 */ } });
    return;
  }
  const p = it.plan!;
  if (t.closest('.tb-resize')) {
    track(e, {
      onMove(_ev, _dx, dy) {
        let len = Math.max(15, Math.round((p.dur + (dy / HOUR) * 60) / 15) * 15), onNow = false;
        // 刚做完往下拉：底边离红线近就贴到红线上，不按 15 分钟取整
        const n = nowMin();
        if (S.day === ymd() && n - p.start >= 5 && Math.abs(p.start + p.dur + (dy / HOUR) * 60 - n) <= NOW_SNAP) { len = n - p.start; onNow = true; }
        $('#tl-grid')?.querySelector('.tl-now')?.classList.toggle('snap', onNow);
        el.style.height = (len / 60) * HOUR - 2 + 'px';
        el.querySelector('.tb-time')!.textContent = `${hm(p.start)}–${hm(p.start + len)}`;
        el.dataset.len = String(Math.min(len, DAY_END - p.start));
      },
      onEnd(_ev, moved) {
        $('#tl-grid')?.querySelector('.tl-now')?.classList.remove('snap');
        if (moved && el.dataset.len) setPlan(it.id, { ...p, dur: Number(el.dataset.len) });
      },
    }, 2);
    return;
  }
  const grab = e.clientY - el.getBoundingClientRect().top;
  let start = p.start;
  track(e, {
    onStart() { el.classList.add('dragging'); },
    onMove(ev) {
      const zone = zoneAt(ev.clientX, ev.clientY);
      if (zone === 'list') {
        ghost(`${it.title} → ${L('放回没排', 'unplan')}`, ev.clientX, ev.clientY);
        highlight('list');
        el.classList.add('lifted');
      } else {
        ghost(null); highlight(null);
        el.classList.remove('lifted');
        start = Math.min(DAY_END - p.dur, timeAt(ev.clientY - grab + 1, p.dur));
        el.style.top = px(start) + 1 + 'px';
        el.querySelector('.tb-time')!.textContent = `${hm(start)}–${hm(start + p.dur)}`;
      }
    },
    onEnd(ev, moved) {
      if (!moved) { openDetail(it.id); return; }
      const zone = zoneAt(ev.clientX, ev.clientY);
      if (zone === 'list') setPlan(it.id, null);
      else setPlan(it.id, { ...p, date: S.day, start: Math.max(DAY_START, start) });
    },
  });
}

function onClick(e: MouseEvent) {
  const box = (e.target as HTMLElement).closest('.box');
  const el = (e.target as HTMLElement).closest('.tb') as HTMLElement | null;
  if (el?.dataset.piece != null) { openDetail(el.dataset.tid!); return; }
  if (box && el) toggleItemDone(el.dataset.tid!);
}

/** 双击空白：在这个时间写一件事；过去的时间就是补记 */
function onDblClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('.tb') || !t.closest('#tl-grid')) return;
  const start = timeAt(e.clientY - 10);
  const past = S.day < ymd() || (S.day === ymd() && start + 30 <= nowMin());
  const grid = $('#tl-grid')!;
  const input = h('input', {
    class: 'tl-input', type: 'text',
    placeholder: past ? L(`补记 ${hm(start)} 做了什么`, `What did you do at ${hm(start)}?`) : L(`${hm(start)} 要做什么`, `What at ${hm(start)}?`),
    style: { top: px(start) + 'px' },
  }) as HTMLInputElement;
  grid.append(input);
  S.editing = true;
  input.focus();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    S.editing = false;
    const title = input.value.trim();
    input.remove();
    // 写「开会 1H」就排一小时
    const { text, est } = parseEst(title);
    if (save && title) (past ? addRecord : addPlanned)(text, S.day, start, est ?? 30);
    else render();
  };
  input.onkeydown = ev => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
    ev.stopPropagation();
  };
  input.onblur = () => finish(true);
}

function onContextMenu(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest('.tb') as HTMLElement | null;
  if (!el) return;
  e.preventDefault();
  const it = itemById(el.dataset.tid!)!;
  if (el.dataset.piece != null) {
    const k = Number(el.dataset.piece);
    showMenu(e.clientX, e.clientY, [
      { label: L('详情…', 'Details…'), action: () => openDetail(it.id) },
      { label: it.left ? L(`还剩${leftText(it.left)}，改…`, `${leftText(it.left)} left, change…`) : L('还剩多少…', 'How much is left…'), action: () => leftMenu(it.id, e.clientX, e.clientY) },
      '-',
      { label: L('不算这一截', 'Remove this part'), hint: L('记录去掉', 'Deletes the record'), danger: true, action: () => dropPiece(it, k) },
    ]);
    return;
  }
  const p = it.plan!;
  showMenu(e.clientX, e.clientY, [
    { label: it.done ? L('没做完', 'Not done') : L('做完了', 'Done'), action: () => toggleItemDone(it.id) },
    ...(it.done || p.date !== ymd() ? [] : [{ label: L('做了一截，今天晚点接着做', 'Did part, continue later today'), hint: L('再排一段', 'Plans another slot'), action: () => partDoneLater(it.id) }]),
    ...(it.done ? [] : [{ label: L('做了一截，剩下的改天', 'Did part, rest another day'), hint: L('这块留作记录', 'This block stays as a record'), action: () => { if (partDone(it.id)) leftMenu(it.id, e.clientX, e.clientY); } }]),
    { label: L('详情…', 'Details…'), action: () => openDetail(it.id) },
    { label: L('挪到明天同一时间', 'Same time tomorrow'), action: () => setPlan(it.id, { ...p, date: addDays(p.date, 1) }) },
    { label: L('放回没排', 'Unplan'), action: () => setPlan(it.id, null) },
    ...(it.source ? ['-' as const, { label: L('回到纸上原处', 'Show on paper'), action: () => focusBlock(it.source!.paper, it.source!.block) }] : []),
  ]);
}

export function initTimeline() {
  const body = $('#time-body')!;
  body.addEventListener('pointerdown', onPointerDown);
  body.addEventListener('click', onClick);
  body.addEventListener('dblclick', onDblClick);
  body.addEventListener('contextmenu', onContextMenu);
  // 每分钟挪一下「现在」那条线
  setInterval(() => { if (!S.editing && S.day === ymd()) render(); }, 60_000);
}
