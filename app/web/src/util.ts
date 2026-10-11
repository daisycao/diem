import { IS_ZH, L } from './i18n';
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

export function uid(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 一天到凌晨 5 点才翻篇：熬夜到 2 点还算前一天（跟日报一样，按醒来到睡下算） */
export const DAY_TURN = 5;

/** 本地日期 YYYY-MM-DD；不传日子就是「这一天」：凌晨 5 点前还算昨天 */
export function ymd(d = new Date(Date.now() - DAY_TURN * 3600_000)): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 9月26日 周六 */
export function dayLabel(s: string): string {
  const d = parseYmd(s);
  return IS_ZH ? `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}` : `${WEEK_EN[d.getDay()]}, ${MON_EN[d.getMonth()]} ${d.getDate()}`;
}

/** 9/26 */
export function shortDay(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 相对今天的叫法：今天 / 明天 / 昨天 / 9/28 */
export function relDay(s: string, today = ymd()): string {
  if (s === today) return L('今天', 'Today');
  if (s === addDays(today, 1)) return L('明天', 'Tomorrow');
  if (s === addDays(today, -1)) return L('昨天', 'Yesterday');
  if (s === addDays(today, 2)) return L('后天', 'In 2 days');
  return shortDay(s);
}

/** 分钟 → 9:05 */
export function hm(min: number): string {
  if (min > 24 * 60) min -= 24 * 60; // 过了 0 点：25:30 写成 1:30
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** 40 → 40分；90 → 1时30分 */
export function dur(min: number): string {
  if (min < 60) return L(`${min}分`, `${min}m`);
  const h = Math.floor(min / 60), m = min % 60;
  return m ? L(`${h}时${m}分`, `${h}h ${m}m`) : L(`${h}小时`, `${h}h`);
}

/** 没写预计多久的事，放上时间轴时用最小的框 */
export const MIN_EST = 15;

/** 纸上写法：90 → 1.5H；60 → 1H；30 → 30min */
export function estTag(min: number): string {
  if (min < 60) return `${min}min`;
  return `${+(min / 60).toFixed(2)}H`;
}

/** 从第一行末尾认出「2H」「1.5h」「1h30」「30min」「30分钟」「半小时」「(1H)」这样的预计时长，
 *  认出来就从字里拿掉、返回分钟数。认不出就原样返回 */
export function parseEst(text: string): { text: string; est?: number; errand?: boolean } {
  const [first, ...rest] = text.split('\n');
  // 「找图书馆卡 顺手」：顺手的事，不占时间
  const q = first.match(/^(.*\S)\s*[(（]?(?:顺手|errand|on the way)[)）]?\s*$/i);
  if (q) return { text: [q[1].trim(), ...rest].join('\n'), errand: true };
  const re = /(^|[\s,，、·\u4e00-\u9fff]|(?=[(（]))[(（]?\s*(?:(\d+(?:\.\d+)?)\s*(?:h|H|hr|hrs|小时|个小时)\s*(?:(\d+)\s*(?:m|min|分|分钟)?)?|(\d+)\s*(?:m|min|mins|minutes|分钟|分)|(半)\s*(?:个)?小时)\s*[)）]?\s*$/;
  const m = first.match(re);
  if (!m) return { text };
  const est = m[5] ? 30 : m[4] ? +m[4] : Math.round(+m[2] * 60 + (m[3] ? +m[3] : 0));
  const title = first.slice(0, m.index! + m[1].length).trim();
  if (!title || !(est > 0) || est > 16 * 60) return { text };
  return { text: [title, ...rest].join('\n'), est };
}

/** 还剩多少：0.5 → 一半 */
export function leftText(f: number): string {
  if (Math.abs(f - 1 / 3) < 0.01) return '1/3';
  if (Math.abs(f - 2 / 3) < 0.01) return '2/3';
  return ({ 0.5: L('一半', 'half'), 0.25: '1/4', 0.75: '3/4' } as Record<number, string>)[f] ?? `${Math.round(f * 100)}%`;
}

/** 「这一天」的现在是第几分钟：凌晨 5 点前接着昨天往后数，0:33 → 24:33 */
export function nowMin(): number {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  return d.getHours() < DAY_TURN ? m + 24 * 60 : m;
}

/** 本地时间的 ISO 字符串（带时区），写进文件给人和 AI 看 */
export function isoNow(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** 20260926-213005 */
export function stamp(d = new Date()): string {
  return `${ymd(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const NUMS = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 小型 DOM 构造器 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    el.append(kid);
  }
  return el;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

let toastTimer = 0;
export function toast(text: string, ms = 3200): void {
  const el = document.getElementById('toast')!;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

/** replaceChildren，但允许 null / false 占位 */
export function fill(el: Element, ...kids: (Node | string | null | undefined | false)[]): void {
  el.replaceChildren(...(kids.filter(k => k != null && k !== false) as (Node | string)[]));
}
