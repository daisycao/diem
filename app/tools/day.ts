// 一天的素材：纸、池塘、时间轴、日志、memo、这天拍的纸，收成一份 Markdown，给妥妥写日报用。
// The day's material: paper, pond, timeline, log, memos and photos of the paper, as Markdown for Toto's daily review.
// 用法 / usage: node bin/day.mjs [YYYY-MM-DD]   （默认今天；只在同步本里记一行 / defaults to today; read-only）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whatOf } from '../web/src/sites';
import { syncLog } from './synclog';

const ws = join(dirname(fileURLToPath(import.meta.url)), '..');
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 跟界面一样，凌晨 5 点前还算前一天 / like the app, the day turns at 5 am
const day = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? ymd(new Date(Date.now() - 5 * 3600_000));
const dayOf = (iso?: string) => iso ? ymd(new Date(Date.parse(iso) - 5 * 3600_000)) : '';
const hm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const dur = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? `${pad(m % 60)}′` : ''}` : `${m}′`; };
const readJSON = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const out: string[] = [`# Material for ${day}`, ''];

// ── 这天拍的纸 / photos of the paper ──
const stamp = day.replace(/-/g, '');
const photos = existsSync(join(ws, 'photos')) ? readdirSync(join(ws, 'photos')).filter(f => f.startsWith(stamp)).sort() : [];
out.push('## Photos of the paper', '');
out.push(...(photos.length ? photos.map((f, i) => `- photos/${f}${photos.length > 1 ? (i === 0 ? '  (morning)' : i === photos.length - 1 ? '  (evening)' : '') : ''}`) : ['(none taken this day)']), '');

// ── 纸 / papers ──
const papers: any[] = existsSync(join(ws, 'ideas')) ? readdirSync(join(ws, 'ideas')).filter(f => f.endsWith('.json')).map(f => readJSON(join(ws, 'ideas', f))).filter(Boolean) : [];
for (const p of papers.filter(p => !p.archived && (p.created === day || (p.blocks ?? []).some((b: any) => dayOf(b.doneAt) === day || dayOf(b.created) === day)))) {
  out.push(`## Paper: ${p.title ?? p.id}  (ideas/${p.id}.json)`, '');
  for (const b of p.blocks ?? []) {
    const first = String(b.text ?? '').split('\n')[0];
    const flags = [b.kind === 'heading' && 'heading', b.done && `ticked${b.doneAt ? ' ' + b.doneAt.slice(11, 16) : ''}`, b.struck && 'struck out', b.circled && 'circled', b.num && `#${b.num}`, b.estimate && `${b.estimate}min`, b.links?.length && 'in pond'].filter(Boolean);
    out.push(`- ${first}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  }
  out.push('');
}

// ── 池塘和时间轴 / pond and timeline ──
const items: any[] = readJSON(join(ws, 'lists/backup.json'))?.items ?? [];
const done = items.filter(i => i.done && (i.plan?.date ? i.plan.date === day : dayOf(i.doneAt) === day));
const pieces = items.flatMap(i => (i.pieces ?? []).filter((p: any) => p.date === day).map((p: any) => ({ i, p })));
const planned = items.filter(i => i.plan?.date === day && !i.done);
out.push('## Done (pond / timeline)', '');
out.push(...(done.length ? done.map(i => `- ${i.title}${i.plan ? `  (${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)})` : ''}${i.doneAt ? `  ticked ${i.doneAt.slice(11, 16)}` : ''}`) : ['(nothing ticked in the pond)']), '');
if (pieces.length) out.push('## Partly done (moved forward, rest later)', '', ...pieces.map(({ i, p }) => `- ${i.title}  (${hm(p.start)}–${hm(p.start + p.dur)}${i.left ? `, about ${Math.round(i.left * 100)}% left` : ''})`), '');
if (planned.length) out.push('## Planned but not ticked', '', ...planned.map(i => `- ${i.title}  (${hm(i.plan.start)}–${hm(i.plan.start + i.plan.dur)})`), '');
const next = ymd(new Date(new Date(day + 'T12:00:00').getTime() + 864e5));
const tomorrow = items.filter(i => !i.done && (i.plan?.date === next || i.wish === next || i.due === next));
if (tomorrow.length) out.push('## Tomorrow so far', '', ...tomorrow.map(i => `- ${i.title}${i.plan?.date === next ? `  (${hm(i.plan.start)})` : i.due === next ? '  (due)' : ''}`), '');

// ── 日志、memo / log and memos ──
const logPath = join(ws, `log/${day}.md`);
if (existsSync(logPath)) out.push('## Log', '', ...readFileSync(logPath, 'utf8').split('\n').filter(l => l.startsWith('- ')), '');
const memos = existsSync(join(ws, 'memo')) ? readdirSync(join(ws, 'memo')).filter(f => f.startsWith(stamp)) : [];
if (memos.length) {
  out.push('## What the crew did', '');
  for (const f of memos) { const m = readJSON(join(ws, 'memo', f)); if (m) out.push(`- ${m.time?.slice(11, 16) ?? ''} ${m.by}: ${m.title} (${m.status ?? ''})`); }
  out.push('');
}

// ── 电脑记录（实验功能）/ Mac activity (Labs) ──
const segs: { app: string; title?: string; url?: string; s: number; e: number }[] = readJSON(join(ws, `usage/${day}.json`))?.segments ?? [];
if (segs.length) {
  const byApp = new Map<string, number>();
  for (const g of segs) byApp.set(whatOf(g), (byApp.get(whatOf(g)) ?? 0) + g.e - g.s);
  out.push('## Mac activity', '', ...[...byApp].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a, t]) => `- ${a}: ${dur(t)}`), '');
}

out.push('---', 'Next: write review/' + day + '.json (see the rules in CLAUDE.md), then run: node bin/review.mjs ' + day);
console.log(out.join('\n'));
syncLog(ws, { tool: 'day', cmd: day });
