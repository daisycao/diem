// 日报：Claude Code 写在 review/YYYY-MM-DD.html（bin/review.mjs 生成，带图），老的只有 .md。
// 工具栏「日报」直接打开最新一篇，铺满窗口看；「‹ 前一天 / 后一天 ›」翻着看。
// 新写好一篇、还没看过，按钮上亮一个小点。
import { L } from './i18n';
import { fs } from './bridge';
import { openDoc } from './doc';
import { S, patternWatch } from './store';
import { $, fill, h, relDay, shortDay, toast, ymd } from './util';

const SEEN = 'diem.review.seen';
let days: string[] = [];              // 旧 → 新
let hasHTML = new Set<string>();
let showing: string | null = null;    // 正在看的那天（HTML 的）

export async function loadReviews(): Promise<string[]> {
  const list = await fs.list('review').catch(() => []);
  const all = new Set<string>();
  hasHTML = new Set();
  for (const e of list) {
    const m = e.name.match(/^(\d{4}-\d{2}-\d{2})\.(md|html)$/);
    if (!m) continue;
    all.add(m[1]);
    if (m[2] === 'html') hasHTML.add(m[1]);
  }
  days = [...all].sort();
  return days;
}

function seen(): string { try { return localStorage.getItem(SEEN) ?? ''; } catch { return ''; } }
function markSeen(day: string) {
  try { if (day > seen()) localStorage.setItem(SEEN, day); } catch { /* 看不了也不要紧 */ }
}

function kicker(day: string) {
  const r = relDay(day, ymd());
  return `${L('日报', 'Review')} · ${shortDay(day)}${r !== shortDay(day) ? ` · ${r}` : ''}`;
}

export function closeReview() {
  showing = null; S.editing = false;
  $('#review-view')?.remove();
}
export const reviewOpen = () => showing != null;

async function showHTML(d: string) {
  const r = await fs.read(`review/${d}.html`).catch(() => null);
  if (!r) { toast(L(`找不到日报：review/${d}.html`, `Can't find review/${d}.html`)); return; }
  const i = days.indexOf(d);
  showing = d;
  let wrap = $('#review-view');
  if (!wrap) {
    wrap = h('div', { id: 'review-view', class: 'review-wrap', onclick: (e: Event) => e.target === wrap && closeReview() });
    document.body.append(wrap);
  }
  const frame = h('iframe', { class: 'review-frame', title: `${L('日报', 'Review')} ${d}`, sandbox: 'allow-same-origin' }) as HTMLIFrameElement;
  frame.srcdoc = r.text;
  fill(wrap, h('div', { class: 'review-box', role: 'dialog', 'aria-label': `${L('日报', 'Review')} ${d}` },
    h('header', { class: 'doc-head' },
      h('div', null, h('div', { class: 'doc-kicker' }, kicker(d)), h('div', { class: 'doc-title' }, L('每日复盘', 'Daily review'))),
      h('div', { class: 'doc-btns' },
        h('button', { class: 'pill', type: 'button', disabled: i <= 0, onclick: () => openReview(days[i - 1]) }, L('‹ 前一天', '‹ Previous')),
        h('button', { class: 'pill', type: 'button', disabled: i >= days.length - 1, onclick: () => openReview(days[i + 1]) }, L('后一天 ›', 'Next ›')),
        h('button', { class: 'pill', type: 'button', title: L('在浏览器里打开', 'Open in browser'), onclick: () => fs.openPath(`review/${d}.html`) }, L('在浏览器打开', 'Open in browser')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': L('关掉', 'Close'), onclick: closeReview }, '✕'))),
    frame));
}

export async function openReview(day?: string) {
  await loadReviews();
  if (!days.length) { toast(L('还没有日报。在 Claude Code 里说「写今天的日报」，妥妥就会写一篇', 'No reviews yet. Say "Write my daily review" in Claude Code and Toto will write one')); return; }
  const d = day && days.includes(day) ? day : days[days.length - 1];
  const i = days.indexOf(d);
  if (hasHTML.has(d)) await showHTML(d);
  else {
    closeReview();
    await openDoc(`review/${d}.md`, '', {
      kicker: kicker(d),
      prev: i > 0 ? () => openReview(days[i - 1]) : undefined,
      next: i < days.length - 1 ? () => openReview(days[i + 1]) : undefined,
    });
  }
  markSeen(d);
  renderReviewBtn();
}

export function renderReviewBtn() {
  const btn = $('#review');
  if (!btn) return;
  const last = days[days.length - 1];
  fill(btn, L('日报', 'Review'), last && last > seen() ? h('span', { class: 'dot-red', title: L('有新日报', 'New review') }) : null);
  btn.title = last ? L(`最新一篇：${shortDay(last)}。在 Claude Code 里说「写今天的日报」`, `Latest: ${shortDay(last)}. Say "Write my daily review" in Claude Code`) : L('还没有日报。在 Claude Code 里说「写今天的日报」', 'No reviews yet. Say "Write my daily review" in Claude Code');
}

/** 文件变了（Claude Code 刚写好一篇）跟着刷新小点；正在看的那篇也重新载入 */
export function refreshReviews() { loadReviews().then(renderReviewBtn); }

export function initReview() {
  $('#review')!.addEventListener('click', () => openReview());
  patternWatch.push({ re: /^review\/[^/]+\.(md|html)$/, load: async path => {
    await loadReviews(); renderReviewBtn();
    if (showing && path === `review/${showing}.html`) showHTML(showing);
  } });
  refreshReviews();
}
