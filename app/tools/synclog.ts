// 命令行工具往同步本（sync/日期.jsonl）追加一行。hook、jot、day、huahua、compress 共用。
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncLine } from '../web/src/types';

const pad = (n: number) => String(n).padStart(2, '0');

export function isoNow(d = new Date()) {
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** 谁在跑：Claude Code 会设 CLAUDECODE，Codex 会设 CODEX_* */
export function agentNow(): SyncLine['agent'] {
  if (process.env.CLAUDECODE) return 'claude';
  if (Object.keys(process.env).some(k => k.startsWith('CODEX_'))) return 'codex';
  return 'ai';
}

export function syncLog(ws: string, line: Omit<SyncLine, 't' | 'agent'> & Partial<Pick<SyncLine, 'agent' | 't'>>) {
  const t = line.t ?? isoNow();
  const full: SyncLine = { t, agent: line.agent ?? agentNow(), ...line } as SyncLine;
  mkdirSync(join(ws, 'sync'), { recursive: true });
  appendFileSync(join(ws, `sync/${t.slice(0, 10)}.jsonl`), JSON.stringify(full) + '\n');
}
