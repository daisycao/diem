// 这一天 Diem · 今日视图：纸 | 池塘 | 时间轴 / Today: paper | pond | timeline
import { fs } from './bridge';
import { closeDetail, detailOpen, renderDetail } from './detail';
import { closeDoc, docOpen } from './doc';
import { initList, renderList } from './list';
import { renderMemos } from './memo';
import { menuBelow, type MenuEntry } from './menu';
import { copySelection, focusBlock, initPaper, newPaper, paperKey, renderPaper, saveVersionNow } from './paper';
import { applyPalette, byDay, choosePalette, current, dayGanzhi, loadOverride, PALETTES, PaletteId } from './palette';
import { extraWatch, flush, loadAll, redo, render, S, saveUI, setRenderer, startWatching, undo } from './store';
import { initTimeline, renderTimeline } from './timeline';
import { ANIMALS } from './types';
import { consensusStatus, initConsensus, toggleConsensus } from './consensus';
import { closeReview, initReview, reviewOpen } from './review';
import { initShelf, renderShelf, toggleShelf } from './shelf';
import { importPhoto, initPhotoDrop } from './photo';
import { setCalendar, syncCalendar } from './calendar';
import { maybeOnboard, showCrew } from './welcome';
import { IS_ZH, L, translateStatic } from './i18n';
import type { Labs } from './types';
import { initSync, loadSync, syncStatus, toggleSync } from './sync';
import { initWowo, renderPlaceButton, startZaza } from './wowo';
import { $, dayLabel, fill, h, isoNow, toast, ymd } from './util';

type Col = 'paper' | 'list' | 'time';

// ───────── 布局 ─────────

function layoutCols() {
  const { mode, collapsed, widths } = S.ui;
  const order: Col[] = mode === 'think' ? ['paper', 'list', 'time'] : ['list', 'paper', 'time'];
  const flex = order.find(c => !collapsed[c]);
  const size = (c: Col) => {
    if (collapsed[c]) return '34px';
    if (c === flex) return c === 'paper' ? 'minmax(460px, 1fr)' : 'minmax(300px, 1fr)';
    if (c === 'paper') return `${widths.paperPlan}px`;
    if (c === 'list') return `${widths.listThink}px`;
    return `${widths.time}px`;
  };
  const app = $('#cols')!;
  app.style.gridTemplateColumns = `${size('paper')} 6px ${size('list')} 6px ${size('time')}`;
  for (const c of ['paper', 'list', 'time'] as Col[]) $(`#col-${c}`)!.classList.toggle('collapsed', collapsed[c]);
  document.body.dataset.mode = mode;
}

function initResizers() {
  document.querySelectorAll<HTMLElement>('.rz').forEach(rz => {
    rz.addEventListener('pointerdown', e => {
      e.preventDefault();
      const left = rz.dataset.rz === '1';
      const { mode, widths } = S.ui;
      // 左边那根调纸（摆今天）或清单（摊开想）；右边那根调时间轴
      const key: keyof typeof widths = !left ? 'time' : mode === 'plan' ? 'paperPlan' : 'listThink';
      const sign = key === 'paperPlan' ? 1 : -1;
      const x0 = e.clientX, w0 = widths[key];
      const move = (ev: PointerEvent) => {
        widths[key] = Math.max(240, Math.min(900, w0 + sign * (ev.clientX - x0)));
        layoutCols();
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        document.body.classList.remove('is-resizing');
        saveUI();
        render();
      };
      document.body.classList.add('is-resizing');
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  });
}

function setMode(mode: 'think' | 'plan') {
  S.ui.mode = mode;
  if (mode === 'plan') { S.ui.collapsed.list = false; S.ui.collapsed.time = false; }
  else S.ui.collapsed.paper = false;
  saveUI();
  render();
}

function toggleCol(c: Col) {
  S.ui.collapsed[c] = !S.ui.collapsed[c];
  saveUI();
  render();
}

// ───────── 顶部 ─────────

/** 今日视图的开场词：事多出「元气」，空闲多出「逍遥」，挑不出来就随机 */
function openingWord(): string {
  const today = ymd();
  const planned = S.backup.items.filter(i => i.plan?.date === today).reduce((s, i) => s + i.plan!.dur, 0);
  const [busy, easy, pool] = IS_ZH
    ? ['元气', '逍遥', ['日日是好日', '自在', '元气', '逍遥']]
    : ['Full of beans', 'Easy does it', ['Every day a good day', 'At ease', 'Full of beans', 'Easy does it']];
  if (planned >= 300) return busy as string;
  if (planned > 0 && planned <= 90) return easy as string;
  const seed = today.split('-').reduce((s, n) => s + Number(n), 0);
  return (pool as string[])[seed % pool.length];
}

let word = '';
let wordDay = '';

function renderTop() {
  if (wordDay !== ymd()) { word = openingWord(); wordDay = ymd(); }
  const gz = S.ui.labs?.almanac ? ` ${dayGanzhi().gz}${L('日', '')}` : '';
  $('#title-line')!.textContent = `${L('这一天', 'Diem')} · ${dayLabel(ymd())}${gz} · ${word}`;
  applyPalette();
  renderMe();
  document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.ui.mode)));
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => b.setAttribute('aria-pressed', String(!S.ui.collapsed[b.dataset.toggle as Col])));
  $('#place')!.hidden = !S.ui.labs?.place;
}

// ───────── 我的：不常用的收在一起 ─────────

/** 按钮上挂今天的配色圆点；有推测等看，挂一个小红点 */
function renderMe() {
  const p = PALETTES[current().id];
  const guesses = S.ui.labs?.brain ? consensusStatus() : 0;
  const nag = guesses ? [L(`${guesses} 条推测等你看`, `${guesses} guesses waiting for you`)] : [];
  fill($('#me')!, h('span', { class: 'swatch', style: { background: p.swatch } }), L('我的', 'Me'), nag.length ? h('span', { class: 'dot-red' }) : null);
  $('#me')!.title = nag.length ? nag.join('；') : L(`今天${p.name} · 配色、日历、实验功能、工作目录`, `${p.name} today · colors, calendar, labs, folder`);
}

/** 右边的面板一次只开一个 */
function only(which: 'sync' | 'consensus') {
  toggleShelf(false);
  if (which === 'sync') { toggleConsensus(false); toggleSync(); } else { toggleSync(false); toggleConsensus(); }
}

const LABS: [keyof Labs, string, string, string, string][] = [
  ['brain', '一个大脑：同步本 + 共识', 'One brain: sync log + shared understanding', '记下 AI 在工作目录里的每一步；它对你的理解要你认可', 'Logs every step the AI takes here; its guesses about you wait for your OK'],
  ['zaza', '🐦 喳喳：截止日、该催了的提醒', '🐦 Zaza: due-date and nudge alerts', 'Mac 通知，早上 9 点以后', 'Mac notifications, after 9 am'],
  ['place', '📍 地点：按 Wi-Fi 认你在哪', '📍 Places: know where you are by Wi-Fi', '那里能做的事浮上来；要定位权限，只读 Wi-Fi 名字', 'Things you can do there float up; needs location access, reads only the Wi-Fi name'],
  ['almanac', '配色跟着流日', 'Colors follow the Chinese almanac', '按当天干支五行换一套配色', "Picks a palette from the day's stem-and-branch element"],
];

function toggleLab(k: keyof Labs) {
  S.ui.labs = { ...(S.ui.labs ?? {}), [k]: !S.ui.labs?.[k] };
  saveUI();
  render();
  if (k === 'zaza' && S.ui.labs.zaza) startZaza();
}

function openLabs(anchor: Element) {
  menuBelow(anchor, [
    { label: L('实验功能：默认都关着，想试就打开', 'Labs: all off by default, turn on what you like'), action: () => {} },
    '-',
    ...LABS.map(([k, zh, en, hz, he]) => ({ label: L(zh, en), hint: L(hz, he), checked: !!S.ui.labs?.[k], action: () => toggleLab(k) })),
  ]);
}

function openCalendar(anchor: Element) {
  const on = !!S.ui.calendar?.on;
  const alert = S.ui.calendar?.alertMin ?? 5;
  menuBelow(anchor, [
    {
      label: L('写进系统日历', 'Write to Calendar'), checked: on,
      hint: L('排上时间轴的事写进「Diem」日历，iPhone 通过 iCloud 也能看到、到点提醒', 'Timeline blocks go to a "Diem" calendar; your iPhone gets them via iCloud, with alerts'),
      action: async () => { await setCalendar(!on); render(); },
    },
    ...(on ? ['-' as const, ...[0, 5, 10, 15].map(m => ({
      label: m ? L(`提前 ${m} 分钟提醒`, `Alert ${m} min before`) : L('不提醒', 'No alert'), checked: alert === m,
      action: () => { S.ui.calendar = { on: true, alertMin: m }; saveUI(); syncCalendar(true); },
    }))] : []),
    '-',
    { label: L('只往日历里写；在日历里改了不会改回来', 'One way only: edits in Calendar do not come back'), action: () => {} },
  ]);
}

async function openMe(anchor: Element) {
  const cur = current();
  const p = PALETTES[cur.id];
  const brain = !!S.ui.labs?.brain;
  const { n, bad } = brain ? syncStatus() : { n: 0, bad: 0 };
  const guesses = brain ? consensusStatus() : 0;
  const ws = S.info?.workspace ?? '';
  menuBelow(anchor, [
    { label: L(`配色 · ${p.name}`, `Colors · ${p.name}`), hint: cur.why, action: () => openPalette(anchor) },
    { label: L('写进系统日历', 'Calendar'), hint: S.ui.calendar?.on ? L('开着', 'On') : L('关着', 'Off'), action: () => openCalendar(anchor) },
    { label: L('📷 从照片导入一张手写纸…', '📷 Import a handwritten page…'), action: () => importPhoto() },
    ...(brain ? [
      '-' as const,
      { label: L(`同步 · 今天 AI 做了 ${n} 件`, `Sync log · AI did ${n} things today`), hint: bad ? L(`${bad} 处没对上`, `${bad} unmatched`) : '', action: () => only('sync') },
      { label: L('共识 · AI 对你的理解', 'Shared understanding'), hint: guesses ? L(`${guesses} 条推测等你看`, `${guesses} guesses waiting`) : '', action: () => only('consensus') },
    ] : []),
    '-',
    { label: L('🧪 实验功能…', '🧪 Labs…'), action: () => openLabs(anchor) },
    { label: L('认识小伙伴', 'Meet the crew'), action: () => showCrew() },
    '-',
    { label: L('在访达里打开工作目录', 'Show folder in Finder'), hint: ws.split('/').at(-1) ?? '', action: () => fs.reveal() },
    ...(S.info?.native ? [{ label: L('换一个工作目录…', 'Use another folder…'), action: () => (window as any).__diem.chooseWorkspace() }] : []),
    '-',
    { label: `${L('这一天', 'Diem')} · Carpe diem  v${S.info?.version ?? ''}${S.info?.native ? '' : L('（浏览器调试）', ' (browser)')}`, action: () => {} },
  ]);
}

/** 在 Claude Code 里说的话。lab：只有打开那个实验功能才列出来 */
const SAY: { who: string; zh: string; en: string; what: string; whatEn: string; lab?: keyof Labs }[] = [
  { who: '拾拾', zh: '导入这张纸', en: 'Import my paper', what: '把 photos/ 里新拍的手写纸认成一张纸；晚上重拍就把打勾的记成做完', whatEn: 'Turns the newest photo in photos/ into a paper; an evening photo marks ticked items done' },
  { who: '妥妥', zh: '妥妥，帮我把今天排一下', en: 'Toto, plan my day', what: '按今日池塘排进时间轴，附 memo，可以撤回', whatEn: 'Puts pond items on the timeline, with a memo you can undo' },
  { who: '妥妥', zh: '写今天的日报', en: 'Write my daily review', what: '妥妥盘一盘这一天：做成了什么、时间去哪了、明天怎么排', whatEn: 'Toto reviews the day: what got done, where time went, what is next' },
  { who: '拾拾', zh: '大整理', en: 'Tidy up', what: '拾拾把纸上乱的块归类排好；整理前自动存一版，能回去', whatEn: 'Pip groups and arranges the paper; a version is saved first so you can go back' },
  { who: '拾拾', zh: '记下来：……', en: 'jot: ……', what: '念头直接落到当前这张纸上', whatEn: 'A thought lands on the current paper' },
  { who: '拾拾', zh: '记到清单里：……', en: 'add to pond: ……', what: '直接丢到池塘里', whatEn: 'Straight into the pond' },
  { who: '闻闻', zh: '闻闻，帮我找一些新灵感', en: 'Fetch, find me some ideas', what: '找到的放在纸旁边，你采用了才进纸', whatEn: 'Finds go beside the paper; nothing lands unless you adopt it' },
  { who: '喳喳', zh: '喳喳，看看有什么快到期、很久没动的', en: "Zaza, what's due or stuck?", what: '只提醒，不改东西', whatEn: 'Only reminds, changes nothing', lab: 'zaza' },
];

function openSay(anchor: Element) {
  menuBelow(anchor, SAY.filter(x => !x.lab || S.ui.labs?.[x.lab]).map(x => {
    const phrase = L(x.zh, x.en), what = L(x.what, x.whatEn);
    return {
      label: `${ANIMALS[x.who as keyof typeof ANIMALS].emoji} 「${phrase}」`,
      hint: what,
      action: () => {
        // 要接着打字的（「记下来：……」）只复制开头；其余连说明一起复制，交给 AI 的指令更清楚
        const say = phrase.includes('……') ? phrase.replace('……', '') : `${phrase}${L('：', ': ')}${what}`;
        navigator.clipboard?.writeText(say).catch(() => {});
        toast(L(`在工作目录里打开你的 AI（推荐 Claude Code），粘贴「${say}」（已复制）`, `Open your AI (Claude Code recommended) in your Diem folder and paste "${say}" (copied)`));
      },
    };
  }));
}

function openPalette(anchor: Element) {
  const cur = current();
  const almanac = !!S.ui.labs?.almanac;
  const auto = cur.auto;
  const ids = Object.keys(PALETTES) as PaletteId[];
  menuBelow(anchor, [
    ...(almanac ? [{ label: L(`跟着流日 · 今天${PALETTES[byDay().id].name}`, `Follow the almanac · ${PALETTES[byDay().id].name} today`), hint: byDay().why, checked: auto, action: () => { choosePalette('auto'); render(); } }, '-' as const] : []),
    ...ids.map(id => ({
      label: PALETTES[id].name, hint: PALETTES[id].says,
      checked: almanac ? !auto && cur.id === id : cur.id === id,
      action: () => { choosePalette(id); render(); toast(`${PALETTES[id].name}${L('：', ': ')}${PALETTES[id].says}`); },
    })),
    ...(almanac ? ['-' as const, { label: L('手选只管今天，明天回到跟着流日', 'A pick lasts today; tomorrow follows the almanac again'), action: () => {} }] : []),
  ]);
}

// ───────── 键盘 ─────────

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  const typing = t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  if (e.key === 'Escape' && docOpen()) { closeDoc(); return; }
  if (docOpen()) return;
  if (e.key === 'Escape' && reviewOpen()) { closeReview(); return; }
  if (reviewOpen()) return;
  if (e.key === 'Escape' && detailOpen() && !typing) { closeDetail(); return; }
  if (typing) return;
  if (paperKey(e)) { e.preventDefault(); return; }
  // 浏览器调试时没有原生菜单，这几个快捷键在这里补上
  if (!S.info?.native && e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'c' && !String(getSelection() ?? '').length && copySelection()) e.preventDefault();
    else if (k === '1' && !e.altKey) { e.preventDefault(); setMode('think'); }
    else if (k === '2' && !e.altKey) { e.preventDefault(); setMode('plan'); }
  }
}

/** 撤销：正在打字就撤销文字，否则撤销上一步操作 */
function smartUndo(redoIt = false) {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
    document.execCommand(redoIt ? 'redo' : 'undo');
    return;
  }
  redoIt ? redo() : undo();
}

// ───────── 启动 ─────────

function renderAll() {
  layoutCols();
  renderTop();
  renderMemos();
  renderShelf();
  renderPlaceButton();
  if (!S.ui.collapsed.paper) renderPaper();
  if (!S.ui.collapsed.list) renderList();
  if (!S.ui.collapsed.time) renderTimeline();
  renderDetail();
  syncCalendar();
}

async function boot() {
  translateStatic();
  setRenderer(renderAll);
  extraWatch['fortune/palette.json'] = loadOverride;
  try {
    await loadAll();
    await loadOverride();
    await loadSync();
  } catch (err) {
    document.body.append(h('div', { class: 'fatal' }, L('读不到工作目录：', "Can't read the Diem folder: ") + String((err as Error)?.message ?? err)));
    return;
  }
  initPaper();
  initList();
  initTimeline();
  initResizers();
  initSync();
  initShelf();
  initReview();
  initPhotoDrop();
  await initConsensus();
  await initWowo();
  addEventListener('diem:preview', () => render());

  document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode as 'think' | 'plan')));
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleCol(b.dataset.toggle as Col)));
  document.querySelectorAll<HTMLElement>('.rail').forEach(r => r.addEventListener('click', () => toggleCol(r.dataset.col as Col)));
  $('#say')!.addEventListener('click', e => openSay(e.currentTarget as Element));
  $('#me')!.addEventListener('click', e => openMe(e.currentTarget as Element));
  addEventListener('keydown', onKey);
  addEventListener('beforeunload', () => { flush(); });

  // 过了午夜，时间轴跟着翻到新的一天
  let lastToday = ymd();
  setInterval(() => {
    const t = ymd();
    if (t !== lastToday) { if (S.day === lastToday) S.day = t; lastToday = t; render(); }
  }, 30_000);

  (window as any).__diem = {
    flush, undo: () => smartUndo(), redo: () => smartUndo(true),
    // ⌘C：在打字或选了文字就照常复制文字；否则复制选中的块
    copy: () => {
      const a = document.activeElement as HTMLElement | null;
      const typing = a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
      if (typing || String(getSelection() ?? '').length) { document.execCommand('copy'); return; }
      copySelection();
    },
    newPaper, saveVersion: saveVersionNow, importPhoto,
    // 从别的 app（比如 Anew）跳过来：diem://focus?paper=…&block=…
    focus: (paper: string, block: string) => focusBlock(paper, block),
    think: () => setMode('think'), plan: () => setMode('plan'),
    togglePaper: () => toggleCol('paper'), toggleList: () => toggleCol('list'), toggleTime: () => toggleCol('time'),
    today: () => { S.day = ymd(); render(); },
    reload: async () => { await flush(); await loadAll(); await loadOverride(); render(); toast(L('重新读了一遍文件', 'Reloaded from disk')); },
    chooseWorkspace: async () => {
      await flush();
      const p = await fs.chooseWorkspace();
      if (p) { await loadAll(); render(); toast(L('换好了工作目录', 'Switched folder')); }
    },
  };

  renderAll();
  startWatching();
  // 留个记号：app 最近一次打开的时间（Claude Code 也能据此知道你今天开没开过）
  fs.write('.diem/app.json', JSON.stringify({ lastOpen: isoNow(), version: S.info?.version, papers: S.papers.size, items: S.backup.items.length }, null, 2) + '\n');
  setTimeout(() => { $('#splash')?.classList.add('gone'); maybeOnboard(); }, 900);
  if (S.ui.calendar?.on) syncCalendar();
}

boot();
