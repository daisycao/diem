// 收着的：纸上、池塘里做完的事，所有笔记、日报，扔进纸箱的纸；也是去工作目录的门。
// 做完的事过了今天就不在池塘里显示了，纸换新的也会收进纸夹；这里按日子把它们都摆出来，笔记点开就能看。
import { L } from './i18n';
import { fs } from './bridge';
import { toggleConsensus } from './consensus';
import { toggleSync } from './sync';
import { openDoc, trashNote } from './doc';
import { loadReviews, openReview } from './review';
import { focusBlock, trashPaper, unboxPaper } from './paper';
import { boxedPapers, S } from './store';
import type { Block, Paper } from './types';
import { $, fill, h, hm, leftText, relDay, shortDay, ymd } from './util';

type Tab = 'done' | 'notes' | 'review' | 'box';
let open = false;
let tab: Tab = 'done';
let notes: { path: string; mtime: number }[] = [];
let reviews: string[] = [];

async function loadNotes() {
  const out: { path: string; mtime: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const e of await fs.list(dir).catch(() => [])) {
      const p = `${dir}/${e.name}`;
      if (e.dir && depth < 2) await walk(p, depth + 1);
      else if (!e.dir && e.name.endsWith('.md')) out.push({ path: p, mtime: e.mtime });
    }
  };
  await walk('notes', 0);
  notes = out.sort((a, b) => b.mtime - a.mtime);
}

/** 这篇笔记挂在哪几块上 */
function holders(path: string): { paper: Paper; block: Block }[] {
  const out: { paper: Paper; block: Block }[] = [];
  for (const p of S.papers.values()) for (const b of p.blocks) if (b.doc === path) out.push({ paper: p, block: b });
  return out;
}

const first = (t: string) => t.split('\n')[0];
const dayOf = (iso?: string) => (iso ?? '').slice(0, 10);

interface Row { day: string; title: string; sub: string; doc?: string; at?: { paper: string; block: string }; sort: string }

function doneRows(): Row[] {
  const rows: Row[] = [];
  const blockOf = (src?: { paper: string; block: string } | null) =>
    src ? S.papers.get(src.paper)?.blocks.find(b => b.id === src.block) : undefined;
  for (const i of S.backup.items) {
    if (!i.done) continue;
    const at = i.doneAt ?? i.updated ?? '';
    const b = blockOf(i.source);
    rows.push({
      day: dayOf(at), sort: at, title: i.title,
      sub: [L('池塘', 'Pond'), i.plan ? L(`排在 ${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)}`, `planned ${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)}`) : '', at ? L(`${at.slice(11, 16)} 打勾`, `ticked ${at.slice(11, 16)}`) : ''].filter(Boolean).join(' · '),
      doc: b?.doc, at: i.source ?? undefined,
    });
  }
  // 做了一截的：推进过也算，按那天放
  for (const i of S.backup.items) for (const p of i.pieces ?? []) {
    const b = blockOf(i.source);
    rows.push({
      day: p.date, sort: `${p.date}T${hm(p.start).padStart(5, '0')}`, title: i.title,
      sub: `${L('做了一截', 'Part done')} · ${hm(p.start)}–${hm(p.start + p.dur)}${i.done ? L(' · 后来做完了', ' · finished later') : i.left ? L(` · 还剩${leftText(i.left)}`, ` · ${leftText(i.left)} left`) : ''}`,
      doc: b?.doc, at: i.source ?? undefined,
    });
  }
  // 纸上直接打勾、没丢进池塘的（丢进池塘的上面已经算了）
  for (const p of S.papers.values()) for (const b of p.blocks) {
    if (b.kind !== 'item' || !b.done || b.links?.length) continue;
    rows.push({
      day: dayOf(b.doneAt) || `纸 ${p.id}`, sort: b.doneAt ?? p.created, title: first(b.text),
      sub: [`${L('纸上', 'Paper')} · ${p.title || p.id}`, b.doneAt ? L(`${b.doneAt.slice(11, 16)} 打勾`, `ticked ${b.doneAt.slice(11, 16)}`) : ''].filter(Boolean).join(' · '),
      doc: b.doc, at: { paper: p.id, block: b.id },
    });
  }
  return rows.sort((a, b) => (a.sort < b.sort ? 1 : -1));
}

function dayTitle(day: string): string {
  if (day.startsWith('纸 ')) {
    const p = S.papers.get(day.slice(2));
    return L(`更早 · ${p?.title || day.slice(2)}（没记打勾时间）`, `Earlier · ${p?.title || day.slice(2)} (no tick time)`);
  }
  const today = ymd();
  return day === today ? L('今天', 'Today') : `${shortDay(day)} · ${relDay(day, today)}`;
}

function go(at: { paper: string; block: string }) {
  toggleShelf(false);
  focusBlock(at.paper, at.block);
}

function rowEl(r: Row): HTMLElement {
  return h('li', { class: 'shelf-row' },
    h('div', { class: 'sr-main' },
      r.doc ? h('button', { class: 'sr-t', type: 'button', title: L('打开笔记', 'Open note'), onclick: () => openDoc(r.doc!, r.title) }, r.title) : h('div', { class: 'sr-t' }, r.title),
      h('div', { class: 'sr-sub' }, r.sub)),
    h('div', { class: 'sr-btns' },
      r.doc ? h('button', { class: 'pill', type: 'button', onclick: () => openDoc(r.doc!, r.title) }, L('笔记', 'Note')) : null,
      r.at && S.papers.has(r.at.paper) ? h('button', { class: 'pill', type: 'button', title: L('回到纸上原来的位置', 'Show on paper'), onclick: () => go(r.at!) }, L('↩ 纸', '↩ paper')) : null));
}

function renderPanel() {
  let panel = $('#shelf-panel');
  if (!panel) {
    panel = h('aside', { id: 'shelf-panel', class: 'side-panel', 'aria-label': L('收着的', 'Kept') });
    document.body.append(panel);
  }
  const keep = panel.querySelector('.shelf-list')?.scrollTop ?? 0;
  const tabBtn = (t: Tab, label: string) =>
    h('button', { class: 'pill' + (tab === t ? ' on' : ''), type: 'button', onclick: () => { tab = t; renderPanel(); } }, label);
  let body: HTMLElement;
  if (tab === 'done') {
    const rows = doneRows();
    body = h('ul', { class: 'shelf-list' });
    let day = '';
    for (const r of rows) {
      if (r.day !== day) { day = r.day; body.append(h('li', { class: 'shelf-day' }, dayTitle(day))); }
      body.append(rowEl(r));
    }
    if (!rows.length) body.append(h('li', { class: 'sp-empty' }, L('还没有做完的事。', 'Nothing done yet.')));
  } else if (tab === 'review') {
    body = h('ul', { class: 'shelf-list' });
    const today = ymd();
    for (const d of [...reviews].reverse()) {
      const r = relDay(d, today);
      body.append(h('li', { class: 'shelf-row' },
        h('div', { class: 'sr-main' },
          h('button', { class: 'sr-t', type: 'button', onclick: () => openReview(d) }, L(`${shortDay(d)} 的日报`, `Review · ${shortDay(d)}`)),
          r !== shortDay(d) ? h('div', { class: 'sr-sub' }, r) : null)));
    }
    if (!reviews.length) body.append(h('li', { class: 'sp-empty' }, L('还没有日报。跟你的 AI 说「写今天的日报」，妥妥就会写一篇。', 'No reviews yet. Tell your AI "Write my daily review" and Toto will write one.')));
  } else if (tab === 'box') {
    body = h('ul', { class: 'shelf-list' });
    for (const p of boxedPapers()) {
      const n = p.blocks.length;
      body.append(h('li', { class: 'shelf-row' },
        h('div', { class: 'sr-main' },
          h('button', { class: 'sr-t', type: 'button', title: L('看一眼', 'Peek'), onclick: () => { toggleShelf(false); focusBlock(p.id, ''); } }, p.title || p.id),
          h('div', { class: 'sr-sub' }, `${n ? L(`${n} 块`, `${n} blocks`) : L('空白', 'blank')} · ${L(`${shortDay(p.archived!.slice(0, 10))} 扔进来`, `boxed ${shortDay(p.archived!.slice(0, 10))}`)}`)),
        h('div', { class: 'sr-btns' },
          h('button', { class: 'pill', type: 'button', onclick: () => unboxPaper(p.id) }, L('拿回纸夹', 'Back to folder')),
          h('button', { class: 'pill danger', type: 'button', onclick: () => trashPaper(p.id) }, L('删掉', 'Delete')))));
    }
    if (!boxedPapers().length) body.append(h('li', { class: 'sp-empty' }, L('纸箱是空的。纸上方「这张纸 ▾ → 扔进纸箱」就收到这里。', 'The box is empty. Use "This paper ▾ → Put in the box" above a paper.')));
  } else {
    body = h('ul', { class: 'shelf-list' });
    for (const n of notes) {
      const name = n.path.replace(/^notes\//, '').replace(/\.md$/, '');
      const on = holders(n.path);
      const d = new Date(n.mtime * 1000);
      body.append(h('li', { class: 'shelf-row' },
        h('div', { class: 'sr-main' },
          h('button', { class: 'sr-t', type: 'button', onclick: () => openDoc(n.path, on[0] ? first(on[0].block.text) : '') }, name),
          h('div', { class: 'sr-sub' }, [L(`${shortDay(ymd(d))} 改过`, `edited ${shortDay(ymd(d))}`), on.length ? L(`挂在「${first(on[0].block.text)}」`, `on "${first(on[0].block.text)}"`) : L('没挂在纸上', 'not on paper')].join(' · '))),
        h('div', { class: 'sr-btns' },
          on[0] ? h('button', { class: 'pill', type: 'button', title: L('回到纸上挂着它的那一块', 'Show the block it hangs on'), onclick: () => go({ paper: on[0].paper.id, block: on[0].block.id }) }, L('↩ 纸', '↩ paper')) : null,
          h('button', { class: 'pill danger', type: 'button', title: L('挪进系统废纸篓', 'Move to Trash'), onclick: async () => { if (await trashNote(n.path)) renderShelf(); } }, L('删掉', 'Delete')))));
    }
    if (!notes.length) body.append(h('li', { class: 'sp-empty' }, L('还没有笔记。', 'No notes yet.')));
  }
  fill(panel,
    h('div', { class: 'sp-head' },
      h('b', null, L('收着的', 'Kept')),
      h('div', { class: 'shelf-tabs' }, tabBtn('done', L('做完的', 'Done')), tabBtn('notes', L('笔记', 'Notes')), tabBtn('review', L('日报', 'Reviews')), tabBtn('box', L('纸箱', 'Box'))),
      h('span', { class: 'grow' }),
      h('button', { class: 'text-btn', type: 'button', title: S.info?.workspace ?? '', onclick: () => fs.reveal(tab === 'notes' ? 'notes' : tab === 'review' && reviews.length ? 'review' : '') }, tab === 'notes' ? '📁 notes' : tab === 'review' ? '📁 review' : L('📁 工作目录', '📁 Folder')),
      h('button', { class: 'icon-btn', type: 'button', title: L('关上', 'Close'), onclick: () => toggleShelf(false) }, '×')),
    h('p', { class: 'sp-note' }, tab === 'done'
      ? L('纸上和池塘里打过勾的事、做过的一截，按那天排。挂着笔记的点名字就能看。', 'Everything ticked on paper or in the pond, and parts done, by day. Click a name to open its note.')
      : tab === 'review' ? L('每天的复盘，新的在上面。工具栏的「日报」直接打开最新一篇。', 'Daily reviews, newest first. The Review button opens the latest.')
      : tab === 'box' ? L('扔进纸箱的纸就是存档：纸夹里不再翻到它。想用再拿回来；真不要了就删掉（挪进系统废纸篓）。', 'Boxed papers are archived and leave the folder. Take one back anytime, or delete it (moves to Trash).')
      : L('工作目录 notes/ 里的每一篇，最近改过的在上面。', 'Every note in notes/, most recently edited first.')),
    body);
  panel.querySelector('.shelf-list')!.scrollTop = keep;
}

export async function toggleShelf(force?: boolean) {
  open = force ?? !open;
  if (!open) { $('#shelf-panel')?.remove(); return; }
  toggleConsensus(false);
  toggleSync(false);
  await Promise.all([loadNotes(), loadReviews().then(d => { reviews = d; })]);
  renderPanel();
}

/** 文件变了（打勾、Claude Code 写了新笔记）跟着刷新 */
export function renderShelf() {
  if (!open) return;
  if (tab === 'notes') loadNotes().then(renderPanel);
  else if (tab === 'review') loadReviews().then(d => { reviews = d; renderPanel(); });
  else renderPanel();
}

export function initShelf() {
  $('#shelf')!.addEventListener('click', () => toggleShelf());
  addEventListener('diem:shelf', e => { tab = (e as CustomEvent).detail as Tab; toggleShelf(true); });
}
