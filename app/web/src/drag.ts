// 统一的拖动：纸上的块、清单条目、时间轴上的块，都走这里。
// 不用 HTML5 拖放：纸是缩放过的，原生拖放在 WKWebView 里也不稳。

export type Zone = 'paper' | 'list' | 'time';

export interface Track {
  onMove(e: PointerEvent, dx: number, dy: number): void;
  onEnd(e: PointerEvent, moved: boolean): void;
  onStart?(e: PointerEvent): void;
}

export let dragging = false;

export function track(down: PointerEvent, t: Track, threshold = 4) {
  const x0 = down.clientX, y0 = down.clientY;
  let moved = false;
  const move = (e: PointerEvent) => {
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!moved) {
      if (Math.hypot(dx, dy) < threshold) return;
      moved = true;
      dragging = true;
      document.body.classList.add('is-dragging');
      t.onStart?.(e);
    }
    t.onMove(e, dx, dy);
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('is-dragging');
    ghost(null);
    highlight(null);
    document.getElementById('tl-shadow')?.remove();
    t.onEnd(e, moved);
    // 让紧跟着的 click 事件知道这是一次拖动
    setTimeout(() => (dragging = false), 0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export function zoneAt(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null;
  return (el?.dataset.drop as Zone) ?? null;
}

let lit: Element | null = null;
export function highlight(zone: Zone | null) {
  const el = zone ? document.querySelector(`[data-drop="${zone}"]`) : null;
  if (el === lit) return;
  lit?.classList.remove('drop-on');
  el?.classList.add('drop-on');
  lit = el;
}

export function ghost(text: string | null, x = 0, y = 0) {
  const g = document.getElementById('ghost')!;
  if (text == null) { g.classList.remove('on'); return; }
  if (g.textContent !== text) g.textContent = text;
  g.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
  g.classList.add('on');
}
