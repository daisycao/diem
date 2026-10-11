// Claude Code 的 PostToolUse hook（实验功能「一个大脑」）：只要这次工具调用动到了 Diem 的工作目录，就在同步本里记一行。
// Claude Code PostToolUse hook (Labs → One brain): logs every tool call that touches the Diem folder.
// 不靠 AI 自觉：这是系统在记。装在 ~/.claude/settings.json 里，所有目录的会话都生效，但只记和工作目录有关的。
// 从 stdin 读 hook 的 JSON，什么都不输出、永远 exit 0，不打扰正常工作。
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncLog } from './synclog';

const ws = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const tool: string = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  const cwd: string = input.cwd ?? process.cwd();
  const inWs = (p: string) => { const r = relative(ws, p); return r && !r.startsWith('..') && !r.startsWith('/') ? r : null; };
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = ti.file_path ?? ti.notebook_path;
    const rel = file ? inWs(real(resolve(cwd, file))) : null;
    if (rel && !rel.startsWith('sync/')) syncLog(ws, { agent: 'claude', tool, files: [rel], session: input.session_id });
  } else if (tool === 'Bash') {
    const cmd: string = ti.command ?? '';
    const cwdIn = inWs(real(cwd)) !== null || real(cwd) === ws;
    const mentions = cmd.includes(ws) || cmd.includes('Diem/');
    // jot / day 这些自己会记，不重复
    const selfLogging = /bin\/(jot|day|review)\.mjs/.test(cmd);
    // 只记会改东西的命令：搬、删、写文件、跑脚本；看文件、查找这类只读的不算动作
    const writes = /(^|[;&|(]\s*)(mv|cp|rm|mkdir|touch|tee|ln|python3?|node|npx|npm|osascript|sed\s+-i|perl\s+-p?i|git\s+(commit|mv|rm|checkout|reset))\b/.test(cmd)
      || />>?\s*[^&\s]/.test(cmd.replace(/\d?>&\d/g, '').replace(/2>\s*\/dev\/null/g, ''));
    if ((cwdIn || mentions) && writes && !selfLogging) {
      syncLog(ws, { agent: 'claude', tool, cmd: cmd.replace(/\s+/g, ' ').slice(0, 200), session: input.session_id });
    }
  }
} catch { /* hook 出错也不能挡住正常工作 */ }
process.exit(0);
