// 页面 ↔ 工作目录。
// 在 app 里走 Swift（WKScriptMessageHandlerWithReply）；在浏览器里调试时走 tools/dev-server.mjs 的 /fs。

export interface FileRead { text: string; mtime: number }
export interface WriteResult { ok: boolean; conflict?: boolean; mtime: number }
export interface Entry { name: string; dir: boolean; mtime: number }
export interface Info { workspace: string; version: string; native: boolean }

type Native = { postMessage(body: unknown): Promise<unknown> };
const native: Native | undefined = (window as any).webkit?.messageHandlers?.diem;

async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (native) return (await native.postMessage({ op, ...args })) as T;
  const r = await fetch('/fs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...args }),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error);
  return j as T;
}

export const fs = {
  info: () => call<Info>('info'),
  read: (path: string) => call<FileRead | null>('read', { path }),
  /** expect：上次看到的修改时间；-1 表示「应该还不存在」；不传就不检查 */
  write: (path: string, text: string, expect?: number) => call<WriteResult>('write', { path, text, expect }),
  append: (path: string, text: string) => call<WriteResult>('append', { path, text }),
  list: (path: string) => call<Entry[]>('list', { path }),
  /** 读成 data: 网址（笔记里的图） */
  data: (path: string) => call<string | null>('data', { path }),
  stat: () => call<Record<string, number>>('stat'),
  reveal: (path = '') => call<boolean>('reveal', { path }),
  /** 挪进系统废纸篓（扔掉的纸） */
  trash: (path: string) => call<boolean>('trash', { path }),
  openPath: (path: string) => call<boolean>('openPath', { path }),
  openURL: (url: string) => call<boolean>('openURL', { url }),
  chooseWorkspace: () => call<string | null>('chooseWorkspace'),
  /** 复制到系统剪贴板 */
  copy: async (text: string) => {
    if (native) return call<boolean>('copy', { text });
    navigator.clipboard?.writeText(text).catch(() => {});
    return call<boolean>('copy', { text });
  },
  /** Mac 通知（喳喳的提醒） */
  notify: (title: string, text: string, id?: string) => call<boolean>('notify', { title, text, id }),
  /** 当前 Wi-Fi 名字；没有定位权限时 ssid 是 null */
  wifi: () => call<{ ssid: string | null; auth: 'ok' | 'asking' | 'denied' }>('wifi'),
  /** 照片导入：不给 data 就弹选择框；存成 photos/日期-时间.jpg，返回相对路径（取消返回 null） */
  importPhoto: (data?: string) => call<string | null>('importPhoto', { data }),
  /** 系统日历权限（第一次会问） */
  calendarAccess: () => call<{ ok: boolean; message?: string }>('calendarAccess'),
  /** 把 from–to 这段的事件整段写进「Diem」日历 */
  calendar: (args: { from: string; to: string; events: unknown[]; alertMin: number }) => call<{ ok: boolean; message?: string }>('calendar', args),
};
