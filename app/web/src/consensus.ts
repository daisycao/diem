// 共识：AI 对你的理解集中在工作目录的「共识.md」里。
// 「定了的」AI 照着做；「推测」要你认可才算数；「不对的推测」AI 别再这样猜。
// app 只做两件事：告诉你有几条推测等你看，让你一下认可或否掉。整份文件随时能打开直接改。
import { IS_ZH, L } from './i18n';
import { fs } from './bridge';
import { openDoc } from './doc';
import { extraWatch, render, S } from './store';
import { $, fill, h, toast } from './util';

const FILE = 'consensus.md';
// 三节的标题：中文英文都认，新写的按界面语言
const H = {
  guess: ['## 推测（等你认可）', '## Guesses (waiting for your OK)'],
  agreed: ['## 定了的', '## Agreed'],
  wrong: ['## 不对的推测（别再这样猜）', "## Wrong guesses (don't guess this again)"],
};
const GUESS = IS_ZH ? H.guess[0] : H.guess[1];
const AGREED = IS_ZH ? H.agreed[0] : H.agreed[1];
const WRONG = IS_ZH ? H.wrong[0] : H.wrong[1];
const both = (title: string) => Object.values(H).find(x => x.includes(title)) ?? [title];

let text = '';
let open = false;

async function load() {
  const r = await fs.read(FILE);
  text = r?.text ?? '';
  S.mtimes[FILE] = r?.mtime ?? 0;
}

/** 某一节里以「- 」开头的行 */
function section(title: string): { start: number; end: number; items: { line: number; text: string }[] } | null {
  const lines = text.split('\n');
  const start = lines.findIndex(l => both(title).includes(l.trim()));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  const items = [];
  for (let i = start + 1; i < end; i++) if (lines[i].startsWith('- ')) items.push({ line: i, text: lines[i].slice(2) });
  return { start, end, items };
}

export const guesses = () => section(GUESS)?.items ?? [];

/** 把推测挪到别的节：认可 → 定了的；不对 → 不对的推测 */
async function move(lineNo: number, to: string, done: string) {
  const r = await fs.read(FILE);
  if (!r) return;
  if (r.text !== text) { text = r.text; toast(L('共识刚在别处改过，重新读了一遍，再点一次', 'Changed elsewhere; reloaded. Click again')); render(); return; }
  const lines = text.split('\n');
  const [line] = lines.splice(lineNo, 1);
  let at = lines.findIndex(l => both(to).includes(l.trim()));
  if (at < 0) { lines.push('', to); at = lines.length - 1; }
  let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  if (end < 0) end = lines.length;
  while (end > at + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, line);
  const next = lines.join('\n');
  const w = await fs.write(FILE, next, r.mtime);
  if (w.conflict) { toast(L('共识刚在别处改过，没存上', 'Changed elsewhere; not saved')); return; }
  text = next; S.mtimes[FILE] = w.mtime;
  toast(done);
  render();
}

/** 还有几条 AI 的推测等她看（收在「我的」里） */
export function consensusStatus(): number {
  if (open) renderPanel();
  return guesses().length;
}

function renderPanel() {
  let panel = $('#consensus-panel');
  if (!panel) {
    panel = h('aside', { id: 'consensus-panel', class: 'side-panel', 'aria-label': L('共识', 'Shared understanding') });
    document.body.append(panel);
  }
  const list = guesses();
  fill(panel,
    h('div', { class: 'sp-head' },
      h('b', null, L('我们的共识', 'What we agree on')),
      h('span', { class: 'grow' }),
      h('button', { class: 'text-btn', type: 'button', onclick: () => { toggleConsensus(false); openDoc(FILE, L('我们的共识', 'What we agree on')); } }, L('打开整份', 'Open all')),
      h('button', { class: 'icon-btn', type: 'button', title: L('关上', 'Close'), onclick: () => toggleConsensus(false) }, '×')),
    h('p', { class: 'sp-note' }, L('AI 只照「定了的」做。它对你的推测先放在这里，你认可了才算数；否掉的它不会再这样猜。', 'The AI only acts on what is agreed. Its guesses about you wait here for your OK; ones you reject, it will not guess again.')),
    list.length ? h('ul', { class: 'cs-list' }, ...list.map(g => h('li', null,
      h('div', { class: 'cs-text' }, g.text),
      h('div', { class: 'row-btns' },
        h('button', { class: 'pill primary', type: 'button', onclick: () => move(g.line, AGREED, L('认可了，写进「定了的」', 'Agreed')) }, L('认可', 'Agree')),
        h('button', { class: 'pill', type: 'button', onclick: () => move(g.line, WRONG, L('否掉了，AI 不会再这样猜', 'Rejected; the AI will not guess this again')) }, L('不对', 'Wrong')))))) :
      h('p', { class: 'sp-empty' }, L('没有等你看的推测。', 'No guesses waiting.')),
  );
}

export function toggleConsensus(force?: boolean) {
  open = force ?? !open;
  if (open) document.getElementById('shelf-panel')?.remove();
  if (open) renderPanel(); else $('#consensus-panel')?.remove();
}

export async function initConsensus() {
  await load();
  extraWatch[FILE] = load;
}
