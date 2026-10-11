// 从照片导入一张手写纸：照片拖进窗口，或者「我的 → 从照片导入」。
// app 只把照片转成 JPEG 存进 photos/，认字、还原圈和箭头交给 Claude Code（app 里不接模型）。
// Import a handwritten page: drop a photo on the window, or Me → Import. The app only saves a JPEG
// into photos/; reading the handwriting is Claude Code's job (no model inside the app).
import { fs } from './bridge';
import { L } from './i18n';
import { ANIMALS } from './types';
import { h, toast } from './util';

const SAY_ZH = '导入这张纸';
const SAY_EN = 'Import my paper';

function done(path: string) {
  const say = L(`${SAY_ZH}：${path}`, `${SAY_EN}: ${path}`);
  fs.copy(say);
  const close = () => box.remove();
  const box = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === box) close(); } },
    h('div', { class: 'modal photo-done' },
      h('div', { class: 'modal-face' }, ANIMALS.拾拾.emoji),
      h('h3', null, L('照片收好了', 'Photo saved')),
      h('p', null, L('在工作目录里打开你的 AI（推荐 Claude Code），粘贴下面这句（已经复制好了）。拾拾会把它认成一张纸；晚上再拍一次同一张纸，打勾的就记成做完。',
        'Open your AI (Claude Code recommended) in your Diem folder and paste this (already copied). Pip turns it into a paper. Snap the same page again in the evening and ticked items are marked done.')),
      h('code', null, say),
      h('div', { class: 'modal-row' },
        h('button', { class: 'pill', type: 'button', onclick: () => fs.reveal(path) }, L('在访达里看', 'Show in Finder')),
        h('button', { class: 'pill primary', type: 'button', onclick: close }, L('好', 'OK')))));
  document.body.append(box);
}

/** 选一张照片导入 */
export async function importPhoto() {
  try {
    const r = await fs.importPhoto();
    if (r) done(r);
  } catch (e) { toast(String((e as Error).message ?? e)); }
}

/** 拖进窗口的图片 */
async function importDropped(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  try {
    const r = await fs.importPhoto(btoa(bin));
    if (r) done(r);
  } catch (e) { toast(String((e as Error).message ?? e)); }
}

export function initPhotoDrop() {
  const isImage = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file' && i.type.startsWith('image/'));
  addEventListener('dragover', e => {
    if (!isImage(e)) return;
    e.preventDefault();
    document.body.classList.add('photo-over');
  });
  addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('photo-over'); });
  addEventListener('drop', e => {
    document.body.classList.remove('photo-over');
    const f = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    importDropped(f);
  });
}
