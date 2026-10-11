// 日报（HTML）：纸、池塘、时间轴上的一天，加上 Claude 写的话（review/日期.json），拼成 review/日期.html。
// Daily review: the paper, the pond and the timeline for one day, plus the words Claude wrote
// (review/<date>.json), rendered to review/<date>.html.
//
// 用法 / usage:  node bin/review.mjs [YYYY-MM-DD] [--lang en|zh]     （默认今天 / defaults to today）
// 数字和图脚本自己算；话由 Claude 写。没有 json 也能出一份只有图的。
// The script does the numbers and charts; Claude writes the words. Without a json you still get the charts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whatOf } from '../web/src/sites';
import { syncLog } from './synclog';

const ws = join(dirname(fileURLToPath(import.meta.url)), '..');
const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const argv = process.argv.slice(2);
const langArg = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : undefined;
const day = argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? ymdOf(new Date(Date.now() - 5 * 3600_000));
const readJSON = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return ymdOf(t); };

// ───────── Claude 写的话 / the words ─────────
type Cat = 'work' | 'learn' | 'people' | 'move' | 'home' | 'rest' | 'other';
interface Win {
  cat?: Cat; text?: string; cheer?: string;
  at?: string;      // 几点做的（「14:15」），有了就排成时间线 / time done; turns the list into a timeline
  amt?: string;     // 量（「3/10」「26 页」）/ an amount
  tag?: string;     // 现在的样子（打勾 / 读完）/ a status tag
  quote?: string;   // 纸上或笔记里的一句 / a line from the paper or a note
  aside?: string;   // 插在中间的一句，虚线显示 / an aside between wins
}
interface Words {
  lang?: 'zh' | 'en';
  title?: string; oneLine?: string;
  mood?: { words?: string[]; quote?: string };     // quote：纸上写的那句心情原话 / the mood line written on the paper
  paper?: { morning?: string; evening?: string; caption?: string };  // 纸的照片（photos/…），不写就自动找这天拍的 / paper photos; auto-found if omitted
  numbers?: { n: string; label: string; sub?: string; cat?: Cat }[];
  wins?: Win[]; winsNote?: string[];
  investNote?: string[];
  marks?: { s: string; e: string; text: string; cat?: Cat }[];   // 「脚印」那列 / the Footprints column
  tasks?: Record<string, Cat>;                                    // 某件事算哪类 / category overrides
  wakeAt?: string; sleepAt?: string;                              // 「7:30」「24:40」
  compare?: { title: string; sub?: string; head: string[]; rows: string[][]; note?: string }[];
  issues?: { text: string; fix?: string }[];
  sections?: { title: string; body: string }[];
  planWhy?: string; tomorrow?: string;
  dataNote?: string;
}
const words: Words = readJSON(join(ws, `review/${day}.json`)) ?? {};
const ZH = langArg ? langArg === 'zh' : words.lang ? words.lang === 'zh'
  : /[一-鿿]/.test(`${words.title ?? ''}${words.oneLine ?? ''}`) || /^zh/i.test(process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale);
const T = (zh: string, en: string) => (ZH ? zh : en);

const WEEK_ZH = '日一二三四五六', WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayName = (d: string) => { const t = new Date(d + 'T12:00:00'); return ZH ? `${t.getMonth() + 1}/${t.getDate()} 周${WEEK_ZH[t.getDay()]}` : `${WEEK_EN[t.getDay()]}, ${MON_EN[t.getMonth()]} ${t.getDate()}`; };
const hmS = (sec: number) => `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}`;
/** 3h30′、48′：两种语言都这么写 */
const dur = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? `${pad(m % 60)}′` : ''}` : `${m}′`; };
const DAY = 86400;
const at = (sec: number) => sec >= DAY ? `${T('次日', '+1 ')}${hmS(sec - DAY)}` : hmS(Math.max(0, sec));
const hms = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 3600 + (m || 0) * 60; };

// ───────── 分类 / categories ─────────
const CATS: Record<Cat, string> = {
  work: T('做事', 'Making'), learn: T('读·听·学', 'Learning'), people: T('见人·聊天', 'People'),
  move: T('动一动', 'Moving'), home: T('家务·杂事', 'Errands'), rest: T('休息·玩', 'Rest & play'), other: T('其他', 'Other'),
};
const TASK_CAT: [RegExp, Cat][] = [
  [/读|看书|学|听|课|播客|read|book|learn|study|course|podcast|ch\.\s*\d/i, 'learn'],
  [/见|聊|约|电话|回复|会|生日|咖啡|饭局|call|meet|reply|chat|coffee|lunch with|dinner with|birthday|party/i, 'people'],
  [/健身|跑步|瑜伽|散步|游泳|运动|gym|run|yoga|walk|swim|workout|bike/i, 'move'],
  [/买|超市|快递|取件|牙医|医生|洗|打扫|收拾|家务|grocer|shop|package|pharmacy|dentist|doctor|clean|laundry|tidy|errand/i, 'home'],
  [/游戏|看剧|电影|综艺|休息|午睡|game|movie|show|nap|rest|relax/i, 'rest'],
  [/写|做|设计|代码|发布|方案|文档|稿|logo|landing|ship|build|draft|write|design|code|deploy|plan|sketch|newsletter|copy/i, 'work'],
];
function catOfTask(title: string): Cat {
  if (words.tasks?.[title]) return words.tasks[title];
  for (const [re, c] of TASK_CAT) if (re.test(title)) return c;
  return 'other';
}
const APP_CAT: [RegExp, Cat][] = [
  [/^(Claude|ChatGPT|Codex|Terminal|终端|Cursor|Visual Studio Code|Xcode|Figma|GitHub|Notion|Diem|这一天|Pages|Keynote|Numbers|Word|Excel|PowerPoint|Google Docs)$/, 'work'],
  [/^(Anew|知新 Anew|Kindle|Books|图书|Podcasts|播客|Readwise|Reeder)$/, 'learn'],
  [/^(Messages|信息|Mail|邮件|Slack|Lark|飞书|WeChat|微信|Zoom|FaceTime|Discord|Telegram)$/, 'people'],
  [/^(YouTube|X|Reddit|Hacker News|Bilibili|Weibo|Zhihu|Douyin|Xiaohongshu|Netflix|Music|音乐|Spotify)$/, 'rest'],
];
const catOfApp = (name: string): Cat => { for (const [re, c] of APP_CAT) if (re.test(name)) return c; return 'other'; };

// ───────── 素材 / material ─────────
interface Bar { s: number; e: number; cat: Cat; label: string; tip: string }
const items: any[] = readJSON(join(ws, 'lists/backup.json'))?.items ?? [];
const next = addDays(day, 1);
const offOf = (d: string) => d === day ? 0 : d === next ? DAY : d === addDays(day, -1) ? -DAY : NaN;
const secOf = (iso: string) => (new Date(iso).getTime() - new Date(day + 'T00:00:00').getTime()) / 1000;
/** 一天按凌晨 5 点翻篇 / a day turns over at 5 am */
const dayOfIso = (iso?: string) => iso ? ymdOf(new Date(Date.parse(iso) - 5 * 3600_000)) : '';
const planBar = (pl: any, title: string, note: string): Bar | null => {
  const off = offOf(pl.date); if (Number.isNaN(off)) return null;
  const s = off + pl.start * 60, e = off + (pl.start + pl.dur) * 60;
  return { s, e, cat: catOfTask(title), label: title, tip: `${at(s)}–${at(e)} ${title}${note}` };
};
const tasks: Bar[] = [];
const doneList: { title: string; cat: Cat; s?: number }[] = [];
let pieceCount = 0;
for (const i of items) {
  for (const p of i.pieces ?? []) if (p.date === day) {
    const b = planBar(p, i.title, T('（做了一截）', ' (part done)'));
    if (b) { tasks.push(b); pieceCount++; }
  }
  if (!i.done) continue;
  const b = i.plan?.date === day ? planBar(i.plan, i.title, ' ✓') : null;
  if (b || dayOfIso(i.doneAt) === day) {
    doneList.push({ title: i.title, cat: catOfTask(i.title), s: b?.s ?? (i.doneAt ? secOf(i.doneAt) : undefined) });
    if (b) tasks.push(b);
  }
}
// 排了、没打勾的：日历那列画虚线 / planned but not ticked: dashed
const planned: Bar[] = items.filter(i => i.plan?.date === day && !i.done && !(i.pieces ?? []).some((p: any) => p.date === day))
  .map(i => planBar(i.plan, i.title, T('（排了，没打勾）', ' (planned, not ticked)'))!).filter(Boolean);
// 纸上直接打勾、划掉的 / ticked or struck straight on the paper
const papers: any[] = existsSync(join(ws, 'ideas'))
  ? readdirSync(join(ws, 'ideas')).filter(f => f.endsWith('.json')).map(f => readJSON(join(ws, 'ideas', f))).filter(Boolean) : [];
const struck: string[] = [];
for (const p of papers) for (const b of p.blocks ?? []) {
  const first = String(b.text ?? '').split('\n')[0];
  const when = b.doneAt ? dayOfIso(b.doneAt) : p.created === day ? day : '';
  if (b.done && !b.links?.length && when === day && !doneList.some(d => d.title === first)) doneList.push({ title: first, cat: catOfTask(first), s: b.doneAt ? secOf(b.doneAt) : undefined });
  if (b.struck && when === day) struck.push(first);
}
// 明天 / tomorrow
const tomorrowPlan = items.filter(i => !i.done && i.plan?.date === next).sort((a, b) => a.plan.start - b.plan.start);
const tomorrowLoose = items.filter(i => !i.done && i.plan?.date !== next && (i.wish === next || i.due === next));
// 这天拍的纸 / photos of the paper taken this day
const stamp = day.replace(/-/g, '');
const photos = existsSync(join(ws, 'photos'))
  ? readdirSync(join(ws, 'photos')).filter(f => f.startsWith(stamp) && /\.(jpe?g|png|webp)$/i.test(f)).sort().map(f => `photos/${f}`) : [];
const morningPhoto = words.paper?.morning ?? photos[0];
const eveningPhoto = words.paper?.evening ?? (photos.length > 1 ? photos.at(-1) : undefined);

// 电脑记录（实验功能，有就画）/ Mac activity (Labs), drawn only if present
interface Seg { app: string; url?: string; title?: string; s: number; e: number }
const usageOf = (d: string): Bar[] => ((readJSON(join(ws, `usage/${d}.json`))?.segments ?? []) as Seg[]).map(g => {
  const w = whatOf(g), off = offOf(d);
  return { s: g.s + off, e: g.e + off, cat: catOfApp(w), label: w, tip: `${at(g.s + off)}–${at(g.e + off)} ${w}` };
});
const compRaw = [...usageOf(day).filter(b => b.s >= 5 * 3600), ...usageOf(next).filter(b => b.s < DAY + 5 * 3600)];
// 在 app 里动过的时间（log/日期.md 每行开头的时间）/ times you touched the app
const logActs = existsSync(join(ws, `log/${day}.md`))
  ? [...readFileSync(join(ws, `log/${day}.md`), 'utf8').matchAll(/^- (\d{1,2}):(\d{2}) /gm)].map(m => { const h = Number(m[1]); return (h < 5 ? DAY : 0) + h * 3600 + Number(m[2]) * 60; })
  : [];

// 醒来、睡下：Claude 写了就用；否则看这天最早、最晚动过的时间；都没有就 7:00–23:00
const acts = [...tasks.flatMap(b => [b.s, b.e]), ...compRaw.flatMap(b => [b.s, b.e]), ...logActs].filter(t => t >= 4 * 3600 && t <= DAY + 5 * 3600);
const wake = words.wakeAt ? hms(words.wakeAt) : acts.length ? Math.min(...acts) : 7 * 3600;
const sleep = words.sleepAt ? hms(words.sleepAt) : acts.length ? Math.max(...acts, wake + 6 * 3600) : 23 * 3600;
const comp = compRaw.filter(b => b.e > wake && b.s < sleep).map(b => ({ ...b, s: Math.max(b.s, wake), e: Math.min(b.e, sleep) }));

// ───────── 小工具 / helpers ─────────
const sum = (bs: Bar[]) => bs.reduce((a, b) => a + b.e - b.s, 0);
const byCat = (bs: Bar[]) => { const m = new Map<Cat, number>(); for (const b of bs) m.set(b.cat, (m.get(b.cat) ?? 0) + b.e - b.s); return m; };
const byLabel = (bs: Bar[]) => { const m = new Map<string, { t: number; cat: Cat }>(); for (const b of bs) { const x = m.get(b.label) ?? { t: 0, cat: b.cat }; x.t += b.e - b.s; m.set(b.label, x); } return [...m].sort((a, b) => b[1].t - a[1].t); };
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function mdLite(src: string): string {
  const out: string[] = []; let list = false;
  for (const raw of src.split('\n')) {
    const l = raw.trim(), li = l.match(/^[-*]\s+(.*)$/);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (l) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
/** 估一段字在 12px 下多宽：汉字 12，其他 6.8 */
const textW = (t: string) => [...t].reduce((a, c) => a + (/[\u0000-ÿ]/.test(c) ? 6.8 : 12), 0);
function fit(t: string, w: number): string {
  if (textW(t) <= w) return t;
  let out = '';
  for (const c of t) { if (textW(out + c + '…') > w) break; out += c; }
  return out ? out + '…' : '';
}
function wrap(t: string, w: number): string[] {
  const lines: string[] = []; let cur = '';
  for (const piece of ZH ? [...t] : t.split(/(?<=\s)/)) { if (textW(cur + piece) > w && cur) { lines.push(cur.trimEnd()); cur = ''; } cur += piece; }
  if (cur) lines.push(cur);
  return lines;
}
/** 坐下来的一段：隔 5 分钟以内算连着 / a sitting: runs with gaps under 5 min */
function sittings(bs: Bar[]): Bar[] {
  const out: Bar[] = []; let run: Bar[] = [];
  const flush = () => {
    if (!run.length) return;
    const lab = byLabel(run), cats = [...byCat(run)].sort((a, b) => b[1] - a[1]);
    const s0 = run[0].s, e0 = Math.max(...run.map(b => b.e));
    out.push({ s: s0, e: e0, cat: cats[0][0], label: lab.slice(0, 2).map(([n]) => n).join(' · '), tip: `${at(s0)}–${at(e0)}\n${lab.slice(0, 6).map(([n, v]) => `${n} ${dur(v.t)}`).join('\n')}` });
    run = [];
  };
  for (const b of [...bs].sort((x, y) => x.s - y.s)) { if (run.length && b.s - Math.max(...run.map(r => r.e)) > 300) flush(); run.push(b); }
  flush();
  return out;
}
// 日报在 app 里是 srcdoc 打开的，相对路径的图读不到：把工作目录里的图直接嵌进去
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
const embedImgs = (html: string) => html.replace(/src="(?!https?:|data:)([^"]+)"/g, (all, rel: string) => {
  const f = join(ws, rel), ext = rel.split('.').pop()!.toLowerCase();
  return existsSync(f) && MIME[ext] ? `src="data:${MIME[ext]};base64,${readFileSync(f).toString('base64')}"` : all;
});

// ───────── 图：这一天（竖的）/ chart: the day, vertical ─────────
function dayChart(): string {
  type Col = { name: string; sub?: string; ratio: number; bars: Bar[]; dashed?: Bar[]; kind?: 'note' };
  const cols: Col[] = [
    { name: T('脚印', 'Footprints'), sub: T('妥妥看到的', 'as Toto saw it'), ratio: comp.length ? 0.32 : 0.45, bars: [], kind: 'note' },
    { name: T('日历', 'Calendar'), sub: T('排的和做的', 'planned & done'), ratio: comp.length ? 0.38 : 0.55, bars: tasks, dashed: planned },
    ...(comp.length ? [{ name: T('电脑', 'Mac'), sub: dur(sum(comp)), ratio: 0.3, bars: sittings(comp) }] : []),
  ];
  if (!tasks.length && !planned.length && !comp.length && !words.marks?.length) return '';
  const h0 = Math.floor(wake / 3600), h1 = Math.max(h0 + 6, Math.ceil(sleep / 3600));
  const HP = 42, Tp = 40, W = 1000, L = 46, gap = 14;
  const avail = W - L - gap * (cols.length - 1), tot = cols.reduce((a, c) => a + c.ratio, 0);
  const y = (sec: number) => Tp + (Math.max(sec, h0 * 3600) - h0 * 3600) / 3600 * HP;
  const H = Tp + (h1 - h0) * HP + 20;
  let out = '';
  for (let hr = h0; hr <= h1; hr++) out += `<line x1="${L}" x2="${W}" y1="${y(hr * 3600)}" y2="${y(hr * 3600)}" class="${hr % 2 ? 'grid faint' : 'grid'}"/>${hr % 2 ? '' : `<text x="${L - 8}" y="${y(hr * 3600) + 4}" text-anchor="end" class="tick">${((hr % 24) + 24) % 24}:00</text>`}`;
  if (h0 < 24 && h1 > 24) out += `<line x1="${L - 40}" x2="${W}" y1="${y(DAY)}" y2="${y(DAY)}" class="midnight"/>`;
  out += `<text x="${W}" y="${y(wake) - 4}" text-anchor="end" class="tick">☀ ${at(wake)}</text><text x="${W}" y="${y(sleep) + 14}" text-anchor="end" class="tick">☾ ${at(sleep)}</text>`;
  let x0 = L;
  for (const [ci, c] of cols.entries()) {
    if (ci) x0 += gap;
    const cw = avail * c.ratio / tot;
    out += `<text x="${x0}" y="${Tp - 14}" class="lane">${esc(c.name)}${c.sub ? `<tspan class="tick" dx="6">${esc(c.sub)}</tspan>` : ''}</text>`;
    const label = (b: Bar, top: number, hgt: number, cls: string) => {
      if (hgt < 15) return '';
      const d = b.e - b.s >= 1200 ? ` · ${dur(b.e - b.s)}` : '';
      const t = fit(b.label + d, cw - 12) || fit(b.label, cw - 12);
      return t ? `<text x="${x0 + 6}" y="${top + Math.min(hgt / 2 + 4, 15)}" class="${cls}">${esc(t)}</text>` : '';
    };
    if (c.kind === 'note') {
      const notes = (words.marks ?? []).map(m => ({ s: hms(m.s), e: hms(m.e), text: m.text, cat: (m.cat ?? 'other') as Cat })).sort((a, b) => a.s - b.s);
      let cur = -Infinity;
      for (const n of notes) {
        const top = Math.max(y(Math.max(n.s, wake)), cur);
        const lines = wrap(n.text, cw - 14).slice(0, 4);
        const bot = Math.max(top + 14, y(n.e));
        out += `<path d="M${x0 + 4} ${top} H${x0} V${bot} H${x0 + 4}" fill="none" stroke="var(--c-${n.cat})" stroke-width="1.6"/>`;
        lines.forEach((ln, k) => { out += `<text x="${x0 + 9}" y="${top + 11 + k * 14}" class="mark">${esc(ln)}</text>`; });
        cur = top + lines.length * 14 + 4;
      }
      x0 += cw;
      continue;
    }
    for (const b of c.dashed ?? []) {
      const top = y(b.s), hgt = Math.max(1.2, y(b.e) - top);
      out += `<rect x="${x0 + 1}" y="${top}" width="${cw - 2}" height="${hgt}" rx="4" fill="none" stroke="var(--c-${b.cat})" stroke-dasharray="4 3"><title>${esc(b.tip)}</title></rect>${label(b, top, hgt, 'dl')}`;
    }
    for (const b of c.bars) {
      if (b.e <= h0 * 3600) continue;
      const top = y(b.s), hgt = Math.max(1.2, y(b.e) - top);
      out += `<rect x="${x0}" y="${top}" width="${cw}" height="${hgt}" rx="${hgt > 8 ? 4 : 1}" fill="var(--c-${b.cat})"><title>${esc(b.tip)}</title></rect>${label(b, top, hgt, 'in')}`;
    }
    x0 += cw;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(T('这一天', 'The day'))}">${out}</svg>`;
}

// ───────── 图：时间投进了哪里 / chart: where time went ─────────
function investChart(): string {
  const src = [{ key: 'task', name: T('动手做的事', 'Tasks'), m: byCat(tasks) }, ...(comp.length ? [{ key: 'comp', name: T('电脑', 'Mac'), m: byCat(comp) }] : [])];
  const cats = (Object.keys(CATS) as Cat[]).filter(c => src.some(s => s.m.get(c)));
  if (!cats.length) return '';
  const tot = (c: Cat) => src.reduce((a, s) => a + (s.m.get(c) ?? 0), 0);
  cats.sort((a, b) => tot(b) - tot(a));
  const max = Math.max(...cats.map(tot), 1);
  const W = 1000, L = 110, R = 90, rowH = 30;
  let y = 6, out = '';
  for (const c of cats) {
    let x0 = L;
    out += `<text x="${L - 10}" y="${y + 15}" text-anchor="end" class="lane">${esc(CATS[c])}</text>`;
    for (const s of src) {
      const t = s.m.get(c) ?? 0; if (!t) continue;
      const w = (t / max) * (W - L - R);
      out += `<rect x="${x0.toFixed(1)}" y="${y + 3}" width="${Math.max(1, w).toFixed(1)}" height="${rowH - 10}" rx="3" fill="var(--c-${c})" opacity="${s.key === 'task' ? 1 : 0.5}"><title>${esc(CATS[c])} · ${esc(s.name)} ${dur(t)}</title></rect>`;
      x0 += w + 1.5;
    }
    out += `<text x="${x0 + 6}" y="${y + 17}" class="val">${dur(tot(c))}</text>`;
    y += rowH;
  }
  return `<svg viewBox="0 0 ${W} ${y + 4}" class="chart" role="img" aria-label="${esc(T('时间投入', 'Time spent'))}">${out}</svg>`;
}

const legend = (cs: Cat[]) => `<div class="legend">${cs.map(c => `<span><i style="background:var(--c-${c})"></i>${esc(CATS[c])}</span>`).join('')}</div>`;
const usedCats = (bs: Bar[][]) => (Object.keys(CATS) as Cat[]).filter(c => bs.some(b => b.some(x => x.cat === c)));

function tomorrowHTML(): string {
  if (!tomorrowPlan.length && !tomorrowLoose.length) return `<p class="sub">${T('明天还没排。在 app 里拖一下，或者叫妥妥排。', 'Nothing planned yet. Drag a few things onto tomorrow, or ask Toto.')}</p>`;
  const row = (t: string, title: string, sub: string, cat: Cat) => `<li><span class="tm">${t}</span><span class="dot" style="background:var(--c-${cat})"></span><span class="tt">${esc(title)}</span><span class="ts">${sub}</span></li>`;
  return `<ul class="plan">${tomorrowPlan.map(i => row(`${hmS(i.plan.start * 60)}–${hmS((i.plan.start + i.plan.dur) * 60)}`, i.title, '', catOfTask(i.title))).join('')}${
    tomorrowLoose.map(i => row(T('没排时间', 'unscheduled'), i.title, i.due === next ? T('明天截止', 'due tomorrow') : '', catOfTask(i.title))).join('')}</ul>`;
}

const wins: Win[] = words.wins?.length ? words.wins
  : doneList.sort((a, b) => (a.s ?? Infinity) - (b.s ?? Infinity)).map(d => ({ cat: d.cat, text: d.title, at: d.s != null ? hmS(d.s) : undefined }));
function winsHTML(): string {
  if (!wins.length) return `<p class="sub">${T('这天没有打勾的事。也没关系。', 'Nothing ticked this day. That is fine too.')}</p>`;
  const body = (w: Win) => `<div class="t">${inline(w.text ?? '')}${w.amt ? `<span class="amt">${inline(w.amt)}</span>` : ''}${w.tag ? `<span class="tag">${esc(w.tag)}</span>` : ''}</div>${w.quote ? `<div class="q">${inline(w.quote)}</div>` : ''}${w.cheer ? `<div class="c">${inline(w.cheer)}</div>` : ''}`;
  if (!wins.some(w => w.at)) return `<ul class="wins">${wins.filter(w => !w.aside).map((w, i) => `<li style="--c:var(--c-${w.cat ?? 'work'})"><span class="n">${i + 1}</span><div>${body(w)}</div></li>`).join('')}</ul>`;
  const key = (w: Win) => w.at ? hms(w.at) + (hms(w.at) < 5 * 3600 ? DAY : 0) : Infinity;
  const rows = wins.map((w, i) => ({ w, i })).sort((a, b) => key(a.w) - key(b.w) || a.i - b.i).map(({ w }) => w);
  return `<ul class="wins tl">${rows.map(w => w.aside
    ? `<li class="aside"><span class="tm">${esc(w.at ?? '')}</span><span></span><div>${inline(w.aside)}</div></li>`
    : `<li style="--c:var(--c-${w.cat ?? 'work'})"><span class="tm">${esc(w.at ?? '')}</span><span class="dot"></span><div class="card">${body(w)}</div></li>`).join('')}</ul>`;
}

/** 纸 → 这一天：早上、晚上拍的纸并排 / paper → day: the morning and evening photos side by side */
function paperHTML(): string {
  if (!morningPhoto && !eveningPhoto) return '';
  const fig = (src: string, cap: string) => `<figure><img tabindex="0" src="${esc(src)}" alt="${esc(cap)}" title="${esc(T('点一下放大', 'Click to zoom'))}"><figcaption>${esc(cap)}</figcaption></figure>`;
  return `<section class="paper">
<h2>${T('从一张纸开始', 'It started on paper')}</h2>
<p class="sub">${words.paper?.caption ? inline(words.paper.caption) : T('早上随手写的，晚上打勾、划掉的。拾拾把它认成了下面这一天。', 'Scribbled in the morning, ticked and crossed out by night. Pip turned it into the day below.')}</p>
<div class="p-row${morningPhoto && eveningPhoto ? '' : ' one'}">${morningPhoto ? fig(morningPhoto, T('早上', 'Morning')) : ''}${eveningPhoto ? fig(eveningPhoto, T('晚上', 'Evening')) : ''}</div>
</section>`;
}

const kpi = (n: string, l: string, sub = '', c?: Cat) => `<div class="kpi"${c ? ` style="--k:var(--c-${c})"` : ''}><b>${n}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
const doneSec = sum(tasks), planSec = doneSec + sum(planned);
const numbers = words.numbers?.length
  ? words.numbers.map(x => kpi(esc(x.n), inline(x.label), x.sub ? inline(x.sub) : '', x.cat))
  : [
    kpi(String(doneList.length), T('件做完', 'done'), pieceCount ? T(`推进 ${pieceCount} 截`, `${pieceCount} ${pieceCount === 1 ? "part" : "parts"} moved forward`) : ''),
    kpi(dur(doneSec), T('做了的时间', 'time on tasks'), planSec > doneSec ? T(`排了 ${dur(planSec)}`, `${dur(planSec)} planned`) : ''),
    ...(struck.length ? [kpi(String(struck.length), T('件决定放下', 'let go'), '', 'rest')] : []),
    ...(comp.length ? [kpi(dur(sum(comp)), T('电脑', 'on the Mac'), '', 'other')] : []),
  ];

const FONT_ZH = '-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
const FONT_EN = '-apple-system,"Helvetica Neue",sans-serif';
const chart = dayChart(), invest = investChart();
const html = `<!doctype html>
<html lang="${ZH ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${T('日报', 'Daily review')} · ${dayName(day)}</title>
<style>
:root{
  --bg:#f4efe4; --card:#fbf8f1; --ink:#1c2836; --text:#2d3945; --muted:#7c8590; --line:#e2dbcc; --track:#ece6d9;
  --c-work:#2D5E3A; --c-learn:#3a7f8a; --c-people:#8a79b5; --c-move:#5d8a55; --c-home:#c4903f; --c-rest:#c27a96; --c-other:#b5ada0;
  --accent:#2D5E3A; --warm:#B5532F;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#12171d; --card:#1a2129; --ink:#e8edf2; --text:#cdd5dd; --muted:#8894a0; --line:#2b3540; --track:#222b35;
  --c-work:#8cc49a; --c-learn:#6fb3bd; --c-people:#a898d0; --c-move:#7fae74; --c-home:#d9a758; --c-rest:#d897b0; --c-other:#7d7870;
  --accent:#9fd08f; --warm:#E08A5F;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 ${ZH ? FONT_ZH : FONT_EN};-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:28px 16px 60px}
h1,h2,h3{color:var(--ink);font-family:${ZH ? '"Songti SC","STSong",serif' : '"New York","Iowan Old Style",Georgia,serif'};font-weight:700}
.kicker{color:var(--muted);font-size:13px;letter-spacing:.08em}
h1{font-size:32px;margin:4px 0 6px;line-height:1.3}
.one{font-size:17px;margin:0 0 14px}
.mood{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.mood .w{padding:3px 12px;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-size:13px}
.quote{border-left:3px solid var(--warm);padding:4px 0 4px 14px;margin:0 0 22px;font-family:${ZH ? '"Kaiti SC","STKaiti",serif' : '"Bradley Hand","Segoe Print",cursive'};font-size:19px}
.kpis{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));margin:8px 0 24px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.kpi{padding:14px 14px 12px;border-left:1px solid var(--line);min-width:0}
.kpi:first-child{border-left:0;padding-left:2px}
.kpi b{display:block;color:var(--k,var(--accent));font-size:36px;font-family:"Avenir Next","Helvetica Neue",sans-serif;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{display:block;color:var(--ink);font-size:14px;margin-top:4px}
.kpi em{display:block;font-style:normal;font-size:12px;color:var(--muted)}
@media (max-width:620px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi{border-left:1px solid var(--line)!important;padding-left:14px!important}.kpi:nth-child(odd){border-left:0!important;padding-left:2px!important}.kpi:nth-child(n+3){border-top:1px solid var(--line)}}
section{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px 16px;margin:0 0 16px}
section h2{font-size:20px;margin:0 0 4px} .sub{color:var(--muted);font-size:13px;margin:0 0 10px}
.chart{width:100%;height:auto;display:block}
.chart text{fill:var(--text);font-size:12px} .chart .tick{fill:var(--muted);font-size:11px} .chart .lane{fill:var(--ink);font-size:13px}
.chart .val{fill:var(--muted)} .chart .in{fill:#fff;pointer-events:none} .chart .mark{fill:var(--ink)} .chart .dl{fill:var(--muted)}
.chart .grid{stroke:var(--line)} .chart .faint{opacity:.45} .chart .midnight{stroke:var(--warm);stroke-dasharray:2 3}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);margin:8px 0 0}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.p-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px} .p-row.one{grid-template-columns:minmax(0,420px)}
.p-row figure{margin:0;min-width:0} .p-row figcaption{font-size:12px;color:var(--muted);margin-top:6px;text-align:center}
.p-row img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;display:block;cursor:zoom-in;border:1px solid var(--line);outline:none;box-shadow:0 8px 24px rgba(30,30,40,.12)}
.p-row img:focus{position:fixed;inset:0;margin:auto;width:auto;height:auto;max-width:94vw;max-height:92vh;aspect-ratio:auto;object-fit:contain;z-index:10;cursor:zoom-out;box-shadow:0 0 0 100vmax rgba(0,0,0,.6)}
.wins{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:10px}
.wins li{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--c) 9%,transparent)}
.wins .n{width:28px;height:28px;border-radius:50%;background:var(--c);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:700}
.wins .t{color:var(--ink);font-weight:600}
.wins .amt{margin-left:10px;color:var(--c);font-weight:600;font-size:14px}
.wins .tag{float:right;margin-left:10px;font-size:12px;font-weight:400;padding:0 9px;border-radius:999px;border:1px solid color-mix(in srgb,var(--c) 45%,transparent);color:var(--c)}
.wins .q{margin:3px 0 1px;color:var(--ink);font-style:italic}
.wins .c{font-size:14px;color:var(--text)}
.wins.tl{position:relative}
.wins.tl:before{content:"";position:absolute;left:61px;top:10px;bottom:10px;width:2px;background:var(--line)}
.wins.tl li{grid-template-columns:44px 12px 1fr;gap:0 12px;padding:0;background:none}
.wins.tl .tm{color:var(--muted);font-size:13px;text-align:right;padding-top:11px;font-variant-numeric:tabular-nums}
.wins.tl .dot{width:12px;height:12px;border-radius:50%;background:var(--c);margin-top:15px;box-shadow:0 0 0 3px var(--card)}
.wins.tl .card{padding:9px 12px;border-radius:12px;background:color-mix(in srgb,var(--c) 9%,transparent)}
.wins.tl .aside div{font-size:13px;color:var(--muted);border-left:2px dashed var(--line);padding:2px 0 2px 10px}
@media (max-width:520px){.wins.tl li{grid-template-columns:38px 12px 1fr;gap:0 8px}.wins.tl:before{left:51px}.p-row{gap:8px}}
.prose p{margin:6px 0} .prose ul{margin:6px 0;padding-left:20px} .prose b{color:var(--ink)} .note{margin:12px 2px 0;font-size:14px}
.plan{list-style:none;margin:6px 0 0;padding:0} .plan li{display:grid;grid-template-columns:100px 10px 1fr auto;gap:10px;align-items:center;padding:5px 0;border-bottom:1px dashed var(--line)}
.plan li:last-child{border-bottom:0} .plan .tm{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px} .plan .dot{width:8px;height:8px;border-radius:50%}
.plan .tt{color:var(--ink)} .plan .ts{color:var(--muted);font-size:12px}
.why{margin:2px 0 8px;font-size:14px}
.tomorrow{background:color-mix(in srgb,var(--accent) 8%,var(--card));border-color:color-mix(in srgb,var(--accent) 25%,var(--line))}
.cmp-wrap{overflow-x:auto;margin:6px 0 0}
.cmp{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
.cmp th{text-align:left;font-weight:600;color:var(--muted);font-size:12.5px;padding:6px 10px;border-bottom:1.5px solid var(--line);white-space:nowrap}
.cmp td{padding:7px 10px;border-bottom:1px dashed var(--line);vertical-align:top} .cmp tr:last-child td{border-bottom:0}
.cmp td:first-child{color:var(--ink);white-space:nowrap} .cmp td.up{color:var(--c-work)} .cmp td.down{color:var(--warm)}
.issues ol{margin:6px 0 0;padding-left:22px} .issues li{margin:8px 0;font-size:14px}
.issues .fix{margin-top:3px;font-size:13px;color:var(--muted);border-left:2px solid var(--accent);padding-left:8px}
.datanote{margin:-8px 0 18px;padding:8px 12px;border-radius:10px;font-size:13px;background:color-mix(in srgb,var(--warm) 10%,transparent);border-left:3px solid var(--warm)}
.sign{display:flex;align-items:center;gap:10px;justify-content:flex-end;color:var(--muted);font-size:13px;margin:18px 4px 0}
.sign b{font-size:26px;line-height:1}
</style></head><body><div class="wrap">
<div class="kicker">${T('这一天 · 日报', 'Diem · Daily review')} · ${dayName(day)} · ☀ ${at(wake)} → ☾ ${at(sleep)}</div>
<h1>${esc(words.title ?? T(`${dayName(day)} 的一天`, dayName(day)))}</h1>
${words.oneLine ? `<p class="one">${inline(words.oneLine)}</p>` : ''}
${words.mood?.words?.length ? `<div class="mood">${words.mood.words.map(w => `<span class="w">${esc(w)}</span>`).join('')}</div>` : ''}
${words.mood?.quote ? `<p class="quote">${inline(words.mood.quote)}</p>` : ''}
<div class="kpis" style="--n:${Math.min(numbers.length, 6)}">${numbers.join('')}</div>
${words.dataNote ? `<p class="datanote">${inline(words.dataNote)}</p>` : ''}

${paperHTML()}

<section>
<h2>${T('做成了', 'Done')}</h2>
${winsHTML()}
${words.winsNote?.length ? `<div class="prose note">${words.winsNote.map(n => `<p>${inline(n)}</p>`).join('')}</div>` : ''}
${struck.length ? `<p class="sub" style="margin-top:12px">${T('决定放下的：', 'Let go: ')}${struck.map(esc).join(T('、', ', '))}</p>` : ''}
</section>

${chart ? `<section>
<h2>${T('这一天', 'The day')}</h2>
<p class="sub">${T('脚印是妥妥看到的你在干嘛；日历是时间轴上排的和做完的（实心做了，虚线排了没打勾）', 'Footprints are what Toto saw you doing. Calendar is your timeline: solid is done, dashed was planned but not ticked')}${comp.length ? T('；电脑是坐下来的一段一段。', '. Mac shows your sittings.') : T('。', '.')}</p>
${chart}
${legend(usedCats([tasks, planned, comp]))}
</section>` : ''}

${invest ? `<section>
<h2>${T('时间投进了哪里', 'Where the time went')}</h2>
${comp.length ? `<p class="sub">${T('深的是动手做的事，浅的是电脑。各自算，可能重叠。', 'Dark is tasks, light is Mac time. Counted separately, so they may overlap.')}</p>` : ''}
${invest}
${words.investNote?.length ? `<div class="prose note">${words.investNote.map(n => `<p>${inline(n)}</p>`).join('')}</div>` : ''}
</section>` : ''}

${(words.compare ?? []).map(t => `<section>
<h2>${esc(t.title)}</h2>
${t.sub ? `<p class="sub">${inline(t.sub)}</p>` : ''}
<div class="cmp-wrap"><table class="cmp"><thead><tr>${t.head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map(r => `<tr>${r.map(c => `<td${/^↑/.test(c) ? ' class="up"' : /^↓/.test(c) ? ' class="down"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
${t.note ? `<p class="sub" style="margin-top:8px">${inline(t.note)}</p>` : ''}
</section>`).join('\n')}

${words.issues?.length ? `<section class="issues">
<h2>${T('盘一盘', 'Looking back')}</h2>
<p class="sub">${T('不是挑错，是看看哪里能再顺一点。', 'Not faults. Just where things could flow a little better.')}</p>
<ol>${words.issues.map(x => `<li><div>${inline(x.text)}</div>${x.fix ? `<div class="fix">${T('试试：', 'Try: ')}${inline(x.fix)}</div>` : ''}</li>`).join('')}</ol>
</section>` : ''}

${(words.sections ?? []).map(s => `<section class="prose"><h2>${esc(s.title)}</h2>${mdLite(s.body)}</section>`).join('\n')}

<section class="tomorrow">
<h2>${T('明天', 'Tomorrow')} · ${dayName(next)}</h2>
${words.planWhy ? `<p class="why">${inline(words.planWhy)}</p>` : ''}
${tomorrowHTML()}
${words.tomorrow ? `<p class="sub" style="margin-top:8px">${inline(words.tomorrow)}</p>` : ''}
</section>

<div class="sign"><span>${T('妥妥写的', 'Written by Toto')} · Carpe diem</span><b>🐘</b></div>
</div></body></html>`;

mkdirSync(join(ws, 'review'), { recursive: true });
writeFileSync(join(ws, `review/${day}.html`), embedImgs(html));
syncLog(ws, { tool: 'review', cmd: day, files: [`review/${day}.html`] });
console.log(`review/${day}.html`);
