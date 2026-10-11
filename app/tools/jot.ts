// 记下来：Claude Code / Codex 往 Diem 里写东西的可靠入口。
// jot: the reliable way for Claude Code / Codex to write into Diem.
//   node bin/jot.mjs "a thought"                  → onto free space on the current paper
//   node bin/jot.mjs --list "a task" --est 40     → into the pond (lists/backup.json)
//   A trailing "2H" / "30min" on the first line is read as the estimate, same as in the app.
// Options: --by Pip|Toto|Zaza|Fetch|me (default Pip)  --paper <paper id>  --est <min>  --due YYYY-MM-DD  --wish YYYY-MM-DD  --where <place>
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Actor, Backup, Block, Item, Paper } from '../web/src/types';
import { freeSpot } from '../web/src/types';
import { parseEst } from '../web/src/util';
import { syncLog } from './synclog';
import { L } from '../web/src/i18n';

const ws = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name: string) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

const toList = flag('list');
const by = (opt('by') ?? 'Pip') as Actor;
const paperOpt = opt('paper');
const est = opt('est');
const due = opt('due');
const wish = opt('wish');
const where = opt('where');
let text = args.join(' ').replace(/\\n/g, '\n').trim();

if (!text) {
  console.error(L('用法：node bin/jot.mjs [--list] [--by Pip] "要记的话"', 'Usage: node bin/jot.mjs [--list] [--by Pip] "what to jot"'));
  process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, '0');
const d = new Date();
const off = -d.getTimezoneOffset();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const iso = `${today}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
const uid = (p: string) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function readJSON<T>(rel: string): T | null {
  const p = join(ws, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
function writeJSON(rel: string, obj: unknown) {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, p);
}
function inbox(line: string) {
  const p = join(ws, 'inbox.md');
  if (!existsSync(p)) writeFileSync(p, '# inbox\n\n');
  appendFileSync(p, `- ${today} ${pad(d.getHours())}:${pad(d.getMinutes())} ${line}\n`);
}

// 第一行末尾写「2H」「30min」就是预计时长（--est 优先）
const parsed = parseEst(text);
const estimate = est ? Number(est) : parsed.est;
const errand = parsed.errand;
text = parsed.text;

if (toList) {
  const b = readJSON<Backup>('lists/backup.json') ?? { items: [] };
  const [title, ...rest] = text.split('\n');
  const it: Item = {
    id: uid('it'), title, type: 'action', by, created: iso, updated: iso,
    note: rest.join('\n') || undefined,
    estimate, due, wish, where, ...(errand ? { errand } : {}),
  };
  b.items.push(it);
  writeJSON('lists/backup.json', b);
  inbox(`${title}${L('（→ 池塘）', ' (→ pond)')}`);
  syncLog(ws, { tool: 'jot', files: ['lists/backup.json', 'inbox.md'], cmd: title.slice(0, 80) });
  console.log(`${L('进了池塘：', 'In the pond: ')}${title}  (${it.id})`);
} else {
  const ui = readJSON<{ cur?: string }>('.diem/ui.json');
  const ids = readdirSync(join(ws, 'ideas')).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5));
  // 扔进纸箱的纸不往上记
  const papers = ids.map(id => readJSON<Paper>(`ideas/${id}.json`)!).filter(p => p && !p.archived)
    .sort((a, b) => (a.created + a.id < b.created + b.id ? -1 : 1));
  const id = paperOpt ?? (ui?.cur && papers.some(p => p.id === ui.cur) ? ui.cur : papers.at(-1)?.id);
  if (!id) { console.error(L('还没有纸，先打开一次 app', 'No paper yet. Open the Diem app once first')); process.exit(1); }
  const p = readJSON<Paper>(`ideas/${id}.json`)!;
  p.blocks ??= [];

  const { w, ...spot } = freeSpot(p.blocks);
  const block: Block = { id: uid('b'), kind: 'item', ...spot, w, text, by, created: iso, ...(estimate ? { estimate } : {}), ...(errand ? { errand } : {}) };
  p.blocks.push(block);
  writeJSON(`ideas/${id}.json`, p);
  inbox(`${text.split('\n')[0]}${L(`（→ 纸 ${id}）`, ` (→ paper ${id})`)}`);
  syncLog(ws, { tool: 'jot', files: [`ideas/${id}.json`, 'inbox.md'], cmd: text.split('\n')[0].slice(0, 80) });
  console.log(`${L('记在纸上了：', 'On the paper: ')}${p.title}  (${block.id})`);
}
