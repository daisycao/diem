// 浏览器调试用：静态文件 + /fs 接口，语义和 Swift 外壳一致。
// 默认操作一份临时拷贝，别动真的工作目录：DIEM_WS=/path node tools/dev-server.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web/dist');
const ws = process.env.DIEM_WS;
if (!ws) { console.error('请设置 DIEM_WS'); process.exit(1); }
const port = Number(process.env.PORT ?? 5178);

const resolve = rel => {
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error('bad path ' + rel);
  return join(ws, rel);
};
const mt = p => (existsSync(p) ? statSync(p).mtimeMs / 1000 : null);

function walk(dir, base, out) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith('.') || n === 'bin') continue;
    const p = join(dir, n), rel = base ? `${base}/${n}` : n;
    if (statSync(p).isDirectory()) walk(p, rel, out);
    else if (/\.(json|md|jsonl|html)$/.test(n)) out[rel] = mt(p);
  }
  return out;
}

function handle(b) {
  const p = b.path ? resolve(b.path) : ws;
  switch (b.op) {
    case 'info': mkdirSync(ws, { recursive: true }); return { workspace: ws, version: 'dev', native: false };
    case 'read': return existsSync(p) ? { text: readFileSync(p, 'utf8'), mtime: mt(p) } : null;
    case 'write': {
      if (typeof b.expect === 'number') {
        const now = mt(p);
        if (b.expect < 0 ? now != null : now == null || Math.abs(now - b.expect) > 0.0005) return { ok: false, conflict: true, mtime: now ?? 0 };
      }
      mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, b.text); return { ok: true, mtime: mt(p) };
    }
    case 'append': mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, b.text); return { ok: true, mtime: mt(p) };
    case 'list': return existsSync(p) ? readdirSync(p).filter(n => !n.startsWith('.')).sort().map(n => ({ name: n, dir: statSync(join(p, n)).isDirectory(), mtime: mt(join(p, n)) })) : [];
    case 'data': {
      if (!existsSync(p)) return null;
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
    }
    case 'trash': {
      if (!existsSync(p)) return false;
      const to = join(ws, '.trash', `${Date.now()}-${p.split('/').pop()}`);
      mkdirSync(dirname(to), { recursive: true }); renameSync(p, to); return true;
    }
    case 'stat': return walk(ws, '', {});
    case 'copy': console.log('[复制]', b.text); return true;
    case 'notify': console.log('[通知]', b.title, b.text); return true;
    case 'wifi': return { ssid: process.env.DIEM_WIFI ?? null, auth: 'ok' };
    default: return true;
  }
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/fs') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try { res.end(JSON.stringify(handle(JSON.parse(body)))); }
      catch (e) { res.end(JSON.stringify({ error: String(e.message) })); }
    });
    return;
  }
  const path = req.url.split('?')[0];
  const f = join(dist, path === '/' ? 'index.html' : path);
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(port, () => console.log(`http://localhost:${port}  (工作目录：${ws})`));
