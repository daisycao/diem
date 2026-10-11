// 电脑记录（实验功能）：后台的 diem-recorder 写 usage/日期.json（前台应用和时长），这里读出来画在时间轴左边。
// Mac activity (Labs): the background diem-recorder writes usage/<date>.json; drawn as a strip beside the timeline.
import { fs } from './bridge';
import { whatOf } from './sites';
import { extraWatch, render, S } from './store';
import { addDays, DAY_TURN } from './util';

export interface UsageSeg { app: string; bundle?: string; title?: string; url?: string; /** 距 0 点的秒数 */ s: number; e: number }

export const usage: { day: string; segs: UsageSeg[] } = { day: '', segs: [] };

const pathOf = (day: string) => `usage/${day}.json`;
/** 一天按凌晨 5 点翻篇：这天文件里 5 点前的算前一天熬的夜；下一天文件里 5 点前的接在这天后面（秒数 +24 小时） */
const TURN = DAY_TURN * 3600;
function ownPart(segs: UsageSeg[]) { return segs.filter(g => g.e > TURN).map(g => (g.s < TURN ? { ...g, s: TURN } : g)); }
function latePart(segs: UsageSeg[]) {
  return segs.filter(g => g.s < TURN).map(g => ({ ...g, s: g.s + 86400, e: Math.min(g.e, TURN) + 86400 }));
}
const parse = (r: { text: string } | null) => { try { return r ? JSON.parse(r.text) : null; } catch { return null; /* 正在写，下次再读 */ } };

async function load(day: string) {
  const [a, b] = await Promise.all([fs.read(pathOf(day)), fs.read(pathOf(addDays(day, 1)))]);
  if (usage.day !== day && S.day !== day) return;
  usage.day = day;
  if (a) S.mtimes[pathOf(day)] = a.mtime;
  if (b) S.mtimes[pathOf(addDays(day, 1))] = b.mtime;
  usage.segs = [...ownPart(parse(a)?.segments ?? []), ...latePart(parse(b)?.segments ?? [])];
}

/** 时间轴换了一天就去读那天的记录（连着下一天凌晨那一截）；文件变了会自动重读 */
export function ensureUsage() {
  const day = S.day;
  if (usage.day === day) return;
  usage.day = day;
  usage.segs = [];
  const next = addDays(day, 1);
  extraWatch[pathOf(day)] = extraWatch[pathOf(next)] = () => load(day);
  load(day).then(() => { if (S.day === day) render(); });
}

/** 按「在做什么」合计（浏览器按网站），秒 */
export function usageByApp(segs = usage.segs): [string, number][] {
  const m = new Map<string, number>();
  for (const g of segs) m.set(whatOf(g), (m.get(whatOf(g)) ?? 0) + (g.e - g.s));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 同一个应用总是同一个颜色：都在水、木的蓝绿色里挑 */
export function appColor(app: string): string {
  let h = 0;
  for (const c of app) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hues = [205, 190, 222, 170, 150, 238, 180, 212];
  return `hsl(${hues[h % hues.length]} 45% ${42 + (h >> 3) % 18}%)`;
}
