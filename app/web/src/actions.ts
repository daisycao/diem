// 跨视图的动作：纸 → 清单 → 时间轴，以及完成、改期、补记的留痕。
import { L } from './i18n';
import { S, commit, itemById, log, paper } from './store';
import { showMenu } from './menu';
import type { Block, Item, Plan, RepeatTemplate } from './types';
import { ANIMALS, animalName } from './types';
import { DAY_TURN, dur, hm, isoNow, leftText, MIN_EST, nowMin, relDay, shortDay, toast, uid, ymd } from './util';

export function newItem(title: string, extra: Partial<Item> = {}): Item {
  return { id: uid('it'), title, type: 'action', by: 'me', created: isoNow(), updated: isoNow(), ...extra };
}

/** 块的第一行当标题，后面几行当备注 */
function splitText(text: string) {
  const [first, ...rest] = text.split('\n');
  return { title: first.trim() || L('（没写字的念头）', '(empty thought)'), note: rest.join('\n').trim() || undefined };
}

/** 纸上那块、池塘里、时间轴上是同一件事：改标题时两边一起改（放在 commit 里调，一次 ⌘Z 全撤回）。
 *  标题对纸上那块的第一行；后面的手写小字不动 */
export function titleToBlock(it: Item) {
  const b = it.source && S.papers.get(it.source.paper)?.blocks.find(x => x.id === it.source!.block);
  if (!b) return;
  const [first, ...rest] = b.text.split('\n');
  if (first.trim() === it.title) return;
  b.text = [it.title, ...rest].join('\n');
  b.guess = false;
}

/** 反过来：纸上改了那块的第一行，丢进池塘的那几件事标题跟着改 */
export function blockToItems(b: Block) {
  const { title } = splitText(b.text);
  for (const id of b.links ?? []) {
    const it = S.backup.items.find(i => i.id === id);
    if (it && it.title !== title) { it.title = title; it.updated = isoNow(); }
  }
}

/** 从纸上拖出来：这个念头要变成事 */
export function itemFromBlock(blockId: string, plan?: Plan): Item | undefined {
  const p = paper();
  const b = p.blocks.find(x => x.id === blockId);
  if (!b) return;
  const { title, note } = splitText(b.text);
  const it = newItem(title, { note, estimate: b.estimate, ...(b.errand ? { errand: true } : {}), source: { paper: p.id, block: b.id }, plan: plan ?? null });
  commit(() => {
    S.backup.items.push(it);
    b.links = [...(b.links ?? []), it.id];
  });
  log(L(`从纸上拿出一件事「${title}」${plan ? `，排到 ${relDay(plan.date)} ${hm(plan.start)}` : '，丢到池塘里'}`, `Took "${title}" from the paper${plan ? `, planned ${relDay(plan.date)} ${hm(plan.start)}` : ' into the pond'}`));
  toast(plan ? L(`排上了：${relDay(plan.date)} ${hm(plan.start)}「${title}」`, `Planned: ${relDay(plan.date)} ${hm(plan.start)} "${title}"`) : L(`丢到池塘里：「${title}」`, `In the pond: "${title}"`));
  return it;
}

function sameSlot(a?: Plan | null, b?: Plan | null) {
  return !!a && !!b && a.date === b.date && a.start === b.start && a.dur === b.dur;
}

/** 排上 / 挪动 / 放回。旧位置留在 history，日志写一行 */
export function setPlan(id: string, plan: Plan | null) {
  const it = itemById(id);
  if (!it || sameSlot(it.plan, plan)) return;
  const old = it.plan;
  commit(() => {
    if (old) it.history = [...(it.history ?? []), { ...old, at: isoNow() }];
    it.plan = plan;
    it.by = 'me';
    it.updated = isoNow();
  });
  const slot = (p: Plan) => `${relDay(p.date)} ${hm(p.start)}–${hm(p.start + p.dur)}`;
  if (!old && plan) log(L(`排上「${it.title}」→ ${slot(plan)}`, `Planned "${it.title}" → ${slot(plan)}`));
  else if (old && plan && old.date === plan.date && old.start === plan.start) log(L(`调整时长「${it.title}」→ ${dur(plan.dur)}`, `Resized "${it.title}" → ${dur(plan.dur)}`));
  else if (old && plan) log(L(`改期「${it.title}」${slot(old)} → ${slot(plan)}`, `Moved "${it.title}" ${slot(old)} → ${slot(plan)}`));
  else if (old && !plan) log(L(`放回池塘「${it.title}」（原来排在 ${slot(old)}）`, `Back to the pond: "${it.title}" (was ${slot(old)})`));
}

/** 做了一截，剩下的改天：排的那块留在时间轴上当记录（正在做的截到现在），这件事回到池塘，没做完 */
export function partDone(id: string): boolean {
  const it = itemById(id);
  if (!it?.plan) return false;
  const p = it.plan;
  const now = nowMin();
  // 今天、正做到一半：只记到现在为止（至少 15 分钟）
  const cut = p.date === ymd() && now > p.start && now < p.start + p.dur ? Math.max(15, Math.round((now - p.start) / 5) * 5) : p.dur;
  const piece = { ...p, dur: cut, at: isoNow() };
  commit(() => {
    it.pieces = [...(it.pieces ?? []), piece];
    it.plan = null;
    it.by = 'me';
    it.updated = isoNow();
  });
  log(L(`做了一截「${it.title}」（${relDay(p.date)} ${hm(p.start)}–${hm(p.start + cut)}），剩下的改天`, `Did part of "${it.title}" (${relDay(p.date)} ${hm(p.start)}–${hm(p.start + cut)}), rest another day`), p.date);
  toast(`${ANIMALS.妥妥.emoji} ${L(`妥妥：「${it.title}」今天推进了一截，剩下的在池塘里等着`, `Toto: moved "${it.title}" along today. The rest waits in the pond`)}`);
  return true;
}

/** 做了一截，今天晚点接着做：这块留作记录，同一件事在今天后面再排一小段（默认从现在往后的下一刻钟、半小时，拖一下就能换）。
 *  比如上午 Codex 额度用完了，等下午重置再接着做。一次 ⌘Z 全撤回 */
export function partDoneLater(id: string): boolean {
  const it = itemById(id);
  if (!it?.plan || it.plan.date !== ymd()) return false;
  const p = it.plan;
  const now = nowMin();
  const doing = now > p.start && now < p.start + p.dur;
  const cut = doing ? Math.max(15, Math.round((now - p.start) / 5) * 5) : p.dur;
  const start = Math.max(Math.ceil(now / 15) * 15, p.start + cut);
  // 接着做的那段默认短一点（半小时）：正做到一半的，剩下的比半小时还少就用剩下的。拖一下边就能改长短
  const len = doing && p.dur - cut >= 15 ? Math.min(30, p.dur - cut) : 30;
  // 熬夜也算今天：能排到凌晨 5 点（一天翻篇的时候）
  const end = (24 + DAY_TURN) * 60;
  if (start + 15 > end) { toast(L('今天排不下了，用「做了一截，剩下的改天」吧', 'No room today. Try "Did part, rest another day"')); return false; }
  const next: Plan = { date: p.date, start, dur: Math.min(len, end - start) };
  commit(() => {
    it.pieces = [...(it.pieces ?? []), { ...p, dur: cut, at: isoNow() }];
    it.history = [...(it.history ?? []), { ...p, at: isoNow() }];
    it.plan = next;
    it.by = 'me';
    it.updated = isoNow();
  });
  log(L(`做了一截「${it.title}」（今天 ${hm(p.start)}–${hm(p.start + cut)}），今天 ${hm(next.start)} 接着做`, `Did part of "${it.title}" (today ${hm(p.start)}–${hm(p.start + cut)}), continuing at ${hm(next.start)}`), p.date);
  toast(`${ANIMALS.妥妥.emoji} ${L(`妥妥：「${it.title}」记下一截，${hm(next.start)} 接着做；拖一下能换时间`, `Toto: logged a part of "${it.title}", continuing at ${hm(next.start)}. Drag to move it`)}`);
  return true;
}

/** 还剩多少：null 是不说 */
export function setLeft(id: string, f: number | null) {
  const it = itemById(id);
  if (!it) return;
  commit(() => {
    if (f) it.left = f; else delete it.left;
    it.by = 'me';
    it.updated = isoNow();
  });
  if (f) log(L(`「${it.title}」还剩${leftText(f)}`, `"${it.title}": ${leftText(f)} left`));
}

/** 放上时间轴多长：排过的照原来的；没排过的照「预计 × 还剩」；都没有就是最小框 */
export function planLen(i: Item): number {
  if (i.plan) return i.plan.dur;
  if (!i.estimate) return MIN_EST;
  return Math.max(15, Math.round((i.estimate * (i.left ?? 1)) / 15) * 15);
}

/** 做了一截以后问一句：还剩多少？不答也行 */
export function leftMenu(id: string, x: number, y: number) {
  const it = itemById(id);
  if (!it) return;
  showMenu(x, y, [
    ...([[3 / 4, L('还剩 3/4', '3/4 left')], [2 / 3, L('还剩 2/3', '2/3 left')], [1 / 2, L('还剩一半', 'Half left')], [1 / 3, L('还剩 1/3', '1/3 left')], [1 / 4, L('还剩一点点', 'A little left')]] as [number, string][])
      .map(([f, label]) => ({ label, checked: it.left === f, action: () => setLeft(id, f) })),
    '-',
    { label: L('不说', 'Skip'), checked: !it.left, action: () => setLeft(id, null) },
  ], L(`「${it.title.slice(0, 14)}」还剩多少？不说也行`, `How much of "${it.title.slice(0, 14)}" is left? Optional`));
}

const PRAISE = [
  (t: string) => L(`做成了「${t}」`, `Done: "${t}"`),
  (t: string) => L(`「${t}」落地了`, `"${t}" has landed`),
  (t: string) => L(`今天推进了「${t}」`, `Moved "${t}" forward today`),
];

export function toggleItemDone(id: string) {
  const it = itemById(id);
  if (!it) return;
  const done = !it.done;
  commit(() => {
    it.done = done;
    it.doneAt = done ? isoNow() : undefined;
    it.updated = isoNow();
    it.by = 'me';
    if (done && it.repeat) S.backup.items.push(nextRepeat(it));
  });
  if (done) {
    const p = it.plan;
    log(L(`完成「${it.title}」${p ? `（排在 ${shortDay(p.date)} ${hm(p.start)}–${hm(p.start + p.dur)}）` : ''}`, `Finished "${it.title}"${p ? ` (planned ${shortDay(p.date)} ${hm(p.start)}–${hm(p.start + p.dur)})` : ''}`));
    const say = PRAISE[Math.floor(Math.random() * PRAISE.length)](it.title);
    toast(`${ANIMALS.妥妥.emoji} ${animalName('妥妥')}${L('：', ': ')}${say}`);
  } else {
    log(L(`取消完成「${it.title}」`, `Unfinished "${it.title}"`));
  }
}

/** 记下重复的样子：之后每一次都照它建 */
export function repeatTemplate(it: Item): RepeatTemplate {
  return {
    title: it.title, note: it.note, estimate: it.estimate,
    start: it.plan?.start, dur: it.plan ? (it.estimate ?? it.plan.dur) : undefined,
  };
}

function nextRepeat(it: Item): Item {
  const base = it.plan?.date ?? it.wish ?? ymd();
  const d = new Date(base + 'T00:00:00');
  do d.setDate(d.getDate() + (it.repeat === 'weekly' ? 7 : 1));
  while (it.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6));
  const next = ymd(d);
  // 照样子建，不照这一次：那天改的标题、备注、拉长的时间只算那天
  const t = it.repeatOf ?? repeatTemplate(it);
  return {
    ...it, id: uid('it'), done: false, doneAt: undefined, history: [], pieces: undefined, left: undefined,
    title: t.title, note: t.note, estimate: t.estimate, repeatOf: t,
    plan: t.start != null ? { date: next, start: t.start, dur: t.dur ?? t.estimate ?? 15 } : null,
    wish: it.wish ? next : undefined,
    created: isoNow(), updated: isoNow(),
  };
}

/** 补记：事后把做过的事记上时间轴 */
export function addRecord(title: string, date: string, start: number, length = 30) {
  const it = newItem(title, { plan: { date, start, dur: length }, done: true, doneAt: isoNow() });
  commit(() => S.backup.items.push(it));
  log(L(`补记 ${shortDay(date)} ${hm(start)}–${hm(start + length)}「${title}」`, `Logged ${shortDay(date)} ${hm(start)}–${hm(start + length)} "${title}"`), date);
  toast(L(`补记上了：「${title}」`, `Logged: "${title}"`));
}

export function addPlanned(title: string, date: string, start: number, length = 30) {
  const it = newItem(title, { plan: { date, start, dur: length } });
  commit(() => S.backup.items.push(it));
  log(L(`排上「${title}」→ ${relDay(date)} ${hm(start)}–${hm(start + length)}`, `Planned "${title}" → ${relDay(date)} ${hm(start)}–${hm(start + length)}`));
}

export function blockDoneToast(b: Block) {
  if (b.struck) toast(L('这件事决定先放下，已经替你收好了', 'Letting this one go. Put away for you'));
  else if (b.done) toast(`${ANIMALS.拾拾.emoji} ${L(`拾拾：纸上又落定一件「${b.text.split('\n')[0]}」`, `Pip: one more settled on paper, "${b.text.split('\n')[0]}"`)}`);
}
