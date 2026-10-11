// backup 清单：确定要做的事从纸上拖进来，每条可以写预计要多久。
import { L } from './i18n';
import { leftMenu, newItem, partDone, partDoneLater, planLen, setPlan, titleToBlock, toggleItemDone } from './actions';
import { fs } from './bridge';
import { openDetail } from './detail';
import { ghost, highlight, track, zoneAt } from './drag';
import { MenuEntry, showMenu } from './menu';
import { focusBlock, itemToPaper } from './paper';
import { commit, itemById, log, releaseEdit, render, S } from './store';
import { dropShadow, timeAt } from './timeline';
import { currentPlace, placeFit, startWaiting } from './wowo';
import { ANIMALS, animalName, Item } from './types';
import { $, addDays, DAY_TURN, dur, fill, h, hm, isoNow, leftText, MIN_EST, nowMin, parseEst, relDay, shortDay, toast, ymd } from './util';

let flashId: string | null = null;
const open = { later: false, done: false, away: false };

export function renderList() {
  const today = ymd();
  const items = S.backup.items;
  const live = items.filter(i => !i.done);
  const later = live.filter(i => i.notBefore && i.notBefore > today);
  const waiting = live.filter(i => i.waiting && !later.includes(i)).sort((a, b) => (a.waiting!.nudge ?? '9') < (b.waiting!.nudge ?? '9') ? -1 : 1);
  const now = live.filter(i => !later.includes(i) && !waiting.includes(i));
  const planned = now.filter(i => i.plan && i.plan.date >= today).sort((a, b) =>
    a.plan!.date === b.plan!.date ? a.plan!.start - b.plan!.start : a.plan!.date < b.plan!.date ? -1 : 1);
  // 地点：不在这儿能做的先折起来；在这儿能做的排在前面
  const away = now.filter(i => !planned.includes(i) && placeFit(i) === 'away');
  const loose = sortLoose(now.filter(i => !planned.includes(i) && !away.includes(i)));
  const doneToday = items.filter(i => i.done && (i.doneAt ?? '').startsWith(today));
  const place = currentPlace().name;

  const body = $('#list-body')!;
  const keep = body.scrollTop;
  fill(body,
    section(L('还没排', 'Not planned'), loose, loose.length ? null : L('纸上熟了的念头，拖到这里就丢进池塘', 'Drag a ripe thought from the paper here to drop it in the pond')),
    planned.length ? section(L('排上了', 'Planned'), planned) : null,
    waiting.length ? section(`${ANIMALS.喳喳.emoji} ${L('等一等', 'Waiting')}`, waiting) : null,
    away.length ? fold(L(`不在${place ? place.replace(/^在/, '') : '这儿'}做的`, `Not for ${place ?? 'here'}`), away, 'away') : null,
    later.length ? fold(L('还没到时候', 'Not yet'), later, 'later') : null,
    doneToday.length ? fold(L('今天做完的', 'Done today'), doneToday, 'done') : null,
  );
  body.scrollTop = keep;
  $('#list-count')!.textContent = String(live.length - later.length);
  if (flashId) {
    const el = body.querySelector(`[data-iid="${flashId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => { el?.classList.remove('flash'); flashId = null; }, 1800);
  }
}

function sortLoose(list: Item[]) {
  const today = ymd();
  const key = (i: Item) => [i.notBefore === today ? 0 : 1, placeFit(i) === 'here' ? 0 : 1, i.star ? 0 : 1, i.due ?? '9999', i.wish ?? '9999', i.created ?? ''].join('|');
  return list.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

function section(title: string, list: Item[], empty: string | null = null) {
  return h('div', { class: 'l-sec' },
    h('div', { class: 'l-sec-t' }, title, h('span', { class: 'l-n' }, list.length ? String(list.length) : '')),
    ...list.map(itemEl),
    empty ? h('div', { class: 'l-empty' }, empty) : null);
}

function fold(title: string, list: Item[], key: keyof typeof open) {
  return h('div', { class: 'l-sec' },
    h('button', { class: 'l-sec-t fold', type: 'button', onclick: () => { open[key] = !open[key]; renderList(); } },
      open[key] ? '▾ ' : '▸ ', title, h('span', { class: 'l-n' }, String(list.length))),
    ...(open[key] ? list.map(itemEl) : []));
}

function itemEl(i: Item): HTMLElement {
  const today = ymd();
  const who = i.by && i.by !== 'me' ? ANIMALS[i.by] : null;
  const chips: (HTMLElement | null)[] = [];
  if (i.plan && i.plan.date >= today) chips.push(chip('time', `${relDay(i.plan.date)} ${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)}`));
  else if (i.plan && !i.done) chips.push(chip('roll', L(`${shortDay(i.plan.date)} 没做 · 顺延`, `Not done ${shortDay(i.plan.date)} · rolled over`)));
  if (i.errand) chips.push(h('button', { class: 'chip est errand', type: 'button', dataset: { est: i.id }, title: L('顺手的事：不占一块时间，不用写多久。点一下改成写时长', 'An errand: takes no slot, needs no estimate. Click to give it a length') }, L('顺手', 'errand')));
  else chips.push(h('button', { class: 'chip est' + (i.estimate ? '' : ' missing'), type: 'button', dataset: { est: i.id },
    title: i.estimate
      ? (i.left ? L(`整件事预计 ${dur(i.estimate)}，还剩${leftText(i.left)}，放上时间轴按 ${dur(planLen(i))}`, `About ${dur(i.estimate)} in all, ${leftText(i.left)} left, so ${dur(planLen(i))} on the timeline`) : L('预计要多久', 'Estimate'))
      : L(`还没写多久：放上时间轴先按最小的 ${MIN_EST} 分钟；妥妥排的时候也不替你猜。不占时间的事右键选「顺手」`, `No estimate yet: the timeline uses the smallest ${MIN_EST} min, and Toto won't guess for you. Right-click → Errand if it takes no slot`) },
    i.estimate ? `⏱ ${dur(i.estimate)}${i.left ? L(` · 剩${leftText(i.left)}`, ` · ${leftText(i.left)} left`) : ''}` : L('⏱ 多久？', '⏱ How long?')));
  if (i.pieces?.length) chips.push(chip('piece', L(`做过 ${i.pieces.length} 截 · 上次 ${relDay(i.pieces.at(-1)!.date)}`, `${i.pieces.length} ${i.pieces.length === 1 ? "part" : "parts"} done · last ${relDay(i.pieces.at(-1)!.date).toLowerCase()}`)));
  if (i.due) chips.push(chip(i.due <= addDays(today, 2) ? 'due soon' : 'due', L(`截止 ${relDay(i.due)}`, `Due ${relDay(i.due)}`)));
  if (i.wish && !(i.plan && i.plan.date >= today)) chips.push(chip('wish', L(`希望 ${relDay(i.wish)}`, `Hoping ${relDay(i.wish)}`)));
  if (i.notBefore === today && !i.done) chips.push(chip('surface', L('今天浮上来', 'Up today')));
  if (i.waiting) {
    const due = i.waiting.nudge && i.waiting.nudge <= today;
    chips.push(chip(due ? 'nudge' : 'wait', L(`等${i.waiting.who || '别人'}${due ? ' · 该催了' : i.waiting.nudge ? ` · ${relDay(i.waiting.nudge)}催` : ''}`,
      `Waiting on ${i.waiting.who || 'someone'}${due ? ' · nudge now' : i.waiting.nudge ? ` · nudge ${relDay(i.waiting.nudge)}` : ''}`)));
  }
  if (i.where) chips.push(chip(placeFit(i) === 'here' ? 'where here' : 'where', `@${i.where}`));
  if (i.notBefore && i.notBefore > today) chips.push(chip('later', L(`${shortDay(i.notBefore)} 起`, `From ${shortDay(i.notBefore)}`)));
  if (i.repeat) chips.push(chip('rep', { daily: L('每天', 'Daily'), weekdays: L('工作日', 'Weekdays'), weekly: L('每周', 'Weekly') }[i.repeat]));
  if (i.source) chips.push(h('button', { class: 'chip src', type: 'button', dataset: { src: i.id }, title: L('回到纸上原来的位置', 'Show where it came from on paper') }, L('↩ 纸', '↩ paper')));

  return h('div', {
    class: ['it', i.done && 'done', i.star && 'star', i.type === 'info' && 'info', flashId === i.id && 'flash', i.plan && i.plan.date >= today && 'planned'].filter(Boolean).join(' '),
    dataset: { iid: i.id },
  },
    i.type === 'info'
      ? h('span', { class: 'info-dot', title: L('信息：一个关注点', 'Info: something to keep an eye on') }, '◇')
      : h('button', { class: 'box', type: 'button', 'aria-label': L('做完 / 没做完', 'Done / not done'), 'aria-pressed': String(!!i.done) }),
    h('div', { class: 'it-main' },
      h('div', { class: 'it-title', title: L('按住拖到时间轴；点两下改字', 'Drag to the timeline; double-click to edit') }, i.star ? h('span', { class: 'star-mark' }, '★ ') : null, i.title),
      h('div', { class: 'it-meta' }, ...chips)),
    h('div', { class: 'it-side' },
      who ? h('span', { class: 'badge', title: L(`${animalName(i.by!)} 动过`, `Touched by ${animalName(i.by!)}`) }, who.emoji) : null,
      i.confirmed ? h('span', { class: 'lock', title: L('你确认过，AI 不改', 'Confirmed by you; AI leaves it alone') }, '✓') : null,
      h('button', { class: 'more', type: 'button', title: L('详情', 'Details'), dataset: { more: i.id } }, '⋯')),
  );
}

const chip = (cls: string, text: string) => h('span', { class: 'chip ' + cls }, text);

export function focusItem(id: string) {
  if (!itemById(id)) { toast(L('这件事已经不在池塘里了', 'That task is no longer in the pond')); return; }
  if (S.ui.collapsed.list) S.ui.collapsed.list = false;
  const it = itemById(id)!;
  if (it.done) open.done = true;
  if (it.notBefore && it.notBefore > ymd()) open.later = true;
  flashId = id;
  render();
}

// ───────── 事件 ─────────

let lastClick = { id: '', at: 0 };

function onPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  if (e.button !== 0 || !releaseEdit(t)) return;
  const row = t.closest('.it') as HTMLElement | null;
  if (!row || t.closest('button') || t.closest('input')) return;
  const it = itemById(row.dataset.iid!)!;
  track(e, {
    onStart() { row.classList.add('dragging'); },
    onMove(ev) {
      const zone = zoneAt(ev.clientX, ev.clientY);
      highlight(zone === 'time' || zone === 'paper' ? zone : null);
      dropShadow(zone === 'time' ? ev.clientY : null, planLen(it), !it.plan && !it.estimate);
      ghost(zone === 'time' ? `${it.title} · ${relDay(S.day)} ${hm(timeAt(ev.clientY, planLen(it)))}`
        : zone === 'paper' ? `${it.title} → ${L('退回纸上，当念头', 'back to paper as a thought')}` : it.title, ev.clientX, ev.clientY);
    },
    onEnd(ev, moved) {
      row.classList.remove('dragging');
      if (!moved) {
        // 点两下标题才改字；点一下什么都不动，免得不小心进了改字、再拖就拖不动
        const now = Date.now();
        if (t.closest('.it-title') && lastClick.id === it.id && now - lastClick.at < 450) { lastClick.id = ''; editTitle(row, it); }
        else lastClick = { id: it.id, at: now };
        return;
      }
      const zone = zoneAt(ev.clientX, ev.clientY);
      if (zone === 'paper') { itemToPaper(it.id); return; }
      if (zone === 'time') {
        const len = planLen(it);
        setPlan(it.id, { date: S.day, start: timeAt(ev.clientY, len), dur: len });
      }
    },
  });
}

export { planLen };

function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const row = t.closest('.it') as HTMLElement | null;
  if (!row) return;
  const id = row.dataset.iid!;
  if (t.closest('.box')) toggleItemDone(id);
  else if (t.closest('.more')) openDetail(id);
  else if (t.closest('.src')) { const s = itemById(id)!.source!; focusBlock(s.paper, s.block); }
  else if (t.closest('.est')) editEstimate(t.closest('.est') as HTMLElement, id);
}

function editTitle(row: HTMLElement, it: Item) {
  const el = row.querySelector('.it-title') as HTMLElement;
  el.textContent = it.title;
  el.contentEditable = 'plaintext-only';
  S.editing = true;
  el.focus();
  getSelection()?.selectAllChildren(el);
  getSelection()?.collapseToEnd();
  let cancel = false;
  el.onkeydown = e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { cancel = true; el.blur(); }
    e.stopPropagation();
  };
  el.onblur = () => {
    S.editing = false;
    // 标题后面写「1h」「顺手」，和纸上一样认成时长
    const { text: v, est, errand } = parseEst(el.innerText.trim());
    if (!cancel && v && (v !== it.title || est || errand)) commit(() => {
      it.title = v; it.by = 'me'; it.updated = isoNow();
      titleToBlock(it);
      if (est) { it.estimate = est; delete it.errand; }
      if (errand) { it.errand = true; delete it.estimate; }
    });
    else render();
  };
}

function editEstimate(chipEl: HTMLElement, id: string) {
  const it = itemById(id)!;
  const input = h('input', { class: 'est-input', type: 'number', min: '5', step: '5', value: String(it.estimate ?? 30), 'aria-label': L('预计分钟', 'Minutes') });
  chipEl.replaceWith(input);
  S.editing = true;
  input.focus();
  input.select();
  let cancel = false;
  input.onkeydown = e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancel = true; input.blur(); }
    e.stopPropagation();
  };
  input.onblur = () => {
    S.editing = false;
    const v = Math.round(Number(input.value));
    if (!cancel && v > 0 && (v !== it.estimate || it.errand)) commit(() => {
      it.estimate = v; it.by = 'me'; delete it.errand;
      // 纸上那块也跟着改，两边是同一件事
      const b = it.source && S.papers.get(it.source.paper)?.blocks.find(x => x.id === it.source!.block);
      if (b && !b.done) { b.estimate = v; delete b.errand; }
    });
    else render();
  };
}

function onContextMenu(e: MouseEvent) {
  const row = (e.target as HTMLElement).closest('.it') as HTMLElement | null;
  if (!row) return;
  e.preventDefault();
  const it = itemById(row.dataset.iid!)!;
  const entries: MenuEntry[] = [
    { label: L('详情…', 'Details…'), action: () => openDetail(it.id) },
    { label: L('复制', 'Copy'), hint: L('贴到任何大模型窗口', 'For any AI chat'), action: () => copyItem(it) },
    { label: L('星标', 'Star'), checked: !!it.star, action: () => commit(() => { it.star = !it.star; it.by = 'me'; }) },
    { label: L('顺手的事（不占时间）', 'Errand (takes no slot)'), checked: !!it.errand, hint: L('不用写多久', 'No estimate needed'), action: () => setErrand(it, !it.errand) },
    ...(it.estimate || it.pieces?.length ? [{ label: it.left ? L(`还剩${leftText(it.left)}，改…`, `${leftText(it.left)} left, change…`) : L('还剩多少…', 'How much is left…'), action: () => leftMenu(it.id, e.clientX, e.clientY) }] : []),
    { label: L('你确认过（AI 不改）', 'Confirmed (AI leaves it alone)'), checked: !!it.confirmed, action: () => commit(() => (it.confirmed = !it.confirmed)) },
    '-',
    { label: L(`排进${relDay(S.day)}下一个空档`, `Next free slot ${relDay(S.day).toLowerCase()}`), action: () => planNextGap(it) },
    it.waiting
      ? { label: L('不等了', 'Stop waiting'), action: () => commit(() => { it.waiting = null; it.by = 'me'; }) }
      : { label: L('在等别人回复…', 'Waiting on someone…'), hint: L('两天后提醒你催', 'Nudge reminder in two days'), action: () => { commit(() => { startWaiting(it); it.by = 'me'; }); openDetail(it.id); } },
    ...(it.plan ? [
      ...(it.plan.date === ymd() ? [{ label: L('做了一截，今天晚点接着做', 'Did part, continue later today'), hint: L('再排一段', 'Plans another slot'), action: () => partDoneLater(it.id) }] : []),
      { label: L('做了一截，剩下的改天', 'Did part, rest another day'), hint: L('时间轴上留记录', 'Leaves a record on the timeline'), action: () => { if (partDone(it.id)) leftMenu(it.id, e.clientX, e.clientY); } },
      { label: L('放回没排', 'Unplan'), action: () => setPlan(it.id, null) }] : []),
    ...(it.source ? [{ label: L('回到纸上原处', 'Show on paper'), action: () => focusBlock(it.source!.paper, it.source!.block) }] : []),
    '-',
    { label: it.type === 'info' ? L('改成行动', 'Make it an action') : L('改成信息（关注点）', 'Make it info (keep an eye on)'), action: () => commit(() => (it.type = it.type === 'info' ? 'action' : 'info')) },
    { label: L('退回纸上，当念头', 'Back to paper as a thought'), action: () => itemToPaper(it.id) },
    { label: L('删掉', 'Delete'), danger: true, action: () => removeItem(it.id) },
  ];
  showMenu(e.clientX, e.clientY, entries);
}

/** 顺手的事：纸上那块跟着改 */
function setErrand(it: Item, on: boolean) {
  commit(() => {
    if (on) it.errand = true; else delete it.errand;
    it.by = 'me'; it.updated = isoNow();
    const b = it.source && S.papers.get(it.source.paper)?.blocks.find(x => x.id === it.source!.block);
    if (b && !b.done) { if (on) { b.errand = true; delete b.estimate; } else delete b.errand; }
  });
}

/** 池塘里的一件事复制成 Markdown */
function copyItem(i: Item) {
  const today = ymd();
  const lines = [`- [${i.done ? 'x' : ' '}] ${i.title}`];
  const meta = [
    i.plan && L(`排在 ${relDay(i.plan.date, today)} ${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)}`, `Planned ${relDay(i.plan.date, today)} ${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)}`),
    i.estimate && L(`预计 ${dur(i.estimate)}`, `About ${dur(i.estimate)}`), i.due && L(`截止 ${i.due}`, `Due ${i.due}`), i.wish && L(`希望 ${i.wish} 做`, `Hoping for ${i.wish}`),
    i.where && L(`在${i.where.replace(/^在/, '')}做`, `At ${i.where}`), i.waiting && L(`在等${i.waiting.who || '别人'}回复`, `Waiting on ${i.waiting.who || 'someone'}`),
  ].filter(Boolean);
  if (meta.length) lines.push(`  ${meta.join(' · ')}`);
  for (const r of (i.note ?? '').split('\n')) if (r.trim()) lines.push(`  ${r.trim()}`);
  fs.copy(lines.join('\n') + '\n').then(() => toast(L(`复制好了：「${i.title}」`, `Copied "${i.title}"`)), () => toast(L('复制没成功，再试一次', "Couldn't copy. Try again")));
}

export function removeItem(id: string) {
  const it = itemById(id);
  if (!it) return;
  commit(() => (S.backup.items = S.backup.items.filter(i => i.id !== id)));
  log(L(`删掉「${it.title}」`, `Deleted "${it.title}"`));
  toast(L('删掉了（⌘Z 可以撤回）', 'Deleted (⌘Z to undo)'));
}

/** 找今天（或正在看的那天）第一个放得下的空档，前后各留 10 分钟 */
export function planNextGap(it: Item) {
  const len = planLen(it);
  const day = S.day;
  const busy = S.backup.items.filter(i => i.plan?.date === day && i.id !== it.id).map(i => [i.plan!.start, i.plan!.start + i.plan!.dur]).sort((a, b) => a[0] - b[0]);
  let t = day === ymd() ? Math.max(480, Math.ceil((nowMin() + 5) / 15) * 15) : 540;
  for (const [s, e] of busy) {
    if (t + len + 10 <= s) break;
    if (e + 10 > t) t = Math.ceil((e + 10) / 15) * 15;
  }
  // 平时排到 24 点为止；已经熬到 22 点以后了，就能接着排到凌晨 5 点（一天翻篇）
  const end = day === ymd() && nowMin() >= 22 * 60 ? (24 + DAY_TURN) * 60 : 24 * 60;
  if (t + len > end) { toast(L('这一天排不下了，留点白吧', 'No room left today. Leave some white space')); return; }
  setPlan(it.id, { date: day, start: t, dur: len });
}

export function initList() {
  const body = $('#list-body')!;
  body.addEventListener('pointerdown', onPointerDown);
  body.addEventListener('click', onClick);
  body.addEventListener('contextmenu', onContextMenu);
  const input = $('#list-input') as HTMLInputElement;
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const title = input.value.trim();
    if (!title) return;
    // 「整理桌面 1h」「找图书馆卡 顺手」：和纸上一样认
    const { text, est, errand } = parseEst(title);
    const it = newItem(text, { ...(est ? { estimate: est } : {}), ...(errand ? { errand } : {}) });
    commit(() => S.backup.items.push(it));
    log(L(`丢到池塘里「${text}」`, `Dropped "${text}" in the pond`));
    input.value = '';
  });
}
