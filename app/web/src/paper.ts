import { fs } from './bridge';
// 「就是那张纸」：一张 A4，有边界，没有结构。
import { L } from './i18n';
import { openDoc } from './doc';
import { blockDoneToast, blockToItems, itemFromBlock, newItem } from './actions';
import { ghost, highlight, track, zoneAt } from './drag';
import { dropShadow } from './timeline';
import { focusItem } from './list';
import { proposedFor } from './memo';
import { closeMenu, menuBelow, MenuEntry, showMenu } from './menu';
import {
  commit, itemById, listVersions, log, newPaperState, paper, paperPath, render, restoreVersion, S, saveUI, saveVersion, activePapers, blankPaper, boxedPapers, flush,
} from './store';
import { timeAt } from './timeline';
import { ANIMALS, animalName, Block, estHeight, freeSpot as spotIn, PAPER_H, PAPER_W, Paper } from './types';
import { importPhoto } from './photo';
import { $, dur, estTag, fill, h, isoNow, MIN_EST, NUMS, parseEst, relDay, toast, uid } from './util';

const MARGIN = 56;
let sel: string | null = null;
let arrowFrom: string | null = null;
/** Shift 点选的一串块：一起复制 */
const multi = new Set<string>();
/** 点中的箭头：可以删、可以换方向 */
let selArrow: string | null = null;
let editingId: string | null = null;
let pendingNew: string | null = null;
let flashId: string | null = null;
let scale = 1;

const blockById = (id: string) => paper().blocks.find(b => b.id === id);

// ───────── 渲染 ─────────

export function renderPaper() {
  renderBar();
  if (S.editing) return;
  renderStage();
  renderSide();
}

function renderBar() {
  const bar = $('#paper-bar')!;
  const list = activePapers();
  const p = paper();
  // 从「收着的」点回一张纸箱里的纸：只看，不在纸夹里翻
  if (p.archived) {
    fill(bar,
      h('button', { class: 'icon-btn', type: 'button', title: L('回纸夹', 'Back to the folder'), onclick: () => switchPaper(list.at(-1)!.id) }, '‹'),
      h('span', { class: 'paper-pick-t' }, L(`纸箱里的 · ${p.title || p.id}`, `In the box · ${p.title || p.id}`)),
      h('span', { class: 'grow' }),
      h('button', { class: 'text-btn', type: 'button', onclick: () => unboxPaper(p.id) }, L('拿回纸夹', 'Back to folder')),
    );
    return;
  }
  const idx = list.findIndex(x => x.id === p.id);
  const full = isFull(p);
  const boxed = boxedPapers().length;
  fill(bar,
    h('button', { class: 'icon-btn', type: 'button', title: L('上一张纸', 'Previous paper'), disabled: idx <= 0, onclick: () => switchPaper(list[idx - 1].id) }, '‹'),
    h('button', {
      class: 'paper-pick', type: 'button', title: L('纸夹：翻回旧纸', 'Folder: flip to older papers'),
      onclick: (e: Event) => menuBelow(e.currentTarget as Element, [
        ...list.slice().reverse().map(x => ({ label: x.title || x.id, hint: blankPaper(x) ? L('空白', 'blank') : L(`${x.blocks.length} 块`, `${x.blocks.length} blocks`), checked: x.id === p.id, action: () => switchPaper(x.id) })),
        '-' as const,
        { label: L('新的一张纸', 'New paper'), hint: '⌘⇧N', action: newPaper },
        ...(boxed ? [{ label: L(`纸箱里还有 ${boxed} 张…`, `${boxed} more in the box…`), hint: L('收着的', 'Kept'), action: () => dispatchEvent(new CustomEvent('diem:shelf', { detail: 'box' })) }] : []),
      ]),
    }, h('span', { class: 'paper-pick-t' }, L('纸夹', 'Folder')), h('span', { class: 'paper-pick-n' }, `${idx + 1} / ${list.length}`), ' ▾'),
    h('button', { class: 'icon-btn', type: 'button', title: L('下一张纸', 'Next paper'), disabled: idx >= list.length - 1, onclick: () => switchPaper(list[idx + 1].id) }, '›'),
    h('span', { class: 'grow' }),
    p.tidied ? h('span', { class: 'tidied', title: L(`${animalName(p.tidied.by)} ${p.tidied.at.slice(11, 16)} 排过顺序`, `${animalName(p.tidied.by)} tidied at ${p.tidied.at.slice(11, 16)}`) + (p.tidied.note ? `${L('：', ': ')}${p.tidied.note}` : '') }, `${ANIMALS[p.tidied.by as keyof typeof ANIMALS]?.emoji ?? ''} ${L(`${p.tidied.at.slice(11, 16)} 排过`, `tidied ${p.tidied.at.slice(11, 16)}`)}`) : null,
    full ? h('span', { class: 'full-hint', title: L('纸写满了或者块很多。要大整理就在 Claude Code 里说一声', 'The paper is getting full. Say "Tidy up" in Claude Code if you want') }, L('纸有点满了', 'Getting full')) : null,
    h('button', { class: 'text-btn', type: 'button', title: L('对这张纸：复制、版本、新的一张、扔掉', 'This paper: copy, versions, new, discard'), onclick: (e: Event) => paperMenu(e.currentTarget as Element) }, L('这张纸 ▾', 'This paper ▾')),
  );
}

/** 对整张纸的事都收在这里，台面上干净一点 */
function paperMenu(anchor: Element) {
  const p = paper();
  const blank = blankPaper(p);
  menuBelow(anchor, [
    { label: L('复制整张纸', 'Copy the whole paper'), hint: L('成 Markdown，贴给大模型', 'As Markdown, for any AI chat'), action: () => copyPaper() },
    { label: L('版本…', 'Versions…'), hint: L('⌘S 存一版', '⌘S saves one'), action: () => openVersions(anchor) },
    { label: L('📷 从照片导入…', '📷 Import from photo…'), hint: L('也可以直接把照片拖进窗口', 'Or drop a photo on the window'), action: () => importPhoto() },
    '-',
    { label: L('新的一张纸', 'New paper'), hint: '⌘⇧N', action: newPaper },
    '-',
    ...(blank
      ? [{ label: L('扔掉这张空白纸', 'Discard this blank paper'), hint: L('什么都没写，直接扔', 'Nothing on it'), danger: true, action: () => trashPaper(p.id) }]
      : [
        { label: L('扔进纸箱', 'Put in the box'), hint: L('收起来，随时拿回', 'Archive; take it back anytime'), action: () => boxPaper(p.id) },
        { label: L('删掉这张纸…', 'Delete this paper…'), danger: true, action: () => trashPaper(p.id) },
      ]),
  ]);
}

/** 当前这张不在纸夹里了：翻到旁边一张，一张都不剩就开一张新的 */
function leavePaper(id: string) {
  if (S.cur !== id) return;
  const list = activePapers().filter(x => x.id !== id);
  const next = list.filter(x => x.created + x.id < paper().created + id).at(-1) ?? list[0];
  S.cur = next ? next.id : newPaperState().id;
}

export function boxPaper(id: string) {
  const p = S.papers.get(id);
  if (!p) return;
  commit(() => { leavePaper(id); p.archived = isoNow(); });
  sel = null;
  saveUI();
  log(L(`把「${p.title || id}」扔进纸箱`, `Put "${p.title || id}" in the box`));
  toast(L('扔进纸箱了：「收着的 → 纸箱」里能拿回来', 'In the box. Get it back from Kept → Box'));
}

export function unboxPaper(id: string) {
  const p = S.papers.get(id);
  if (!p) return;
  commit(() => { delete p.archived; });
  switchPaper(id);
  log(L(`把「${p.title || id}」从纸箱拿回纸夹`, `Took "${p.title || id}" back from the box`));
  toast(L('拿回纸夹了', 'Back in the folder'));
}

/** 删掉：纸的文件挪进系统废纸篓（还没倒掉就能从废纸篓捡回来）；版本留着 */
export async function trashPaper(id: string) {
  const p = S.papers.get(id);
  if (!p) return;
  if (!blankPaper(p) && !confirm(L(`删掉「${p.title || id}」？\n纸挪进系统的废纸篓，倒废纸篓之前还能捡回来。\n只是不想看见的话，用「扔进纸箱」就行。`, `Delete "${p.title || id}"?\nIt goes to the Trash, so you can still get it back until you empty it.\nIf you just want it out of sight, use "Put in the box".`))) return;
  await flush();
  if (!blankPaper(p)) await saveVersion(id, L('删掉前', 'before-delete'));
  // 返回 false 是文件本来就不在（比如从没存过），照样从纸夹里拿掉；出错多半是 app 还没重装
  try { await fs.trash(paperPath(id)); } catch { toast(L('没删掉，再试一次', "Couldn't delete it. Try again")); return; }
  leavePaper(id);
  S.papers.delete(id);
  delete S.mtimes[paperPath(id)];
  sel = null;
  saveUI();
  render();
  log(L(`删掉了「${p.title || id}」${blankPaper(p) ? '（空白纸）' : ''}`, `Deleted "${p.title || id}"${blankPaper(p) ? ' (blank)' : ''}`));
  toast(blankPaper(p) ? L('扔掉了', 'Discarded') : L('删掉了，在系统废纸篓里', 'Deleted. It is in the Trash'));
}

function computeScale(): number {
  const scroll = $('#paper-scroll')!;
  const avail = scroll.clientWidth - 48;
  return Math.max(0.3, Math.min(1.3, avail / PAPER_W));
}


/** 纸的实际高度：写到 A4 外面就往下接长，A4 的边界画一条细线 */
let paperH = PAPER_H;

function renderStage() {
  const p = paper();
  scale = computeScale();
  const stage = $('#paper-stage')!;
  stage.style.width = PAPER_W * scale + 'px';

  const items = p.blocks.filter(b => b.kind === 'item');
  const done = items.filter(b => b.done || b.struck).length;
  const sheet = h('div', { class: 'paper' + (arrowFrom ? ' arrowing' : ''), 'data-drop': 'paper', style: { transform: `scale(${scale})` } },
    h('div', { class: 'p-head' }, L('若无闲事挂心头', 'Nothing weighing on the mind')),
    h('div', {
      class: 'p-title', contenteditable: 'plaintext-only', spellcheck: 'false',
      onfocus: () => (S.editing = true),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); (e.target as HTMLElement).blur(); } },
      onblur: (e: Event) => {
        S.editing = false;
        const t = (e.target as HTMLElement).innerText.trim();
        if (t && t !== p.title) commit(() => (p.title = t));
        else afterEdit();
      },
    }, p.title),
    ...p.rules.map(r => h('div', { class: 'rule', dataset: { rid: r.id }, style: { top: r.y + 'px', left: r.x1 + 'px', width: r.x2 - r.x1 + 'px' } })),
    ...p.blocks.map(blockEl),
    ...proposalGhosts(p),
    h('div', { class: 'p-foot' }, items.length ? L(`整张纸 ${done} / ${items.length}`, `${done} / ${items.length} on this paper`) : L('点空白处写下第一个念头', 'Click anywhere to write your first thought')),
  );
  stage.replaceChildren(sheet);
  let bottom = 0;
  sheet.querySelectorAll<HTMLElement>('.blk').forEach(el => (bottom = Math.max(bottom, el.offsetTop + el.offsetHeight)));
  for (const r of p.rules) bottom = Math.max(bottom, r.y);
  paperH = Math.max(PAPER_H, Math.ceil(bottom + 90));
  if (paperH > PAPER_H) {
    sheet.style.height = paperH + 'px';
    sheet.append(h('div', { class: 'a4-line', style: { top: PAPER_H + 'px' } }, h('span', null, L('A4 到这里', 'A4 ends here'))));
  }
  stage.style.height = paperH * scale + 'px';
  drawArrows(sheet, p);
  renderTools(sheet);
  if (flashId) {
    const el = sheet.querySelector(`[data-bid="${flashId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => { flashId = null; el?.classList.remove('flash'); }, 1800);
  }
}

function blockEl(b: Block): HTMLElement {
  const [main, ...subs] = b.text.split('\n');
  const cls = ['blk', b.kind, b.done && 'done', b.struck && 'struck', b.circled && 'circled',
    (sel === b.id || multi.has(b.id)) && 'sel', flashId === b.id && 'flash', isFresh(b) && 'added'].filter(Boolean).join(' ');
  const who = b.by && b.by !== 'me' ? ANIMALS[b.by] : null;
  return h('div', { class: cls, dataset: { bid: b.id }, style: { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px' } },
    b.num ? h('span', { class: 'num' }, NUMS[b.num]) : null,
    b.kind === 'item' ? h('button', { class: 'box', type: 'button', 'aria-label': L('打勾 / 取消', 'Tick / untick'), 'aria-pressed': String(!!b.done) }) : null,
    h('div', { class: 'txt' },
      h('div', { class: 'main' }, h('span', { class: 'm' }, main || ' '), b.guess ? h('span', { class: 'q', title: L('没认准，点进去改', 'Not sure about this word; click to fix') }, '？') : null,
        sizeTag(b) ? h('button', { class: 'est-tag' + (b.errand ? ' errand' : ''), type: 'button', title: b.errand ? L('顺手的事，不占时间。点一下改', 'An errand, takes no slot. Click to change') : L(`预计 ${dur(b.estimate!)}，点一下改`, `About ${dur(b.estimate!)}. Click to change`), dataset: { est: b.id } }, sizeTag(b)) : null,
        marks(b, who)),
      ...subs.map(s => /^https?:\/\/\S+$/.test(s.trim())
        ? h('a', { class: 'sub url', href: s.trim(), target: '_blank', rel: 'noopener' }, s.trim().replace(/^https?:\/\//, ''))
        : h('div', { class: 'sub' }, s))),
  );
}

/** 提议预览：块要挪到的地方画一个虚线框；新建的块画成虚线块 */
function proposalGhosts(p: Paper): HTMLElement[] {
  const moves = proposedFor(paperPath(p.id), 'block');
  const out: HTMLElement[] = [];
  for (const [id, after] of moves) {
    const b = p.blocks.find(x => x.id === id);
    const x = (after.x as number | undefined) ?? b?.x, y = (after.y as number | undefined) ?? b?.y;
    if (x == null || y == null || (b && x === b.x && y === b.y && !('text' in after))) continue;
    const text = String(after.text ?? b?.text ?? '').split('\n')[0];
    out.push(h('div', {
      class: 'blk-ghost' + (b ? '' : ' new'), title: b ? L(`提议挪到这里：${text}`, `Proposed move: ${text}`) : L(`提议新写一块：${text}`, `Proposed new block: ${text}`),
      style: { left: x + 'px', top: y + 'px', width: ((after.w as number | undefined) ?? b?.w ?? 300) + 'px' },
    }, h('span', null, (b ? '↘ ' : '＋ ') + text)));
  }
  return out;
}

/** 补进来的块：对应 memo 还没接受（或没挂 memo）时，显示成「补」 */
function isFresh(b: Block): boolean {
  if (!b.added) return false;
  if (!b.added.memo) return true;
  return S.memos.find(m => m.id === b.added!.memo)?.status === 'pending';
}

function marks(b: Block, who: { emoji: string } | null) {
  const fresh = isFresh(b);
  return (fresh || who || b.links?.length || b.confirmed || b.doc || b.audio) ? h('span', { class: 'marks' },
      fresh ? h('span', { class: 'added-mark', title: L(`${b.added!.from} · ${b.added!.at.slice(5, 16).replace('T', ' ')} 补进来的；接受 memo 后就不再标`, `Added from ${b.added!.from} at ${b.added!.at.slice(5, 16).replace('T', ' ')}; the mark goes away once you accept the memo`) }, L('补', '+')) : null,
      b.doc ? h('button', { class: 'doc-mark', type: 'button', title: L('有笔记，点一下打开', 'Has a note. Click to open'), dataset: { doc: b.doc } }, L('笔记', 'Note')) : null,
      b.audio ? h('button', { class: 'doc-mark audio-mark', type: 'button', title: L('录音，点一下用系统播放器听', 'A recording. Click to play'), dataset: { audio: b.audio } }, L('听', 'Play')) : null,
      who ? h('span', { class: 'badge', title: L(`${animalName(b.by!)} 动过`, `Touched by ${animalName(b.by!)}`) }, who.emoji) : null,
      b.confirmed ? h('span', { class: 'lock', title: L('你确认过，AI 不改', 'Confirmed by you; AI leaves it alone') }, '✓') : null,
      b.links?.length ? h('button', { class: 'linked', type: 'button', title: L('已经丢到池塘里，点一下去看', 'Already in the pond. Click to see it'), dataset: { link: b.links.at(-1)! } }, L('→ 池塘', '→ pond')) : null,
    ) : null;
}

/** 选中一块时，上方浮一排小按钮 */
function renderTools(sheet: HTMLElement) {
  $('#blk-tools')?.remove();
  if (multi.size > 1 && !editingId) {
    const ids = [...multi];
    const els = ids.map(id => sheet.querySelector(`[data-bid="${id}"]`) as HTMLElement | null).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const bar = h('div', { id: 'blk-tools', class: 'blk-tools' },
      h('span', { class: 'tools-tip' }, L('拖任意一块，一起挪', 'Drag any one to move them all')),
      h('button', { type: 'button', onclick: (e: Event) => { e.stopPropagation(); copyBlocks(ids); } }, L(`复制 ${ids.length} 块`, `Copy ${ids.length}`)),
      h('button', { type: 'button', title: 'Esc', onclick: (e: Event) => { e.stopPropagation(); multi.clear(); sel = null; render(); } }, L('取消多选', 'Deselect')));
    document.body.append(bar);
    const top = Math.min(...els.map(el => el.getBoundingClientRect().top));
    const left = Math.min(...els.map(el => el.getBoundingClientRect().left));
    const br = bar.getBoundingClientRect();
    bar.style.left = Math.max(8, Math.min(left, innerWidth - br.width - 8)) + 'px';
    bar.style.top = Math.max(84, top - br.height - 6) + 'px';
    return;
  }
  if (!sel || editingId) return;
  const b = blockById(sel);
  const el = sheet.querySelector(`[data-bid="${sel}"]`) as HTMLElement | null;
  if (!b || !el) return;
  const tool = (label: string, title: string, fn: (btn: Element) => void, on = false) =>
    h('button', { type: 'button', class: on ? 'on' : '', title, onclick: (e: Event) => { e.stopPropagation(); fn(e.currentTarget as Element); } }, label);
  const bar = h('div', { id: 'blk-tools', class: 'blk-tools' },
    tool(L('改字', 'Edit'), L('改字（回车）', 'Edit text (Return)'), () => startEdit(b.id)),
    tool(L('复制', 'Copy'), L('复制成 Markdown，贴到任何大模型窗口（⌘C；按住 Shift 点多块可以一起复制）', 'Copy as Markdown for any AI chat (⌘C; Shift-click to pick several)'), () => copyBlocks([b.id])),
    b.kind === 'heading' ? tool(L('选中这一节', 'Select section'), L('选中小标题和它下面的块，可以一起复制、一起挪', 'Select the heading and everything under it'), () => { sectionOf(b.id).forEach(x => multi.add(x)); sel = b.id; render(); }) : null,
    b.kind === 'item' ? tool(sizeTag(b) ? `⏱ ${sizeTag(b)}` : L('⏱ 多久', '⏱ How long'), L('预计要多久（也可以直接在字后面写 2H、30min；不占时间的写「顺手」）', 'Estimate (or just write 2H, 30min at the end; write "errand" if it takes no slot)'), btn => estMenu(b, btn), !!sizeTag(b)) : null,
    tool(L('圈', 'Circle'), L('圈起来（O）', 'Circle it (O)'), () => toggle(b, 'circled'), !!b.circled),
    tool('→', L('拉箭头：再点另一块（A）', 'Arrow: then click another block (A)'), () => startArrow(b.id)),
    tool(b.num ? NUMS[b.num] : '①', L('打编号（1–9，0 去掉）', 'Number it (1–9, 0 removes)'), () => setNum(b, ((b.num ?? 0) % 9) + 1)),
    tool(L('划掉', 'Strike'), L('划掉：决定不做（X）', 'Strike out: decided not to (X)'), () => toggle(b, 'struck'), !!b.struck),
    b.kind === 'item' ? tool(L('丢到池塘里', 'To pond'), L('变成一件事，丢到今日池塘', 'Make it a task in the pond'), () => itemFromBlock(b.id)) : null,
    tool(L('删', 'Delete'), L('删掉这块（⌫，可撤销）', 'Delete this block (⌫, undoable)'), () => removeBlock(b.id)),
  );
  document.body.append(bar);
  const r = el.getBoundingClientRect();
  const br = bar.getBoundingClientRect();
  bar.style.left = Math.max(8, Math.min(r.left, innerWidth - br.width - 8)) + 'px';
  bar.style.top = Math.max(84, r.top - br.height - 6) + 'px';
}

// ───────── 箭头 ─────────

function drawArrows(sheet: HTMLElement, p: Paper) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'arrows');
  svg.setAttribute('viewBox', `0 0 ${PAPER_W} ${paperH}`);
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" /></marker></defs>';
  const box = (id: string) => {
    const el = sheet.querySelector(`[data-bid="${id}"]`) as HTMLElement | null;
    if (!el) return null;
    const m = el.querySelector('.m') as HTMLElement;
    const x = el.offsetLeft + (el.querySelector('.txt') as HTMLElement).offsetLeft;
    return { x: x - 4, y: el.offsetTop, w: Math.min(m.offsetWidth, el.offsetWidth) + 8, h: el.offsetHeight };
  };
  for (const a of p.arrows) {
    const A = box(a.from), B = box(a.to);
    if (!A || !B) continue;
    const [x1, y1] = edge(A, B.x + B.w / 2, B.y + B.h / 2);
    const [x2, y2] = edge(B, A.x + A.w / 2, A.y + A.h / 2);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bend = Math.min(40, len * 0.18);
    const cx = mx - ((y2 - y1) / len) * bend, cy = my + ((x2 - x1) / len) * bend;
    const d = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('marker-end', 'url(#ah)');
    if (selArrow === a.id) path.setAttribute('class', 'sel');
    // 看不见的粗线：好点中
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'hit');
    hit.setAttribute('data-aid', a.id);
    const title = document.createElementNS(NS, 'title');
    title.textContent = L('点一下选中箭头，再按 ⌫ 删掉；右键能换方向', 'Click to select, ⌫ to delete; right-click to flip');
    hit.append(title);
    svg.append(hit, path);
    if (selArrow === a.id) {
      // 曲线中点上放一个小叉
      const px = 0.25 * x1 + 0.5 * cx + 0.25 * x2, py = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
      sheet.append(h('button', {
        class: 'arrow-x', type: 'button', title: L('删掉这根箭头（⌫）', 'Delete this arrow (⌫)'), dataset: { delArrow: a.id },
        style: { left: px + 'px', top: py + 'px' },
      }, '×'));
    }
  }
  sheet.append(svg);
}

function edge(r: { x: number; y: number; w: number; h: number }, tx: number, ty: number): [number, number] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  const k = Math.min(dx ? (r.w / 2 + 3) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + 3) / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

// ───────── 复制：贴到任何大模型窗口（Claude、Codex、元宝、Gemini……） ─────────

/** 这块归哪个小标题：它上方、左右范围和它重叠的最近一个 */
function ownerOf(b: Block, p: Paper): Block | undefined {
  return p.blocks
    .filter(hd => hd.kind === 'heading' && hd.id !== b.id && hd.y <= b.y && Math.min(b.x + b.w, hd.x + hd.w) - Math.max(b.x, hd.x) > 40)
    .sort((a, c) => c.y - a.y)[0];
}

/** 一节：小标题 + 归它管的块 */
function sectionOf(headId: string): string[] {
  const p = paper();
  const hd = p.blocks.find(x => x.id === headId);
  if (!hd || hd.kind !== 'heading') return [headId];
  return [headId, ...p.blocks.filter(b => b.kind !== 'heading' && ownerOf(b, p) === hd).map(b => b.id)];
}

/** 纸上的阅读顺序：先左栏从上到下，再右栏 */
const readingOrder = (a: Block, b: Block) => (a.x < 400 ? 0 : 1) - (b.x < 400 ? 0 : 1) || a.y - b.y || a.x - b.x;

async function blockMarkdown(b: Block): Promise<string> {
  const [first, ...rest] = b.text.split('\n');
  const num = b.num ? `${NUMS[b.num]} ` : '';
  const flags = [b.circled && L('圈出来的', 'circled'), b.guess && L('有字没认准', 'some words unsure')].filter(Boolean).join(L('、', ', '));
  const head = b.kind === 'heading' ? `## ${first}`
    : b.struck ? `- ~~${num}${first}~~${L('（划掉了，决定不做）', ' (struck out, not doing)')}`
    : b.kind === 'item' ? `- [${b.done ? 'x' : ' '}] ${num}${first}${sizeTag(b) ? ` ${sizeTag(b)}` : ''}`
    : `- ${num}${first}`;
  const lines = [head + (flags ? `（${flags}）` : '')];
  for (const r of rest) if (r.trim()) lines.push(`  ${r.trim()}`);
  if (b.doc) {
    const d = await fs.read(b.doc).catch(() => null);
    if (d) lines.push(L(`  笔记《${b.doc.replace(/^notes\//, '').replace(/\.md$/, '')}》：`, `  Note "${b.doc.replace(/^notes\//, '').replace(/\.md$/, '')}":`), ...d.text.trim().split('\n').map(l => `  > ${l}`));
  }
  return lines.join('\n');
}

async function toMarkdown(blocks: Block[], title?: string): Promise<string> {
  const p = paper();
  const ids = new Set(blocks.map(b => b.id));
  const parts = title ? [`# ${title}`, ''] : [];
  const heads = p.blocks.filter(b => b.kind === 'heading').sort(readingOrder);
  const owner = (b: Block) => ownerOf(b, p);
  const groups = new Map<Block | undefined, Block[]>([[undefined, []], ...heads.map(hd => [hd, []] as [Block, Block[]])]);
  for (const b of blocks) if (b.kind !== 'heading') groups.get(owner(b))!.push(b);
  for (const [hd, list] of groups) {
    const wanted = hd && ids.has(hd.id);
    if (!wanted && !list.length) continue;
    if (parts.length && parts.at(-1) !== '') parts.push('');
    if (hd && (wanted || title || blocks.length > 1)) parts.push(await blockMarkdown(hd));
    for (const b of list.sort(readingOrder)) parts.push(await blockMarkdown(b));
  }
  const name = (id: string) => (p.blocks.find(x => x.id === id)?.text ?? '').split('\n')[0];
  const arrows = p.arrows.filter(a => ids.has(a.from) && ids.has(a.to));
  if (arrows.length) parts.push('', L('箭头（念头之间的关系）：', 'Arrows (how thoughts connect):'), ...arrows.map(a => `- ${name(a.from)} → ${name(a.to)}`));
  return parts.join('\n').trim() + '\n';
}

async function putOnClipboard(text: string, what: string) {
  try { await fs.copy(text); toast(L(`复制好了：${what}，可以贴到任何大模型窗口`, `Copied ${what}. Paste it into any AI chat`)); }
  catch { toast(L('复制没成功，再试一次', "Couldn't copy. Try again")); }
}

export async function copyBlocks(ids: string[]) {
  const blocks = ids.map(blockById).filter(Boolean) as Block[];
  if (!blocks.length) return;
  await putOnClipboard(await toMarkdown(blocks), blocks.length > 1 ? L(`${blocks.length} 块`, `${blocks.length} blocks`) : `「${blocks[0].text.split('\n')[0]}」`);
}

export async function copyPaper() {
  const p = paper();
  await putOnClipboard(await toMarkdown(p.blocks, p.title), L(`整张纸「${p.title}」`, `the whole paper "${p.title}"`));
}

/** ⌘C：选中了块就复制块；多选就复制那一串 */
export function copySelection(): boolean {
  if (S.editing) return false;
  if (multi.size) { copyBlocks([...multi]); return true; }
  if (sel) { copyBlocks([sel]); return true; }
  return false;
}

function removeArrow(id: string) {
  const p = paper();
  commit(() => (p.arrows = p.arrows.filter(a => a.id !== id)));
  selArrow = null;
  toast(L('箭头删掉了（⌘Z 可以撤回）', 'Arrow deleted (⌘Z to undo)'));
}

function startArrow(id: string) {
  arrowFrom = id;
  toast(L('再点另一块，箭头就连过去（Esc 取消）', 'Click another block to connect (Esc to cancel)'));
  render();
}

// ───────── 块的操作 ─────────

function touch(b: Block) { b.by = 'me'; }

function toggle(b: Block, key: 'circled' | 'struck' | 'done') {
  commit(() => {
    b[key] = !b[key]; touch(b);
    if (key === 'done') { if (b.done) b.doneAt = isoNow(); else delete b.doneAt; }
  });
  if (key !== 'circled') blockDoneToast(b);
  if (key === 'struck' && b.struck) log(L(`纸上划掉「${b.text.split('\n')[0]}」：决定先放下`, `Struck out "${b.text.split('\n')[0]}" on paper: letting it go`));
}

function setNum(b: Block, n: number) {
  commit(() => { b.num = n || undefined; touch(b); });
}

/** 预计多久：纸上这块和它丢进池塘的那件事一起改（做完的不动） */
/** 块后面的小签：「2H」「30min」或「顺手」 */
const sizeTag = (b: Block) => (b.errand ? L('顺手', 'errand') : b.estimate ? estTag(b.estimate) : '');

function setEst(b: Block, min: number | undefined, errand = false) {
  commit(() => { setEstIn(b, min, errand); touch(b); });
}

function setEstIn(b: Block, min: number | undefined, errand = false) {
  if (min) b.estimate = min; else delete b.estimate;
  if (errand) b.errand = true; else delete b.errand;
  for (const id of b.links ?? []) {
    const it = itemById(id);
    if (it && !it.done) {
      if (min) it.estimate = min; else delete it.estimate;
      if (errand) it.errand = true; else delete it.errand;
      it.updated = isoNow();
    }
  }
}

const EST_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240];
function estMenu(b: Block, anchor: Element) {
  menuBelow(anchor, [
    ...EST_CHOICES.map(m => ({ label: estTag(m), hint: dur(m), checked: b.estimate === m, action: () => setEst(b, m) })),
    '-' as const,
    { label: L('顺手（不占时间）', 'Errand (takes no slot)'), hint: L('找张卡、打个电话', 'Grab a card, make a call'), checked: !!b.errand, action: () => setEst(b, undefined, true) },
    '-' as const,
    { label: L('去掉', 'Clear'), hint: L(`放上时间轴时按最小的 ${MIN_EST} 分钟`, `Uses the smallest ${MIN_EST} min on the timeline`), action: () => setEst(b, undefined) },
  ]);
}

function removeBlock(id: string) {
  const p = paper();
  commit(() => {
    p.blocks = p.blocks.filter(b => b.id !== id);
    p.arrows = p.arrows.filter(a => a.from !== id && a.to !== id);
  });
  sel = null;
  toast(L('删掉了（⌘Z 可以撤回）', 'Deleted (⌘Z to undo)'));
}

function toggleKind(b: Block) {
  commit(() => { b.kind = b.kind === 'heading' ? 'item' : 'heading'; touch(b); });
}

/** 块在屏幕上量出来的高度；纸没摆出来时按字数估 */
export function measureBlock(b: Block): number {
  const el = $('#paper-stage .paper')?.querySelector(`[data-bid="${b.id}"]`) as HTMLElement | null;
  return el?.offsetHeight || estHeight(b);
}

/** 新块放哪：接在整张纸最下面，不叠在别的块上 */
function freeSpot(): { x: number; y: number } {
  return spotIn(paper().blocks, measureBlock);
}

function isFull(p: Paper): boolean {
  // 纸可以往 A4 下面接长了，所以只按块数提醒
  return p.blocks.length >= 32;
}

/** 从池塘拖回纸上：这件事还没想好，退回成念头。
 *  从纸上来的：纸上那块还在原处，去掉「→ 池塘」；不是从纸上来的：在当前纸的空地新写一块。一次 ⌘Z 全撤回 */
export function itemToPaper(id: string) {
  const it = S.backup.items.find(i => i.id === id);
  if (!it) return;
  const src = it.source ? S.papers.get(it.source.paper)?.blocks.find(b => b.id === it.source!.block) : undefined;
  let nb: Block | undefined;
  if (!src) {
    const { x, y } = freeSpot();
    nb = { id: uid('b'), kind: 'item', x, y, w: x < 400 ? 360 : 290, text: it.note ? `${it.title}\n${it.note}` : it.title, by: 'me', created: isoNow() };
    if (it.estimate) nb.estimate = it.estimate;
    if (it.errand) nb.errand = true;
  }
  commit(() => {
    S.backup.items = S.backup.items.filter(i => i.id !== id);
    if (src) {
      src.links = src.links?.filter(l => l !== id);
      if (!src.links?.length) delete src.links;
    } else paper().blocks.push(nb!);
  });
  log(L(`退回纸上「${it.title}」，还是念头${it.plan ? `（原来排在 ${relDay(it.plan.date)}）` : ''}`, `Sent "${it.title}" back to paper as a thought${it.plan ? ` (was planned ${relDay(it.plan.date)})` : ''}`));
  toast(L(`「${it.title}」退回纸上了（⌘Z 可以撤回）`, `"${it.title}" is back on paper (⌘Z to undo)`));
  const bid = src?.id ?? nb!.id;
  if (!src || it.source!.paper === S.cur) { flashId = bid; render(); }
}

/** 快捷输入框 / Claude Code 以外的入口：放一块新的念头 */
export function addThought(raw: string, by: Block['by'] = 'me') {
  const { x, y } = freeSpot();
  const { text, est, errand } = parseEst(raw);
  const b: Block = { id: uid('b'), kind: 'item', x, y, w: x < 400 ? 360 : 290, text, by, created: isoNow(), ...(est ? { estimate: est } : {}), ...(errand ? { errand } : {}) };
  commit(() => paper().blocks.push(b));
  flashId = b.id;
  render();
}

function createAt(x: number, y: number) {
  const p = paper();
  const w = Math.max(160, Math.min(360, PAPER_W - x - 30));
  const b: Block = { id: uid('b'), kind: 'item', x: Math.max(14, x - 20), y: Math.max(40, y - 12), w, text: '', by: 'me', created: isoNow() };
  // 先不 commit：写了字才算数，空的就当没点过
  p.blocks.push(b);
  pendingNew = b.id;
  sel = b.id;
  renderStage();
  startEdit(b.id);
}

// ───────── 改字 ─────────

function startEdit(id: string) {
  const b = blockById(id);
  const el = $(`#paper-stage [data-bid="${id}"]`);
  if (!b || !el) return;
  $('#blk-tools')?.remove();
  sel = id;
  editingId = id;
  S.editing = true;
  el.classList.add('editing');
  const txt = el.querySelector('.txt') as HTMLElement;
  // 预计时长照纸上的写法接在第一行后面，改字时一起改；删掉就是不写了
  const [first, ...rest] = b.text.split('\n');
  txt.textContent = sizeTag(b) ? [`${first} ${sizeTag(b)}`, ...rest].join('\n') : b.text;
  txt.contentEditable = 'plaintext-only';
  txt.spellcheck = false;
  txt.focus();
  const range = document.createRange();
  range.selectNodeContents(txt);
  range.collapse(false);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(range);
  let cancel = false;
  txt.onkeydown = e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); txt.blur(); }
    if (e.key === 'Escape') { cancel = true; txt.blur(); }
    e.stopPropagation();
  };
  txt.onblur = () => finishEdit(id, txt.innerText, cancel);
}

function finishEdit(id: string, raw: string, cancel: boolean) {
  S.editing = false;
  editingId = null;
  const p = paper();
  const b = blockById(id);
  const clean = raw.replace(/ /g, ' ').replace(/\n+$/, '').replace(/^\n+/, '');
  // 条目第一行末尾写的「2H」「30min」认成预计时长
  const { text, est, errand } = !b || b.kind === 'item' ? parseEst(clean) : { text: clean, est: b.estimate, errand: b.errand };
  if (pendingNew === id) {
    pendingNew = null;
    p.blocks = p.blocks.filter(x => x.id !== id);
    if (!cancel && text.trim() && b) {
      commit(() => p.blocks.push({ ...b, text, ...(est ? { estimate: est } : {}), ...(errand ? { errand } : {}) }));
      return;
    }
    sel = null;
    afterEdit();
    return;
  }
  const sizeChanged = b && (est !== b.estimate || !!errand !== !!b.errand);
  if (b && !cancel && text.trim() && (text !== b.text || sizeChanged)) {
    // 你改过一次，「？」就去掉，AI 以后不再改回；预计时长跟着一起改，一次 ⌘Z 全撤回
    commit(() => {
      if (text !== b.text) { b.text = text; b.guess = false; blockToItems(b); }
      if (sizeChanged) setEstIn(b, est, !!errand);
      b.by = 'me';
    });
    return;
  }
  afterEdit();
}

function afterEdit() {
  render();
}

// ───────── 鼠标 ─────────

function toPaper(e: { clientX: number; clientY: number }) {
  const r = $('#paper-stage .paper')!.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (S.editing || t.closest('.p-title') || t.closest('.box') || t.closest('.linked') || t.closest('a.url')) return;
  const del = t.closest('[data-del-arrow]') as HTMLElement | null;
  if (del) { e.stopPropagation(); removeArrow(del.dataset.delArrow!); return; }
  const aEl = t.closest('[data-aid]');
  if (aEl) {
    selArrow = aEl.getAttribute('data-aid');
    sel = null;
    render();
    return;
  }
  if (selArrow) { selArrow = null; render(); return; }
  const bEl = t.closest('.blk') as HTMLElement | null;
  const rEl = t.closest('.rule') as HTMLElement | null;
  if (bEl) return blockDown(e, bEl.dataset.bid!, t);
  if (rEl) return ruleDown(e, rEl.dataset.rid!);
  // 空白处按住拖：拉一个框，框到的块都选中（按住 Shift 是往已选的里加）
  const start = toPaper(e);
  let box: HTMLElement | null = null;
  const rectOf = (ev: PointerEvent) => {
    const pt = toPaper(ev);
    return { x: Math.min(start.x, pt.x), y: Math.min(start.y, pt.y), w: Math.abs(pt.x - start.x), h: Math.abs(pt.y - start.y) };
  };
  track(e, {
    onStart() {
      box = h('div', { class: 'marquee' });
      $('#paper-stage .paper')!.append(box);
      $('#blk-tools')?.remove();
    },
    onMove(ev) {
      const r = rectOf(ev);
      Object.assign(box!.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    },
    onEnd(ev, moved) {
      if (moved) {
        const r = rectOf(ev);
        box?.remove();
        if (!ev.shiftKey) multi.clear();
        const sheet = $('#paper-stage .paper')!;
        for (const bl of paper().blocks) {
          const node = sheet.querySelector(`[data-bid="${bl.id}"]`) as HTMLElement | null;
          const bw = node?.offsetWidth ?? bl.w, bh = node?.offsetHeight ?? 30;
          if (bl.x < r.x + r.w && bl.x + bw > r.x && bl.y < r.y + r.h && bl.y + bh > r.y) multi.add(bl.id);
        }
        if (multi.size === 1) { sel = [...multi][0]; multi.clear(); }
        else sel = multi.size ? [...multi][0] : null;
        render();
        return;
      }
      if (arrowFrom) { arrowFrom = null; render(); return; }
      if (multi.size) { multi.clear(); sel = null; render(); return; }
      if (sel) { sel = null; render(); return; }
      const pt = toPaper(ev);
      createAt(pt.x, pt.y);
    },
  });
}

function blockDown(e: PointerEvent, id: string, target: HTMLElement) {
  const b = blockById(id)!;
  if (arrowFrom) {
    if (arrowFrom !== id) {
      const from = arrowFrom;
      commit(() => paper().arrows.push({ id: uid('a'), from, to: id, by: 'me' }));
    }
    arrowFrom = null;
    render();
    return;
  }
  const el = $(`#paper-stage [data-bid="${id}"]`)!;
  const title = b.text.split('\n')[0];
  // 一起挪的：选中了多块就是那一组；拖小标题就是整节（按住 ⌥ 只挪标题）
  const groupIds = multi.size > 1 && multi.has(id) ? [...multi]
    : b.kind === 'heading' && !e.altKey ? sectionOf(id) : [id];
  const group = groupIds.map(gid => ({ b: blockById(gid)!, el: $(`#paper-stage [data-bid="${gid}"]`) as HTMLElement | null }))
    .filter(g => g.b && g.el) as { b: Block; el: HTMLElement }[];
  const together = group.length > 1;
  const len = b.estimate ?? MIN_EST;
  track(e, {
    onStart() { group.forEach(g => g.el.classList.add('dragging')); $('#blk-tools')?.remove(); },
    onMove(ev, dx, dy) {
      const zone = together ? null : zoneAt(ev.clientX, ev.clientY);
      if (zone === 'list' || zone === 'time') {
        el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
        el.classList.add('lifted');
        ghost(zone === 'time' ? `${title} · ${hmAt(ev.clientY, len)}` : `${title} → ${L('丢到池塘里', 'to the pond')}`, ev.clientX, ev.clientY);
        dropShadow(zone === 'time' ? ev.clientY : null, len, !b.estimate);
        highlight(zone);
      } else {
        el.classList.remove('lifted');
        ghost(null); highlight(null); dropShadow(null);
        for (const g of group) {
          g.el.style.left = g.b.x + dx / scale + 'px';
          g.el.style.top = g.b.y + dy / scale + 'px';
        }
      }
    },
    onEnd(ev, moved) {
      if (!moved) {
        if (target.closest('.doc-mark')) return;
        if (target.closest('.est-tag')) { sel = id; estMenu(b, target.closest('.est-tag')!); return; }
        if (ev.shiftKey) {
          // Shift 点：加进 / 移出多选，用来一起复制、一起挪
          if (!multi.size && sel && sel !== id) multi.add(sel);
          multi.has(id) ? multi.delete(id) : multi.add(id);
          sel = multi.size ? id : null;
          render();
          return;
        }
        multi.clear();
        if (sel === id && target.closest('.txt')) b.doc ? openDoc(b.doc, b.text.split('\n')[0]) : startEdit(id);
        else { sel = id; render(); }
        return;
      }
      if (!together) {
        const zone = zoneAt(ev.clientX, ev.clientY);
        if (zone === 'list') { itemFromBlock(id); return; }
        if (zone === 'time') {
          const start = timeAt(ev.clientY, len);
          itemFromBlock(id, { date: S.day, start, dur: len });
          return;
        }
      }
      // 整组一起挪：按整组的边界夹在纸里，保持相对位置不变
      const dx = (ev.clientX - e.clientX) / scale, dy = (ev.clientY - e.clientY) / scale;
      const minX = Math.min(...group.map(g => g.b.x)), maxX = Math.max(...group.map(g => g.b.x));
      const minY = Math.min(...group.map(g => g.b.y));
      const cx = Math.max(-minX, Math.min(PAPER_W - 40 - maxX, dx));
      const cy = Math.max(20 - minY, dy);
      commit(() => { for (const g of group) { g.b.x = Math.round(g.b.x + cx); g.b.y = Math.round(g.b.y + cy); } });
      if (!together) sel = id;
    },
  });
}

function hmAt(y: number, len: number) {
  const m = timeAt(y, len);
  return `${relDay(S.day)} ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function ruleDown(e: PointerEvent, id: string) {
  const r = paper().rules.find(x => x.id === id)!;
  const el = $(`#paper-stage [data-rid="${id}"]`)!;
  track(e, {
    onMove(_ev, _dx, dy) { el.style.top = r.y + dy / scale + 'px'; },
    onEnd(_ev, moved) {
      if (moved) commit(() => (r.y = Math.round(Math.max(30, Math.min(paperH - 10, parseFloat(el.style.top))))));
    },
  });
}

function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('a.url')) return;
  const box = t.closest('.box');
  const link = t.closest('.linked') as HTMLElement | null;
  const doc = t.closest('.doc-mark') as HTMLElement | null;
  if (doc?.dataset.audio) {
    fs.openPath(doc.dataset.audio).then(ok => ok || toast(L('找不到这段录音：', "Can't find this recording: ") + doc.dataset.audio));
  } else if (doc) {
    const b = blockById((doc.closest('.blk') as HTMLElement).dataset.bid!);
    openDoc(doc.dataset.doc!, b?.text.split('\n')[0]);
  } else if (box) {
    const b = blockById((box.closest('.blk') as HTMLElement).dataset.bid!);
    if (b) toggle(b, 'done');
  } else if (link) {
    focusItem(link.dataset.link!);
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (S.editing) return;
  const t = e.target as HTMLElement;
  const bEl = t.closest('.blk') as HTMLElement | null;
  const rEl = t.closest('.rule') as HTMLElement | null;
  const p = paper();
  const aEl = t.closest('[data-aid]');
  if (aEl) {
    const a = p.arrows.find(x => x.id === aEl.getAttribute('data-aid'));
    if (!a) return;
    selArrow = a.id;
    render();
    showMenu(e.clientX, e.clientY, [
      { label: L('换个方向', 'Flip direction'), action: () => commit(() => { [a.from, a.to] = [a.to, a.from]; a.by = 'me'; }) },
      { label: L('删掉这根箭头', 'Delete arrow'), hint: '⌫', danger: true, action: () => removeArrow(a.id) },
    ]);
    return;
  }
  if (rEl) {
    showMenu(e.clientX, e.clientY, [{ label: L('去掉这条横线', 'Remove this line'), danger: true, action: () => commit(() => (p.rules = p.rules.filter(r => r.id !== rEl.dataset.rid))) }]);
    return;
  }
  if (!bEl) {
    const pt = toPaper(e);
    showMenu(e.clientX, e.clientY, [
      { label: L('在这里写一个念头', 'Write a thought here'), action: () => createAt(pt.x, pt.y) },
      { label: L('在这里画一条横线', 'Draw a line here'), action: () => commit(() => p.rules.push({ id: uid('r'), y: Math.round(pt.y), x1: MARGIN - 8, x2: PAPER_W - MARGIN + 8 })) },
      '-',
      { label: L('新的一张纸', 'New paper'), hint: '⌘⇧N', action: newPaper },
    ]);
    return;
  }
  const b = blockById(bEl.dataset.bid!)!;
  sel = b.id;
  render();
  const entries: MenuEntry[] = [
    ...(b.doc ? [{ label: L('打开笔记', 'Open note'), action: () => openDoc(b.doc!, b.text.split('\n')[0]) }] : []),
    ...(b.audio ? [{ label: L('听录音', 'Play recording'), action: () => fs.openPath(b.audio!) }, { label: L('在访达里看录音', 'Show recording in Finder'), action: () => fs.reveal(b.audio!) }] : []),
    { label: L('改字', 'Edit'), hint: '↩', action: () => startEdit(b.id) },
    ...(b.kind === 'item' ? [{ label: b.done ? L('取消打勾', 'Untick') : L('打勾', 'Tick'), hint: L('空格', 'Space'), action: () => toggle(b, 'done') }] : []),
    ...(b.kind === 'item' ? [{ label: b.errand ? L('顺手的事，改…', 'Errand, change…') : b.estimate ? L(`预计 ${dur(b.estimate)}，改…`, `About ${dur(b.estimate)}, change…`) : L('预计多久…', 'Estimate…'), action: () => estMenu(b, bEl) }] : []),
    { label: L('圈起来', 'Circle'), hint: 'O', checked: !!b.circled, action: () => toggle(b, 'circled') },
    { label: L('拉箭头…', 'Arrow…'), hint: 'A', action: () => startArrow(b.id) },
    { label: b.num ? L(`编号换成 ${NUMS[(b.num % 9) + 1]}`, `Renumber to ${NUMS[(b.num % 9) + 1]}`) : L('打编号 ①', 'Number ①'), hint: '1–9', action: () => setNum(b, ((b.num ?? 0) % 9) + 1) },
    ...(b.num ? [{ label: L('去掉编号', 'Remove number'), hint: '0', action: () => setNum(b, 0) }] : []),
    { label: L('划掉（决定不做）', 'Strike out (not doing)'), hint: 'X', checked: !!b.struck, action: () => toggle(b, 'struck') },
    '-',
    { label: b.kind === 'heading' ? L('变回条目', 'Back to item') : L('变成小标题', 'Make heading'), action: () => toggleKind(b) },
    { label: L('你确认过（AI 不改）', 'Confirmed (AI leaves it alone)'), checked: !!b.confirmed, action: () => commit(() => (b.confirmed = !b.confirmed)) },
    ...(b.kind === 'item' ? [{ label: L('丢到池塘里', 'To the pond'), action: () => itemFromBlock(b.id) }] : []),
    ...p.arrows.filter(a => a.from === b.id || a.to === b.id).map(a => {
      const other = blockById(a.from === b.id ? a.to : a.from);
      return { label: `${L('删掉箭头：', 'Delete arrow: ')}${a.from === b.id ? '→' : '←'} ${(other?.text ?? '').split('\n')[0].slice(0, 14)}`, action: () => removeArrow(a.id) };
    }),
    '-',
    { label: L('删掉', 'Delete'), hint: '⌫', danger: true, action: () => removeBlock(b.id) },
  ];
  showMenu(e.clientX, e.clientY, entries);
}

/** 纸上选中一块时的键盘操作；返回 true 表示处理了 */
export function paperKey(e: KeyboardEvent): boolean {
  if (S.editing) return false;
  if (selArrow && (e.key === 'Backspace' || e.key === 'Delete')) { removeArrow(selArrow); return true; }
  if (e.key === 'Escape' && (arrowFrom || sel || selArrow || multi.size)) { arrowFrom = null; sel = null; selArrow = null; multi.clear(); render(); return true; }
  if (!sel || e.metaKey || e.ctrlKey) return false;
  const b = blockById(sel);
  if (!b) return false;
  const k = e.key.toLowerCase();
  const nudge = e.shiftKey ? 20 : 4;
  if (e.key === 'Enter') startEdit(b.id);
  else if (e.key === ' ') b.kind === 'item' && toggle(b, 'done');
  else if (k === 'o') toggle(b, 'circled');
  else if (k === 'x') toggle(b, 'struck');
  else if (k === 'a') startArrow(b.id);
  else if (/^[0-9]$/.test(e.key)) setNum(b, +e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete') removeBlock(b.id);
  else if (e.key === 'ArrowLeft') commit(() => (b.x = Math.max(0, b.x - nudge)));
  else if (e.key === 'ArrowRight') commit(() => (b.x += nudge));
  else if (e.key === 'ArrowUp') commit(() => (b.y = Math.max(20, b.y - nudge)));
  else if (e.key === 'ArrowDown') commit(() => (b.y += nudge));
  else return false;
  return true;
}

// ───────── 纸夹 / 版本 ─────────

export function switchPaper(id: string) {
  S.cur = id;
  sel = null;
  arrowFrom = null;
  saveUI();
  render();
}

export function newPaper() {
  let p!: Paper;
  commit(() => { p = newPaperState(); });
  switchPaper(p.id);
  toast(L('新开了一张纸，旧纸收进纸夹了', 'New paper. The old one is in the folder'));
}

/** 从行动回到它原来的念头 */
export function focusBlock(paperId: string, blockId: string) {
  if (!S.papers.has(paperId)) { toast(L('那张纸找不到了', "Can't find that paper")); return; }
  if (S.ui.collapsed.paper) { S.ui.collapsed.paper = false; saveUI(); }
  S.cur = paperId;
  sel = blockId;
  flashId = blockId;
  saveUI();
  render();
}

async function openVersions(anchor: Element) {
  const p = paper();
  const names = await listVersions(p.id);
  const fmt = (n: string) => {
    const m = n.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}-(.*)\.json$/);
    return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]} · ${m[6]}` : n;
  };
  menuBelow(anchor, [
    { label: L('现在存一版', 'Save a version now'), hint: '⌘S', action: () => saveVersionNow() },
    '-',
    ...(names.length ? names.slice(0, 30).map(n => ({
      label: fmt(n), action: () => {
        if (confirm(L(`回到「${fmt(n)}」这一版？\n现在的样子会先存一版，随时能回来。`, `Go back to "${fmt(n)}"?\nThe current state is saved first, so you can come back.`))) restoreVersion(`ideas/.versions/${p.id}/${n}`);
      },
    })) : [{ label: L('还没有存过版本', 'No versions yet'), action: () => {} }]),
  ]);
}

export async function saveVersionNow() {
  await saveVersion(S.cur, L('手动存', 'manual'));
  toast(L('这张纸存了一版', 'Version saved'));
}

// ───────── 浮在纸边上：拾拾的小纸条、闻闻找来的材料 ─────────

let cardsOpen = true;

/** 都浮在纸的右边上，不占纸的位置。看完叉掉；有用的一下「丢到池塘里」，不用自己抄 */
function renderSide() {
  const bar = $('#paper-slips')!;
  const p = paper();
  const slips = p.slips.filter(s => (s.status ?? 'open') === 'open');
  if (!slips.length && !p.side.length) { bar.replaceChildren(); bar.hidden = true; return; }
  bar.hidden = false;
  const who = (a: Block['by']) => (a && a !== 'me' ? `${ANIMALS[a].emoji} ${animalName(a)}` : L('你', 'You'));
  const x = (onclick: () => void) => h('button', { type: 'button', class: 'slip-x', title: L('叉掉', 'Dismiss'), 'aria-label': L('叉掉', 'Dismiss'), onclick }, '×');
  bar.replaceChildren(
    ...slips.map(s => h('div', { class: 'slip' },
      x(() => commit(() => (s.status = 'declined'))),
      h('div', { class: 'slip-by' }, L(`${who(s.by)} 递来一张小纸条`, `A note from ${who(s.by)}`)),
      h('div', { class: 'slip-text' }, s.text),
      s.proposal ? h('div', { class: 'slip-prop' }, `${L('建议：', 'Suggests: ')}${s.proposal.title}`) : null,
      s.proposal ? h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'pill', onclick: () => slipToList(s.id) }, L('＋ 丢到池塘里', '＋ To the pond'))) : null,
    )),
    ...(p.side.length ? [h('button', { type: 'button', class: 'side-title', onclick: () => { cardsOpen = !cardsOpen; renderSide(); } },
      `${ANIMALS.闻闻.emoji} ${L(`闻闻找来的 ${p.side.length} 条`, `${p.side.length} from Fetch`)} · ${cardsOpen ? L('收起', 'Hide') : L('展开', 'Show')}`)] : []),
    ...(cardsOpen ? p.side : []).map(c => h('div', { class: 'card' },
      x(() => commit(() => (p.side = p.side.filter(y => y.id !== c.id)))),
      h('div', { class: 'card-text' }, c.text),
      c.url ? h('a', { class: 'card-url', href: c.url, target: '_blank', rel: 'noopener' }, c.url.replace(/^https?:\/\//, '').slice(0, 48)) : null,
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'pill', onclick: () => cardToList(c.id) }, L('＋ 丢到池塘里', '＋ To the pond')),
        h('button', { type: 'button', class: 'text-btn', onclick: () => adoptCard(c.id) }, L('放到纸上', 'Put on paper'))),
    )),
  );
}

/** 小纸条里的建议进 backup 清单 */
function slipToList(id: string) {
  const s = paper().slips.find(x => x.id === id);
  if (!s?.proposal) return;
  const prop = s.proposal;
  commit(() => {
    s.status = 'accepted';
    S.backup.items.push(newItem(prop.title, { ...prop, by: s.by }));
  });
  log(L(`从${s.by}的小纸条丢到池塘里「${prop.title}」`, `"${prop.title}" from ${animalName(s.by!)}'s note went to the pond`));
  toast(L(`「${prop.title}」丢到池塘里了`, `"${prop.title}" is in the pond`));
}

/** 闻闻的一条材料进 backup 清单：冒号前当标题，后面和链接当备注 */
function cardToList(id: string) {
  const p = paper();
  const c = p.side.find(x => x.id === id);
  if (!c) return;
  const m = c.text.match(/^(.{1,30}?)[：:]\s*(.+)$/s);
  const title = m ? `${L('看', 'Read')} ${m[1].trim()}` : c.text;
  const note = [m?.[2].trim(), c.url].filter(Boolean).join('\n') || undefined;
  commit(() => {
    p.side = p.side.filter(y => y.id !== id);
    S.backup.items.push(newItem(title, { note, by: '闻闻' }));
  });
  log(L(`把闻闻找来的「${title}」丢到池塘里`, `Fetch's "${title}" went to the pond`));
  toast(L(`「${title}」丢到池塘里了`, `"${title}" is in the pond`));
}

function adoptCard(id: string) {
  const p = paper();
  const c = p.side.find(x => x.id === id);
  if (!c) return;
  const { x, y } = freeSpot();
  commit(() => {
    p.side = p.side.filter(s => s.id !== id);
    // 闻闻的建议是要你去做的：放成行动项（有方框、黑字），说明和链接是下面的小字
    const m = c.text.match(/^(.{1,30}?)[：:]\s*(.+)$/s);
    const text = [m ? `${L('看', 'Read')} ${m[1].trim()}` : c.text, m?.[2].trim(), c.url].filter(Boolean).join('\n');
    p.blocks.push({ id: uid('b'), kind: 'item', x, y, w: 330, text, by: '闻闻', created: isoNow() });
  });
  toast(L('采用了，放在纸上', 'Adopted onto the paper'));
}

// ───────── 初始化 ─────────

export function initPaper() {
  const stage = $('#paper-stage')!;
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('click', onClick);
  stage.addEventListener('contextmenu', onContextMenu);
  $('#paper-scroll')!.addEventListener('scroll', () => { $('#blk-tools')?.remove(); closeMenu(); });

  const input = $('#paper-input') as HTMLInputElement;
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const text = input.value.trim();
    if (!text) return;
    addThought(text);
    input.value = '';
  });
  input.addEventListener('focus', () => (S.editing = false));

  new ResizeObserver(() => { if (!S.editing && Math.abs(computeScale() - scale) > 0.005) render(); }).observe($('#paper-scroll')!);
}

