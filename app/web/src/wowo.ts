// 喳喳 Zaza（实验功能）：按规则能做的提醒，app 自己做，不用 AI。
// 截止日前 2 天 / 前 1 天 / 当天、「不早于」到了、等别人该催了，各发一次 Mac 通知（早上 9 点以后）。
// 地点：按 Wi-Fi 名字认出你在哪（需要定位权限），也可以手动切；那里能做的事浮上来。
import { fs } from './bridge';
import { menuBelow, MenuEntry } from './menu';
import { render, S, saveUI } from './store';
import type { Item, Places } from './types';
import { ANIMALS, animalName } from './types';
import { IS_ZH, L } from './i18n';
import { $, addDays, DAY_TURN, fill, hm, nowMin, relDay, toast, ymd } from './util';

const SENT = '.diem/wowo.json';
const PLACES = '.diem/places.json';

/** key → 发出的时间（ISO）+ 说了什么 */
let sent: Record<string, { at: string; text: string }> = {};
let places: Places = { wifi: {}, names: IS_ZH ? ['在家', '办公室', '外面'] : ['Home', 'Office', 'Out'] };
let ssid: string | null = null;
let auth: 'ok' | 'asking' | 'denied' = 'asking';

// ───────── 地点 ─────────

const norm = (s: string) => s.replace(/^在/, '').trim().toLowerCase();

/** 现在在哪：今天手选的优先，其次按 Wi-Fi 认 */
export function currentPlace(): { name: string | null; how: 'manual' | 'wifi' | null } {
  if (!S.ui.labs?.place) return { name: null, how: null };
  const pick = S.ui.place;
  if (pick && pick.date === ymd()) return { name: pick.name, how: 'manual' };
  const byWifi = ssid ? places.wifi[ssid] : undefined;
  return byWifi ? { name: byWifi, how: 'wifi' } : { name: null, how: null };
}

/** 这件事和现在的地点：here 就在这能做；away 要去别处做；any 没有地点限制或者不知道在哪 */
export function placeFit(i: Item): 'here' | 'away' | 'any' {
  const now = currentPlace().name;
  if (!i.where || !now) return 'any';
  const a = norm(i.where), b = norm(now);
  return a.includes(b) || b.includes(a) ? 'here' : 'away';
}

async function refreshWifi() {
  try {
    const r = await fs.wifi();
    const before = currentPlace().name;
    ssid = r.ssid; auth = r.auth;
    if (currentPlace().name !== before) render();
  } catch { /* 浏览器调试时没有 */ }
}

function savePlaces() {
  fs.write(PLACES, JSON.stringify(places, null, 2) + '\n');
}

export function renderPlaceButton() {
  const p = currentPlace();
  fill($('#place')!, '📍 ', p.name ?? L('在哪？', 'Where?'));
  $('#place')!.title = p.name
    ? `${p.how === 'wifi' ? L(`按 Wi-Fi「${ssid}」认出来的`, `Recognized from Wi-Fi "${ssid}"`) : L('今天手选的', 'Picked today')}${L('；这里能做的事会浮上来', '; things you can do here float up')}`
    : ssid ? L(`这个 Wi-Fi（${ssid}）还没记成哪个地点`, `This Wi-Fi (${ssid}) isn't linked to a place yet`) : L('还不知道你在哪', "Don't know where you are yet");
}

function openPlace(anchor: Element) {
  const cur = currentPlace();
  const entries: MenuEntry[] = places.names.map(name => ({
    label: name, checked: cur.name === name,
    hint: cur.how === 'manual' && cur.name === name ? L('今天手选的', 'Picked today') : undefined,
    action: () => { S.ui.place = { date: ymd(), name }; saveUI(); render(); toast(L(`在${norm(name)}：这里能做的事浮上来了`, `At ${name}: things you can do here float up`)); },
  }));
  entries.push('-');
  if (ssid) {
    for (const name of places.names) {
      entries.push({
        label: L(`把 Wi-Fi「${ssid}」记成「${name}」`, `Wi-Fi "${ssid}" means "${name}"`), checked: places.wifi[ssid] === name,
        action: () => { places.wifi[ssid!] = name; savePlaces(); S.ui.place = undefined; saveUI(); render(); toast(L(`记住了：连上「${ssid}」就是${name}`, `Got it: "${ssid}" means ${name}`)); },
      });
    }
  } else {
    entries.push({
      label: auth === 'denied'
        ? L('读不到 Wi-Fi 名字：去「系统设置 › 隐私与安全性 › 定位服务」给 Diem 打开', "Can't read the Wi-Fi name: turn on Diem in System Settings › Privacy & Security › Location Services")
        : L('读不到 Wi-Fi 名字（第一次会问定位权限，只用来读 Wi-Fi 名字）', "Can't read the Wi-Fi name yet (asks for location access once; used only for the Wi-Fi name)"),
      action: () => refreshWifi(),
    });
  }
  if (S.ui.place) entries.push({ label: L('回到按 Wi-Fi 自动认', 'Back to Wi-Fi detection'), action: () => { S.ui.place = undefined; saveUI(); render(); } });
  menuBelow(anchor, entries);
}

// ───────── 提醒 ─────────

async function say(key: string, text: string) {
  if (sent[key]) return;
  const d = new Date();
  sent[key] = { at: d.toISOString(), text };
  await fs.write(SENT, JSON.stringify(sent, null, 2) + '\n');
  fs.notify(`${ANIMALS.喳喳.emoji} ${animalName('喳喳')}`, text, key);
}

function daysUntil(day: string, today: string) {
  return Math.round((new Date(day + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 864e5);
}

async function tick() {
  if (!S.ui.labs?.zaza) return;
  const today = ymd();
  if (nowMin() < 9 * 60) return;
  for (const i of S.backup.items) {
    if (i.done) continue;
    if (i.due) {
      const d = daysUntil(i.due, today);
      if (d >= 0 && d <= 2) await say(`due:${i.id}:${today}`, L(`「${i.title}」${d === 0 ? '今天' : relDay(i.due)}截止`, `"${i.title}" is due ${d === 0 ? 'today' : relDay(i.due).toLowerCase()}`));
      else if (d < 0) await say(`over:${i.id}`, L(`「${i.title}」已经过了截止日（${relDay(i.due)}）`, `"${i.title}" is past due (${relDay(i.due)})`));
    }
    if (i.notBefore === today) await say(`nb:${i.id}:${today}`, L(`今天浮上来了：「${i.title}」`, `Up today: "${i.title}"`));
    if (i.waiting?.nudge && i.waiting.nudge <= today) {
      const who = i.waiting.who || L('对方', 'them');
      await say(`nudge:${i.id}:${i.waiting.nudge}`, L(`该催一下${who}了：「${i.title}」${i.waiting.since < today ? `（从 ${relDay(i.waiting.since)} 等到现在）` : ''}`,
        `Time to nudge ${who}: "${i.title}"${i.waiting.since < today ? ` (waiting since ${relDay(i.waiting.since)})` : ''}`));
    }
  }
}

/** 今天喳喳说过的话，同步本里列出来 */
export function sentToday() {
  const today = ymd();
  return Object.values(sent)
    .filter(s => ymd(new Date(Date.parse(s.at) - DAY_TURN * 3600_000)) === today)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map(s => ({ time: hm(new Date(s.at).getHours() * 60 + new Date(s.at).getMinutes()), text: s.text }));
}

/** 在等别人：默认两天后催 */
export function startWaiting(i: Item) {
  const today = ymd();
  i.waiting = { who: i.waiting?.who ?? '', since: i.waiting?.since ?? today, nudge: i.waiting?.nudge ?? addDays(today, 2) };
}

export async function initWowo() {
  const s = await fs.read(SENT);
  if (s) try { sent = JSON.parse(s.text); } catch { sent = {}; }
  const p = await fs.read(PLACES);
  if (p) try { places = { ...places, ...JSON.parse(p.text) }; } catch { /* 用默认 */ }
  $('#place')!.addEventListener('click', e => openPlace(e.currentTarget as Element));
  if (S.ui.labs?.place) await refreshWifi();
  await tick();
  setInterval(tick, 60_000);
  setInterval(() => { if (S.ui.labs?.place) refreshWifi(); }, 120_000);
}

/** 刚在实验功能里打开喳喳：马上看一遍 */
export function startZaza() { tick(); }
