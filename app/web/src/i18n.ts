// 中英双语 / Bilingual UI
// 语言跟系统走：原生那边在页面加载前写好 window.DIEM_LANG（'zh' / 'en'），没有就看 navigator.language。
// The UI follows the system language. The native shell sets window.DIEM_LANG before the page loads.
// · 代码里的文字写成 L('中文', 'English')。In code, write L('中文', 'English').
// · 存进文件的值（by: "拾拾"）不翻译，只在显示时换名字。Stored values are never translated, only displayed.

// 浏览器调试时可以用 ?lang=en / ?lang=zh 换语言 / in the browser, ?lang=en or ?lang=zh overrides
const urlLang = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
const lang: string = urlLang || (globalThis as any).DIEM_LANG
  || (/^zh/i.test((globalThis as any).navigator?.language ?? '') ? 'zh' : 'en');

export const IS_ZH = lang === 'zh';
export const L = (zh: string, en: string) => (IS_ZH ? zh : en);

if (typeof document !== 'undefined') document.documentElement.lang = IS_ZH ? 'zh-CN' : 'en';

/** index.html 里写死的文字：加载时按 data-l 换成英文 / static strings in index.html carry data-en */
export function translateStatic() {
  if (IS_ZH || typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>('[data-en]').forEach(el => { el.textContent = el.dataset.en!; });
  document.querySelectorAll<HTMLElement>('[data-en-title]').forEach(el => { el.title = el.dataset.enTitle!; });
  document.querySelectorAll<HTMLInputElement>('[data-en-ph]').forEach(el => { el.placeholder = el.dataset.enPh!; });
}
