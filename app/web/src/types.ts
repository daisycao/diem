import { L } from './i18n';
// 这一天 · 数据格式
// 工作目录里所有 JSON 文件的结构都在这里。app、jot 脚本、Claude Code 共用这一份。
// 改字段时同步更新 工作目录/CLAUDE.md 里的说明。

/** 谁最后动过：你自己，或者哪只小动物。文件里中文名、英文名都认（Pip = 拾拾）
 *  Who touched it last: you, or one of the crew. Files may use either name (Pip = 拾拾). */
/** 喳喳的旧名字：喔喔、望望，旧数据里可能还有 */
export type Actor = 'me' | '拾拾' | '妥妥' | '喳喳' | '闻闻' | '望望' | '喔喔' | 'Pip' | 'Toto' | 'Zaza' | 'Fetch';

type Animal = { emoji: string; zh: string; en: string; job: string; jobEn: string; line: string; lineEn: string };
const BASE: Record<'拾拾' | '妥妥' | '喳喳' | '闻闻', Animal> = {
  拾拾: { emoji: '🐿️', zh: '拾拾', en: 'Pip', job: '收', jobEn: 'gathers', line: '你掉下的每个念头，它都捡起来', lineEn: 'Picks up every scrap you drop.' },
  妥妥: { emoji: '🐘', zh: '妥妥', en: 'Toto', job: '排', jobEn: 'plans', line: '稳稳当当，什么都记得', lineEn: 'Steady, and never forgets.' },
  喳喳: { emoji: '🐦', zh: '喳喳', en: 'Zaza', job: '跟', jobEn: 'follows up', line: '有事要你跟，它叫一声', lineEn: 'Chirps when something needs you.' },
  闻闻: { emoji: '🐶', zh: '闻闻', en: 'Fetch', job: '找', jobEn: 'fetches', line: '你叫它，它才去找', lineEn: 'Sniffs out ideas — only when you call.' },
};
// 别名：不列出来，只让文件里的英文名、旧名字也能显示
const ALIAS: Record<string, keyof typeof BASE> = { Pip: '拾拾', Toto: '妥妥', Zaza: '喳喳', Fetch: '闻闻', 望望: '喳喳', 喔喔: '喳喳' };
for (const [k, v] of Object.entries(ALIAS)) Object.defineProperty(BASE, k, { value: BASE[v], enumerable: false });
export const ANIMALS = BASE as Record<Exclude<Actor, 'me'>, Animal>;
/** 显示用的名字：中文系统「拾拾」，英文系统「Pip」 */
export const animalName = (a: string) => { const x = (ANIMALS as any)[a] as Animal | undefined; return x ? L(x.zh, x.en) : a; };

// ───────── 就是那张纸：ideas/<paperId>.json ─────────

/** 纸是 A4 比例，逻辑尺寸固定 794 × 1123（96dpi 的 A4），坐标都用这个单位 */
export const PAPER_W = 794;
export const PAPER_H = 1123;

export interface Block {
  id: string;
  /** item 带方框；heading 是手写小标题；note 是没有方框的手写批注 */
  kind: 'item' | 'heading' | 'note';
  x: number;
  y: number;
  w: number;
  /** 第一行是正文，之后每一行是手写小字 */
  text: string;
  /** 打勾做完 */
  done?: boolean;
  /** 划掉：决定不做了，痕迹留着 */
  struck?: boolean;
  /** 打勾的时间（0.6 起才记），「收着的」按它分日子 */
  doneAt?: string;
  /** 圈起来 */
  circled?: boolean;
  /** 预计要多久，分钟。纸上在第一行末尾写「2H」「30min」就认成这个，字里不再留；丢到池塘时带过去 */
  estimate?: number;
  /** 顺手的事：不占一块时间（找张卡、打个电话约医生），不用写多久；靠地点、日子浮上来。纸上写「顺手」就是它 */
  errand?: boolean;
  /** 编号 1–9，显示成 ①–⑨ */
  num?: number;
  /** 拍纸导入时没认准，显示「？」；你改过一次就去掉，AI 不再改回 */
  guess?: boolean;
  by?: Actor;
  /** 你确认过：只有你亲手打上才算，AI 不改 */
  confirmed?: boolean;
  /** 从这块生出的行动（backup 条目 id） */
  links?: string[];
  /** 后来补进这张纸的（比如重拍原件时发现漏掉的）。对应的 memo 还没接受时，块显示成「补」的样子 */
  added?: { at: string; from: string; memo?: string };
  /** 挂着的笔记：工作目录里的 .md 路径，比如 notes/DK Eyewitness 清单.md；双击块弹出来看 */
  doc?: string;
  /** 手机录的原声：工作目录里的 .m4a 路径，比如 phone/audio/2026-09-26 1432.m4a；点「听」用系统播放器打开 */
  audio?: string;
  created?: string;
}

/** 块大概多高：按宽度估每行能写几个字，长的会折行（没有屏幕可量时用，比如 jot） */
export function estHeight(b: Pick<Block, 'text' | 'w'>): number {
  const perLine = Math.max(6, Math.floor((b.w - 30) / 17));
  const lines = b.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0) / perLine)), 0);
  return 12 + lines * 27;
}

/** 新块放哪：永远接在整张纸最下面（左栏），纸往下长，不塞进上面的空当。
 *  用户 9/27 定的：纸是无限画布、不打印了；新东西往下加，她自己往上拖。measure 给得出真实高度就用真实的 */
export function freeSpot(blocks: Block[], measure: (b: Block) => number = estHeight, _need = 60): { x: number; y: number; w: number } {
  const bottom = blocks.reduce((m, b) => Math.max(m, b.y + measure(b)), 110);
  return { x: 56, y: Math.round(bottom + 20), w: 360 };
}

export interface Arrow { id: string; from: string; to: string; by?: Actor }

/** 横分隔线 */
export interface Rule { id: string; y: number; x1: number; x2: number }

/** 闻闻递来的材料：放在纸旁边，你点「采用」才进纸 */
export interface SideCard {
  id: string;
  by: Actor;
  text: string;
  url?: string;
  created?: string;
}

/** 拾拾递的小纸条：你点「好」才生效 */
export interface Slip {
  id: string;
  by: Actor;
  text: string;
  /** 同意后要变成的 backup 条目（可带排程） */
  proposal?: Partial<Item> & { title: string };
  status?: 'open' | 'accepted' | 'declined';
  created?: string;
}

export interface Paper {
  id: string;
  title: string;
  created: string;
  blocks: Block[];
  arrows: Arrow[];
  rules: Rule[];
  side: SideCard[];
  slips: Slip[];
  /** 小动物整理过（只挪了位置）：不给每块挂角标，只在纸上方说一句「几点排过顺序」 */
  tidied?: { by: Actor; at: string; note?: string };
  /** 扔进纸箱的时间（ISO）。扔进纸箱就是存档：纸夹里不翻到它，「收着的 → 纸箱」里能拿回来或删掉。Claude Code 记东西别往这种纸上放 */
  archived?: string;
}

// ───────── backup 清单：lists/backup.json ─────────

export interface Plan {
  /** YYYY-MM-DD */
  date: string;
  /** 开始时间，距 0 点的分钟数 */
  start: number;
  /** 时长，分钟 */
  dur: number;
}

export interface Item {
  id: string;
  title: string;
  /** 行动 / 信息（信息是一个关注点，会被持续更新，没有方框） */
  type: 'action' | 'info';
  star?: boolean;
  /** 预计要多久，分钟（整件事的） */
  estimate?: number;
  /** 顺手的事：不占一块时间，不催你写多久，妥妥不排 */
  errand?: boolean;
  /** 做过的一截一截：「做了一截，剩下的改天」时，当时排的那块挪到这里，时间轴上留着打勾的记录 */
  pieces?: (Plan & { at: string })[];
  /** 还剩多少（0–1，比如 0.5 是还剩一半）。放上时间轴的长度 = 预计 × 还剩 */
  left?: number;
  /** 截止日：真正的死线 */
  due?: string;
  /** 希望做的日期：软目标，没做完只顺延，不算落后 */
  wish?: string;
  /** 时空限制：地点 */
  where?: string;
  /** 时空限制：不早于这天，没到就不出现在清单里 */
  notBefore?: string;
  repeat?: 'daily' | 'weekdays' | 'weekly' | null;
  /** 重复的样子：设成重复时记下，下一次照这个建，不照当天改过的（那天的标题、备注、时长只算那天） */
  repeatOf?: RepeatTemplate;
  /** 排进时间轴 */
  plan?: Plan | null;
  /** 以前排过的位置，改期时留下 */
  history?: (Plan & { at: string })[];
  done?: boolean;
  doneAt?: string;
  note?: string;
  /** 来自哪张纸的哪一块 */
  source?: { paper: string; block: string } | null;
  /** 等一等：在等别人回复 / 决定。since 开始等的那天，nudge 哪天该催 */
  waiting?: { who: string; since: string; nudge?: string } | null;
  by?: Actor;
  confirmed?: boolean;
  created?: string;
  updated?: string;
}

export interface Backup { items: Item[] }

// ───────── memo/*.json：AI 每次改动的说明 ─────────

export interface Change {
  /** 改的是哪个文件，比如 lists/backup.json、ideas/paper-20260925.json */
  file: string;
  /** paper：改的是纸本身的字段（比如 tidied），id 是纸 id */
  kind: 'item' | 'block' | 'arrow' | 'rule' | 'paper';
  id: string;
  /** 给人看的一句话 */
  label: string;
  /** 这处改动是为了什么，同一目的的改动放一组，比如「归到 工作 · 这几天」「做完了，沉到底」 */
  group?: string;
  /** 改之前这几个字段的值；null 表示这是 AI 新建的 */
  before: Record<string, unknown> | null;
  /** 改之后；null 表示 AI 删掉了（before 里要存完整对象） */
  after: Record<string, unknown> | null;
  reverted?: boolean;
  /** 撤回时发现你之后亲手改过（或者已经做完了），留着没动 */
  kept?: boolean;
  /** 提议被照做了 */
  applied?: boolean;
}

/** AI 改完之后，你又动过这样东西没有：after 里的字段（不算 by / updated）和现在对不上，或者后来打了勾。
 *  动过的就不该按 before 撤回，不然会把你后来写的盖掉（10/3 午饭那次就是这样丢的） */
export function editedSince(cur: Record<string, unknown>, after: Record<string, unknown>): 'done' | 'edited' | null {
  if (cur.done && !after.done) return 'done';
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const [k, v] of Object.entries(after)) {
    if (k === 'by' || k === 'updated') continue;
    if (!same(cur[k], v)) return 'edited';
  }
  return null;
}

export interface Memo {
  id: string;
  by: Actor;
  /** ISO 时间 */
  time: string;
  /** 一句话：这批动了什么 */
  title: string;
  /** 为什么这样排 / 这样整理 */
  why?: string;
  /** proposed：大事先提议，文件还没改，等你点头；declined：你说不要 */
  status: 'pending' | 'accepted' | 'reverted' | 'proposed' | 'declined';
  /** 大整理前存的版本，app 里可以一键回去 */
  restore?: string;
  changes: Change[];
}

// ───────── .diem/ui.json：界面状态，只是方便 ─────────

export interface UIState {
  mode: 'think' | 'plan';
  cur?: string;
  collapsed: { paper: boolean; list: boolean; time: boolean };
  widths: { paperPlan: number; listThink: number; time: number };
  /** 今天手选的配色；不是今天的就忽略，跟着流日 */
  palette?: { date: string; id: string };
  /** 手动选的地点（只管当天）；没选就按 Wi-Fi 猜 */
  place?: { date: string; name: string };
  /** 关了「跟着流日」时的默认配色 */
  paletteDefault?: string;
  /** 实验功能：默认都关着 / Labs, all off by default */
  labs?: Labs;
  /** 写进系统日历 / Write the timeline to the system calendar */
  calendar?: { on: boolean; alertMin?: number };
  /** 第一次打开的引导看过了 */
  onboarded?: boolean;
}

export interface Labs {
  /** 一个大脑：同步本 + 共识 */
  brain?: boolean;
  /** 地点：按 Wi-Fi 认在哪 */
  place?: boolean;
  /** 喳喳：截止日、该催了的 Mac 通知 */
  zaza?: boolean;
  /** 配色跟着流日 */
  almanac?: boolean;
  /** 电脑使用记录（时间轴左边细条） */
  usage?: boolean;
}

// ───────── sync/YYYY-MM-DD.jsonl：同步本，AI 在工作目录里的每个动作一行 ─────────

export interface SyncLine {
  /** ISO 时间 */
  t: string;
  /** claude / codex / ai；me = 你在知新 Anew 里动的；app 兜底发现的没报备改动是 unknown */
  agent: 'claude' | 'codex' | 'ai' | 'me' | 'unknown';
  /** 工具名：Write / Edit / Bash / jot / day …… */
  tool: string;
  /** 动到的文件（相对工作目录） */
  files?: string[];
  /** 跑的命令（截断） */
  cmd?: string;
  session?: string;
  /** app 发现文件被改了，但同步本里没有对应记录 */
  unreported?: boolean;
}

// ───────── phone/inbox/<id>.json：手机记的一笔，「这一天」收下后放到当前那张纸上 ─────────

export interface PhoneNote {
  id: string;
  /** 手机上记下的时间，ISO */
  time: string;
  kind: 'text' | 'audio';
  text?: string;
  /** 录音：phone/audio/ 下的 .m4a */
  audio?: string;
  /** 录音时长，秒 */
  dur?: number;
  /** 已经放到纸上了（app 写回），不再重复放 */
  placed?: { paper: string; block: string; at: string };
}

// ───────── .diem/places.json：Wi-Fi 名字 → 地点 ─────────

export interface Places { wifi: Record<string, string>; names: string[] }

export interface RepeatTemplate {
  title: string;
  note?: string;
  estimate?: number;
  /** 时间轴上的位置，没排过就没有 */
  start?: number;
  dur?: number;
}
