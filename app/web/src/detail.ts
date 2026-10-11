// 条目详情：所有字段都在这里改。
import { L } from './i18n';
import { leftMenu, partDone, partDoneLater, planLen, repeatTemplate, setPlan, titleToBlock, toggleItemDone } from './actions';
import { removeItem } from './list';
import { focusBlock } from './paper';
import { commit, itemById, S } from './store';
import { ANIMALS, animalName, Item } from './types';
import { startWaiting } from './wowo';
import { $, dur, h, hm, isoNow, leftText, relDay, shortDay, ymd } from './util';

let current: string | null = null;

export function openDetail(id: string) {
  current = id;
  renderDetail();
}

export function closeDetail() {
  current = null;
  $('#detail')!.classList.remove('on');
}

export function detailOpen() { return current != null; }

export function renderDetail() {
  const panel = $('#detail')!;
  const it = current ? itemById(current) : null;
  if (!it) { panel.classList.remove('on'); current = null; return; }
  if (panel.contains(document.activeElement) && document.activeElement !== panel) return;

  const set = (fn: (i: Item) => void) => commit(() => { fn(it); it.by = 'me'; it.updated = isoNow(); });
  const text = (label: string, key: 'title' | 'where' | 'note', ph = '', area = false) => {
    const input = area
      ? h('textarea', { rows: '4', placeholder: ph }) as HTMLTextAreaElement
      : h('input', { type: 'text', placeholder: ph }) as HTMLInputElement;
    input.value = (it[key] as string) ?? '';
    input.onchange = () => set(i => { (i as any)[key] = input.value.trim() || undefined; if (key === 'title') { if (!i.title) i.title = L('（没有标题）', '(untitled)'); titleToBlock(i); } });
    return field(label, input);
  };
  const date = (label: string, key: 'due' | 'wish' | 'notBefore', hint: string) => {
    const input = h('input', { type: 'date' }) as HTMLInputElement;
    input.value = it[key] ?? '';
    input.onchange = () => set(i => { i[key] = input.value || undefined; });
    return field(label, input, hint);
  };
  const select = <K extends keyof Item>(label: string, key: K, opts: [string, string][]) => {
    const s = h('select', null, ...opts.map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
    s.value = String(it[key] ?? '');
    s.onchange = () => set(i => { (i as any)[key] = s.value || null; });
    return field(label, s);
  };
  const check = (label: string, on: boolean, fn: () => void, hint = '') =>
    h('label', { class: 'd-check' }, h('input', { type: 'checkbox', checked: on, onchange: fn }), label, hint ? h('small', null, hint) : null);

  const est = h('input', { type: 'number', min: '5', step: '5', placeholder: L('分钟', 'min') }) as HTMLInputElement;
  est.value = it.estimate ? String(it.estimate) : '';
  est.onchange = () => set(i => { i.estimate = Number(est.value) > 0 ? Math.round(Number(est.value)) : undefined; if (i.estimate) delete i.errand; });

  const who = it.by && it.by !== 'me' ? `${ANIMALS[it.by].emoji} ${animalName(it.by)}` : L('你', 'You');

  panel.replaceChildren(
    h('div', { class: 'd-head' },
      h('span', { class: 'd-kicker' }, it.type === 'info' ? L('信息 · 关注点', 'Info · keep an eye on') : L('行动', 'Action')),
      h('button', { class: 'icon-btn', type: 'button', title: L('关上（Esc）', 'Close (Esc)'), onclick: closeDetail }, '×')),
    text(L('标题', 'Title'), 'title'),
    h('div', { class: 'd-row' },
      select(L('类型', 'Type'), 'type', [['action', L('行动', 'Action')], ['info', L('信息（关注点）', 'Info (keep an eye on)')]]),
      field(L('预计要多久', 'Estimate'), est, it.errand ? L('顺手的事，不用写', 'An errand, none needed') : it.estimate ? dur(it.estimate) + (it.left ? L(` · 还剩${leftText(it.left)}，约 ${dur(planLen(it))}`, ` · ${leftText(it.left)} left, about ${dur(planLen(it))}`) : '') : '')),
    h('div', { class: 'd-row' },
      date(L('截止日', 'Due'), 'due', L('真正的死线', 'A real deadline')),
      date(L('希望做的日期', 'Hoping for'), 'wish', L('软目标，没做完只顺延', 'Soft target; it just rolls over'))),
    h('div', { class: 'd-row' },
      text(L('地点', 'Where'), 'where', L('在家 / 办公室 / 外面', 'Home / Office / Out')),
      date(L('不早于', 'Not before'), 'notBefore', L('没到这天不出现', 'Hidden until this day'))),
    repeatBox(it, set),
    waitingBox(it, set),
    text(L('备注', 'Notes'), 'note', '', true),
    h('div', { class: 'd-checks' },
      check(L('星标', 'Star'), !!it.star, () => set(i => (i.star = !i.star))),
      check(L('顺手的事', 'Errand'), !!it.errand, () => set(i => { if (i.errand) delete i.errand; else i.errand = true; }), L('不占时间', 'Takes no slot')),
      check(L('做完了', 'Done'), !!it.done, () => toggleItemDone(it.id)),
      check(L('你确认过', 'Confirmed'), !!it.confirmed, () => commit(() => (it.confirmed = !it.confirmed)), L('打上以后 AI 不改', 'AI leaves it alone'))),
    h('div', { class: 'd-info' },
      it.plan ? h('div', null, L(`排在 ${relDay(it.plan.date)} ${hm(it.plan.start)}–${hm(it.plan.start + it.plan.dur)} `, `Planned ${relDay(it.plan.date)} ${hm(it.plan.start)}–${hm(it.plan.start + it.plan.dur)} `),
        h('button', { class: 'link-btn', type: 'button', onclick: () => setPlan(it.id, null) }, L('放回没排', 'Unplan')), ' ',
        it.done || it.plan.date !== ymd() ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => partDoneLater(it.id) }, L('做了一截，今天晚点接着做', 'Did part, continue later today')), ' ',
        it.done ? null : h('button', { class: 'link-btn', type: 'button', onclick: (e: MouseEvent) => { if (partDone(it.id)) leftMenu(it.id, e.clientX, e.clientY); } }, L('做了一截，剩下的改天', 'Did part, rest another day'))) : h('div', null, L('还没排进时间轴', 'Not on the timeline yet')),
      it.pieces?.length ? h('div', null, L(`做过 ${it.pieces.length} 截：`, `${it.pieces.length} parts done: `), it.pieces.map(p => `${shortDay(p.date)} ${hm(p.start)}–${hm(p.start + p.dur)}`).join(L('、', ', ')),
        ' · ', h('button', { class: 'link-btn', type: 'button', onclick: (e: MouseEvent) => leftMenu(it.id, e.clientX, e.clientY) }, it.left ? L(`还剩${leftText(it.left)}`, `${leftText(it.left)} left`) : L('还剩多少？', 'How much is left?'))) : null,
      it.history?.length ? h('div', null, L('以前排过：', 'Planned before: '), it.history.slice(-5).map(p => `${shortDay(p.date)} ${hm(p.start)}`).join(L('、', ', '))) : null,
      it.source ? h('div', null, L('来自纸上 ', 'From paper '), h('button', {
        class: 'link-btn', type: 'button', onclick: () => focusBlock(it.source!.paper, it.source!.block),
      }, `${S.papers.get(it.source.paper)?.title ?? it.source.paper} ↩`)) : null,
      h('div', null, `${L('最后改动：', 'Last changed by ')}${who}${it.updated ? ' · ' + it.updated.slice(5, 16).replace('T', ' ') : ''}`),
    ),
    h('div', { class: 'd-foot' },
      h('button', { class: 'pill danger', type: 'button', onclick: () => { removeItem(it.id); closeDetail(); } }, L('删掉这件事', 'Delete this task'))),
  );
  panel.classList.add('on');
}

/** 重复：下一次照记下的样子建；这一次改了想以后都这样，点「以后都照这次」 */
function repeatBox(it: Item, set: (fn: (i: Item) => void) => void) {
  const s = h('select', null, ...[['', L('不重复', 'Never')], ['daily', L('每天', 'Daily')], ['weekdays', L('工作日', 'Weekdays')], ['weekly', L('每周', 'Weekly')]]
    .map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
  s.value = it.repeat ?? '';
  s.onchange = () => set(i => {
    i.repeat = (s.value || null) as Item['repeat'];
    if (i.repeat) i.repeatOf ??= repeatTemplate(i); else delete i.repeatOf;
  });
  if (!it.repeat) return field(L('重复', 'Repeat'), s);
  const t = it.repeatOf ?? repeatTemplate(it);
  const when = t.start != null ? ` ${hm(t.start)}${t.dur ? ' · ' + dur(t.dur) : ''}` : '';
  const now = repeatTemplate(it);
  const same = (Object.keys(now) as (keyof typeof now)[]).every(k => (now[k] ?? '') === (t[k] ?? ''));
  return h('div', null, field(L('重复', 'Repeat'), s, L(`下一次照「${t.title}」${when}`, `Next one: "${t.title}"${when}`)),
    same ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => set(i => { i.repeatOf = repeatTemplate(i); }) }, L('以后都照这次', 'Use this from now on')));
}

/** 等一等：在等谁、哪天催。勾掉就是不等了 */
function waitingBox(it: Item, set: (fn: (i: Item) => void) => void) {
  const on = !!it.waiting;
  const box = h('div', { class: 'd-wait' + (on ? ' on' : '') },
    h('label', { class: 'd-check' },
      h('input', { type: 'checkbox', checked: on, onchange: () => set(i => { if (on) i.waiting = null; else startWaiting(i); }) }),
      L('在等别人回复', 'Waiting on someone'), h('small', null, L('到日子提醒你催', 'Reminds you to nudge on the day'))));
  if (!on) return box;
  const who = h('input', { type: 'text', placeholder: L('等谁', 'Who') }) as HTMLInputElement;
  who.value = it.waiting!.who;
  who.onchange = () => set(i => { i.waiting = { ...i.waiting!, who: who.value.trim() }; });
  const nudge = h('input', { type: 'date' }) as HTMLInputElement;
  nudge.value = it.waiting!.nudge ?? '';
  nudge.onchange = () => set(i => { i.waiting = { ...i.waiting!, nudge: nudge.value || undefined }; });
  box.append(h('div', { class: 'd-row' }, field(L('等谁', 'Who'), who), field(L('哪天催', 'Nudge on'), nudge, L(`从 ${relDay(it.waiting!.since)} 开始等`, `Waiting since ${relDay(it.waiting!.since)}`))));
  return box;
}

function field(label: string, control: HTMLElement, hint = '') {
  return h('label', { class: 'd-field' }, h('span', { class: 'd-label' }, label, hint ? h('small', null, hint) : null), control);
}
