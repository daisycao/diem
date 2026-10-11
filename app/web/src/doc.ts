// 笔记：纸上的块可以挂一篇 Markdown（notes/*.md），双击弹出来看，也能直接改。
// 笔记就是普通的 .md 文件，以后换成 Obsidian 这类笔记库也能直接打开。
import { L } from './i18n';
import { fs } from './bridge';
import { commit, flush, log, S } from './store';
import { $, fill, h, toast } from './util';

let path: string | null = null;
let mtime = 0;
let text = '';
let editing = false;
/** 日报这类一篇接一篇的，标题旁边带「‹ 前一天 / 后一天 ›」 */
export interface DocNav { kicker?: string; prev?: () => void; next?: () => void }
let nav: DocNav | null = null;

export const docOpen = () => path != null;

export async function openDoc(p: string, title = '', n: DocNav | null = null) {
  if (editing && path && path !== p) save();
  const r = await fs.read(p).catch(() => null);
  if (!r) { toast(L(`找不到笔记：${p}`, `Can't find the note: ${p}`)); return; }
  path = p; mtime = r.mtime; text = r.text; editing = false; nav = n;
  render(title);
}

export function closeDoc() {
  if (editing && !save()) return;
  path = null; editing = false; nav = null; S.editing = false;
  $('#doc')?.remove();
}

/** 删掉一篇笔记：.md 和同名的图文件夹挪进系统废纸篓（倒掉之前还能捡回来），纸上挂着它的块留着、只是不再挂 */
export async function trashNote(p: string): Promise<boolean> {
  const name = p.split('/').pop()!.replace(/\.md$/, '');
  const on = [...S.papers.values()].flatMap(pp => pp.blocks.filter(b => b.doc === p));
  const where = on.length ? L(`\n纸上挂着它的 ${on.length} 块留着，只是不再挂笔记。`, `\nThe ${on.length} blocks it hangs on stay, without the note.`) : '';
  if (!confirm(L(`删掉笔记「${name}」？\n笔记和它的图挪进系统的废纸篓，倒废纸篓之前还能捡回来。${where}`, `Delete the note "${name}"?\nIt and its images go to the Trash, so you can get them back until you empty it.${where}`))) return false;
  try { await fs.trash(p); } catch { toast(L('没删掉，再试一次', "Couldn't delete it. Try again")); return false; }
  await fs.trash(p.replace(/\.md$/, '')).catch(() => false);   // notes/<名字>/ 里的图，没有就算了
  delete S.mtimes[p];
  if (on.length) { commit(() => { for (const b of on) delete b.doc; }); await flush(); }
  if (path === p) { editing = false; closeDoc(); }
  log(L(`删掉了笔记「${name}」`, `Deleted the note "${name}"`));
  toast(L('笔记删掉了，在系统废纸篓里', 'Note deleted. It is in the Trash'));
  return true;
}

function save(): boolean {
  const ta = $('#doc textarea') as HTMLTextAreaElement | null;
  if (!ta || ta.value === text || !path) return true;
  const p = path, v = ta.value;
  fs.write(p, v, mtime).then(r => {
    if (r.conflict) toast(L('这篇笔记在别处被改过了，没存上；关掉重开再改', 'This note changed elsewhere and was not saved. Close and reopen it'));
    else { mtime = r.mtime; S.mtimes[p] = r.mtime; toast(L('笔记存好了', 'Note saved')); }
  });
  text = v;
  return true;
}

function render(title: string) {
  let wrap = $('#doc');
  if (!wrap) {
    wrap = h('div', { id: 'doc', class: 'doc-wrap', onclick: (e: Event) => e.target === wrap && closeDoc() });
    document.body.append(wrap);
  }
  const name = path!.split('/').pop()!.replace(/\.md$/, '');
  const body = editing
    ? h('textarea', { class: 'doc-edit', spellcheck: 'false' }) as HTMLTextAreaElement
    : h('div', { class: 'doc-body' }, ...md(text));
  if (body instanceof HTMLTextAreaElement) { body.value = text; S.editing = true; } else S.editing = false;
  fill(wrap, h('div', { class: 'doc', role: 'dialog', 'aria-label': name },
    h('header', { class: 'doc-head' },
      h('div', null, h('div', { class: 'doc-kicker' }, nav?.kicker ?? (title && title !== name ? title : L('笔记', 'Note'))), h('div', { class: 'doc-title' }, name)),
      h('div', { class: 'doc-btns' },
        nav && !editing ? h('button', { class: 'pill', type: 'button', disabled: !nav.prev, onclick: () => nav?.prev?.() }, L('‹ 前一天', '‹ Previous')) : null,
        nav && !editing ? h('button', { class: 'pill', type: 'button', disabled: !nav.next, onclick: () => nav?.next?.() }, L('后一天 ›', 'Next ›')) : null,
        h('button', { class: 'pill', type: 'button', onclick: () => { if (editing) save(); editing = !editing; render(title); } }, editing ? L('看', 'View') : L('改', 'Edit')),
        h('button', { class: 'pill', type: 'button', title: L('用默认的 Markdown 编辑器打开；装了知新 Anew 就在 Anew 里打开', 'Opens in your Markdown editor, or in Anew if installed'), onclick: () => fs.openPath(path!) }, L('在编辑器里打开', 'Open in editor')),
        !nav && !editing && path!.startsWith('notes/') ? h('button', { class: 'pill danger', type: 'button', title: L('挪进系统废纸篓', 'Move to Trash'), onclick: () => trashNote(path!) }, L('删掉…', 'Delete…')) : null,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': L('关掉', 'Close'), onclick: closeDoc }, '✕'))),
    body));
  if (body instanceof HTMLTextAreaElement) { body.focus(); body.setSelectionRange(0, 0); body.scrollTop = 0; }
}

// ───────── 小型 Markdown ─────────
// 只认常用的：# 标题、- / 1. 列表、> 引用、--- 分隔、**粗**、*斜*、`代码`、[链接](url)、裸网址、
// 单独一行的图 ![说明](相对这篇笔记的路径)。

function md(src: string): Node[] {
  const out: Node[] = [];
  let list: HTMLElement | null = null;
  let table: HTMLElement | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) out.push(h('p', null, ...inline(para.join('\n')))); para = []; };
  const flush = () => { flushPara(); list = null; table = null; };
  // 开头的 YAML 属性（--- 包起来那段）是给 Anew / Obsidian / AI 看的，这里不显示
  src = src.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(h(`h${Math.min(m[1].length + 1, 6)}` as 'h2', null, ...inline(m[2]))); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); out.push(h('hr')); continue; }
    if ((m = line.match(/^!\[([^\]]*)\]\(<?([^)>]+)>?\)$/))) { flush(); out.push(img(m[2].trim(), m[1])); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); list = null;
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // |---|---| 分隔行
      const head = !table;
      if (!table) { table = h('table'); out.push(table); }
      table.append(h('tr', null, ...cells.map(c => h(head ? 'th' : 'td', null, ...inline(c)))));
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(h('blockquote', null, ...inline(m[1]))); continue; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol || ul) {
      flushPara();
      const tag = ol ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag, ol ? { start: ol[1] } : null);
        out.push(list);
      }
      const t = ol ? ol[2] : ul![1];
      const task = t.match(/^\[([ xX])\]\s+(.*)$/);
      list.append(task
        ? h('li', { class: 'task' }, h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }), ' ', ...inline(task[2]))
        : h('li', null, ...inline(t)));
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) { list.lastElementChild?.append(h('br'), ...inline(line.trim())); continue; }
    list = null; table = null;
    para.push(line);
  }
  flush();
  return out;
}

function inline(s: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|\n/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index)));
    if (m[1]) out.push(h('strong', null, ...inline(m[1])));
    else if (m[2]) out.push(h('em', null, ...inline(m[2])));
    else if (m[3]) out.push(h('code', null, m[3]));
    else if (m[4]) out.push(link(m[5], m[4]));
    else if (m[6]) out.push(link(m[6], m[6].replace(/^https?:\/\//, '')));
    else out.push(h('br'));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}

/** 图：网上的直接显示；工作目录里的按这篇笔记所在的文件夹找，读成 data: 网址 */
function img(src: string, alt: string): HTMLElement {
  const el = h('img', { alt, title: alt }) as HTMLImageElement;
  if (/^https?:\/\//.test(src)) { el.src = src; return el; }
  const parts = (path ?? '').split('/').slice(0, -1);
  for (const seg of decodeURI(src).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  const file = parts.join('/');
  fs.data(file).then(d => {
    if (d) el.src = d;
    else el.replaceWith(h('div', { class: 'img-miss' }, L(`（找不到图：${file}）`, `(image not found: ${file})`)));
  }, () => el.replaceWith(h('div', { class: 'img-miss' }, L(`（图没读出来：${file}）`, `(couldn't read image: ${file})`))));
  return el;
}

function link(url: string, label: string) {
  return h('a', { href: url, onclick: (e: Event) => { e.preventDefault(); fs.openURL(url); } }, label);
}
