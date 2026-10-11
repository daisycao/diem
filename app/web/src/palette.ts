// 配色：六套墨色。默认「青木」，也就是 Logo 的竹青配晨光橙。
// 实验功能「跟着流日」：按当天的干支五行换一套，图个好心情。
// Palettes: six ink colors. Default is Diem green, the logo's bamboo green with a sunrise orange. The "follow the day" lab picks one
// from the day's Chinese stem-and-branch element, just for a good mood.
import { fs } from './bridge';
import { L } from './i18n';
import { S, saveUI } from './store';
import { ymd } from './util';

export type PaletteId = 'xuanshui' | 'moxuan' | 'canghai' | 'hanqing' | 'qingmu' | 'zhunuan';

type Palette = { zh: string; en: string; swatch: string; says: string; saysEn: string };
/** 顺序就是菜单顺序 */
const RAW: Record<PaletteId, Palette> = {
  qingmu: { zh: '青木', en: 'Diem green', swatch: '#2D5E3A', says: 'Diem 的颜色：竹青配一点晨光', saysEn: 'The Diem color: bamboo green with a little morning sun.' },
  xuanshui: { zh: '玄水', en: 'Ink', swatch: '#1b2a5e', says: '蓝黑墨水，最稳的颜色', saysEn: 'Blue-black ink. The steadiest one.' },
  moxuan: { zh: '墨玄', en: 'Night', swatch: '#101318', says: '夜里摊开一张纸', saysEn: 'A sheet of paper at night.' },
  canghai: { zh: '沧海', en: 'Ocean', swatch: '#0f4c81', says: '清凉的海蓝，给燥热的日子降温', saysEn: 'Cool sea blue for a hot, busy day.' },
  hanqing: { zh: '涵青', en: 'Teal', swatch: '#1f5f63', says: '心定、好推进', saysEn: 'Calm, and good for moving things along.' },
  zhunuan: { zh: '朱暖', en: 'Ember', swatch: '#8f4328', says: '一点暖色，适合表达、见人、发东西', saysEn: 'A little warmth for talking, meeting, shipping.' },
};
export const PALETTES = Object.fromEntries(Object.entries(RAW).map(([k, p]) =>
  [k, { name: L(p.zh, p.en), swatch: p.swatch, says: L(p.says, p.saysEn) }])) as Record<PaletteId, { name: string; swatch: string; says: string }>;

export const DEFAULT_PALETTE: PaletteId = 'qingmu';

const GAN = '甲乙丙丁戊己庚辛壬癸';
const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const WX_GAN = '木木火火土土金金水水';
const WX_ZHI = '水土木木土火火土金金土水';
const WX_EN: Record<string, string> = { 木: 'wood', 火: 'fire', 土: 'earth', 金: 'metal', 水: 'water' };

/** 日干支。1900-01-01 是甲戌日 */
export function dayGanzhi(day = ymd()): { gz: string; gan: string; zhi: string } {
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 1)) / 864e5);
  const i = (((10 + n) % 60) + 60) % 60;
  return { gz: GAN[i % 10] + ZHI[i % 12], gan: WX_GAN[i % 10], zhi: WX_ZHI[i % 12] };
}

/** 流日 → 配色：金旺用水、火燥用海蓝、土重用木、水来用青，其余一点暖色 */
export function byDay(day = ymd()): { id: PaletteId; why: string; gz: string } {
  const { gz, gan, zhi } = dayGanzhi(day);
  const el = L(`${gz}日 · ${gan}`, `${gz} day · ${WX_EN[gan]}`);
  const r = (id: PaletteId, zh: string, en: string) => ({ id, why: `${el}：${L(zh, en)}`, gz });
  if (gan === '金' && zhi === '金') return r('moxuan', '金气最旺，用最深的水', 'metal at its peak, so the deepest water');
  if (gan === '金') return r('xuanshui', '金重，用蓝黑的水化开', 'heavy metal, eased by blue-black water');
  if (gan === '火') return r('canghai', '火燥，用海蓝降温', 'dry fire, cooled by ocean blue');
  if (gan === '土' && zhi === '金') return r('xuanshui', '土金同来，用水通开', 'earth and metal together, opened up by water');
  if (gan === '土') return r('qingmu', '土重，用木疏一疏', 'heavy earth, loosened by wood');
  if (gan === '水') return r('hanqing', '水到了，用青接住', 'water arrives, caught by teal');
  if (zhi === '火') return r('canghai', '木火走得快，用水收一收', 'wood and fire run fast; water slows them');
  if (zhi === '金') return r('xuanshui', '木坐金上，用水通开', 'wood sits on metal; water bridges them');
  return r('zhunuan', '有帮有扶，加一点暖色', 'well supported, so a touch of warmth');
}

/** Claude Code 也可以写 fortune/palette.json 指定今天的配色 */
export interface Override { date: string; palette: PaletteId; why?: string }
let override: Override | null = null;

export async function loadOverride() {
  const r = await fs.read('fortune/palette.json');
  S.mtimes['fortune/palette.json'] = r?.mtime ?? 0;
  try { override = r ? JSON.parse(r.text) : null; } catch { override = null; }
}

/** 现在该用哪套，以及为什么。auto = 没手选（跟着默认或流日） */
export function current(): { id: PaletteId; why: string; auto: boolean } {
  const today = ymd();
  const pick = S.ui.palette;
  if (pick && pick.date === today && pick.id in PALETTES) return { id: pick.id as PaletteId, why: L('你今天手选的', 'Picked by you today'), auto: false };
  if (override && override.date === today && override.palette in PALETTES) {
    return { id: override.palette, why: override.why ?? L('AI 今天选的', 'Picked by your AI today'), auto: true };
  }
  if (S.ui.labs?.almanac) { const d = byDay(today); return { id: d.id, why: d.why, auto: true }; }
  const id = (S.ui.paletteDefault && S.ui.paletteDefault in PALETTES ? S.ui.paletteDefault : DEFAULT_PALETTE) as PaletteId;
  return { id, why: L('默认配色', 'Your default'), auto: true };
}

export function applyPalette() {
  document.documentElement.dataset.palette = current().id;
}

/** 关了「跟着流日」时手选就是默认；开着时手选只管今天 */
export function choosePalette(id: PaletteId | 'auto') {
  if (id === 'auto') S.ui.palette = undefined;
  else if (S.ui.labs?.almanac) S.ui.palette = { date: ymd(), id };
  else { S.ui.paletteDefault = id; S.ui.palette = undefined; }
  saveUI();
  applyPalette();
}
