// 写进系统日历：时间轴上的块一一写进「Diem」日历，iPhone 通过 iCloud 就能看到、到点提醒。
// 只往外写，不读回来。每次把「昨天到两周后」整段交给原生，原生按 diem://item/<id> 对上、增删改。
// Write the timeline to the system calendar ("Diem"), so your iPhone gets it through iCloud.
// One way only. Each sync hands the native side the whole window (yesterday → two weeks out);
// it matches events by their diem://item/<id> URL and adds, updates or removes.
import { fs } from './bridge';
import { L } from './i18n';
import { S, saveUI } from './store';
import { addDays, toast, ymd } from './util';

export interface CalEvent { key: string; title: string; start: string; end: string; notes?: string; done?: boolean }

/** 分钟（可以超过 24:00，熬夜那段）→ 本地时间 ISO */
function at(day: string, min: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, min).toISOString();
}

function events(from: string, to: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const i of S.backup.items) {
    const title = i.title.split('\n')[0];
    for (const [n, p] of (i.pieces ?? []).entries()) {
      if (p.date < from || p.date > to) continue;
      out.push({ key: `${i.id}#${n}`, title: `✓ ${title}`, start: at(p.date, p.start), end: at(p.date, p.start + p.dur), done: true });
    }
    const p = i.plan;
    if (!p || p.date < from || p.date > to) continue;
    out.push({ key: i.id, title: i.done ? `✓ ${title}` : title, start: at(p.date, p.start), end: at(p.date, p.start + p.dur), done: !!i.done });
  }
  return out;
}

let last = '';
let timer = 0;

/** 时间轴变了就同步（攒 1.5 秒再发，内容没变不发） */
export function syncCalendar(force = false) {
  if (!S.ui.calendar?.on || !S.info?.native) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const from = addDays(ymd(), -1), to = addDays(ymd(), 14);
    const list = events(from, to);
    const sig = JSON.stringify([from, to, S.ui.calendar?.alertMin, list]);
    if (sig === last && !force) return;
    try {
      const r = await fs.calendar({ from, to, events: list, alertMin: S.ui.calendar?.alertMin ?? 5 });
      last = sig;
      if (r && !r.ok) toast(r.message ?? L('日历没写上', 'Calendar sync failed'));
    } catch (e) { toast(String((e as Error).message ?? e)); }
  }, force ? 0 : 1500);
}

/** 打开 / 关掉。打开时第一次会问日历权限；关掉时问要不要把「Diem」日历里的东西清掉 */
export async function setCalendar(on: boolean) {
  if (!S.info?.native) { toast(L('浏览器里没有系统日历', 'No system calendar in the browser')); return; }
  if (on) {
    const r = await fs.calendarAccess();
    if (!r.ok) { toast(r.message ?? L('没拿到日历权限：去「系统设置 › 隐私与安全性 › 日历」给 Diem 打开', 'No calendar access: turn Diem on in System Settings › Privacy & Security › Calendars')); return; }
    S.ui.calendar = { on: true, alertMin: S.ui.calendar?.alertMin ?? 5 };
    saveUI();
    last = '';
    syncCalendar(true);
    toast(L('写好了：日历 app 里多了一个「Diem」日历', 'Done: there is now a "Diem" calendar in Calendar'));
  } else {
    S.ui.calendar = { on: false, alertMin: S.ui.calendar?.alertMin };
    saveUI();
    if (confirm(L('把「Diem」日历里 Diem 写的事件也清掉吗？', 'Also remove the events Diem wrote to the "Diem" calendar?'))) {
      await fs.calendar({ from: addDays(ymd(), -1), to: addDays(ymd(), 14), events: [], alertMin: 0 });
    }
    last = '';
  }
}
