// 右键菜单 / 下拉菜单
import { h } from './util';

export type MenuEntry = { label: string; action: () => void; hint?: string; checked?: boolean; danger?: boolean } | '-';

let open: HTMLElement | null = null;

export function closeMenu() {
  open?.remove();
  open = null;
}

export function showMenu(x: number, y: number, entries: MenuEntry[], head?: string) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  if (head) el.append(h('div', { class: 'menu-head' }, head));
  for (const e of entries) {
    if (e === '-') { el.append(h('div', { class: 'menu-sep' })); continue; }
    el.append(h('button', {
      class: 'menu-item' + (e.danger ? ' danger' : ''), type: 'button', role: 'menuitem',
      onclick: (ev: Event) => { ev.stopPropagation(); closeMenu(); e.action(); },
    }, h('span', { class: 'menu-check' }, e.checked ? '✓' : ''), h('span', { class: 'menu-label' }, e.label),
      e.hint ? h('span', { class: 'menu-hint' }, e.hint) : null));
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  el.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  open = el;
}

/** 只给人看的小浮层：一个标题，几行字，点别处就收 */
export function showInfo(anchor: Element, head: string, lines: string[]) {
  closeMenu();
  const el = h('div', { class: 'menu info' }, h('div', { class: 'menu-head' }, head),
    ...lines.map(l => h('div', { class: 'info-line' }, l)));
  document.body.append(el);
  const a = anchor.getBoundingClientRect(), r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(a.left, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.min(a.bottom + 4, innerHeight - r.height - 8) + 'px';
  open = el;
}

/** 在某个按钮下方弹出 */
export function menuBelow(anchor: Element, entries: MenuEntry[]) {
  const r = anchor.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, entries);
}

document.addEventListener('pointerdown', e => {
  if (open && !open.contains(e.target as Node)) closeMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);
