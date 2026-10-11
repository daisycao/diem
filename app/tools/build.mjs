// 把 web/src/*.ts 打包成 web/dist/app.js，连同 index.html、style.css 放进 web/dist/
// 再把 tools/*.ts 打包成 web/dist/bin/ 下的命令；app 每次打开时拷进工作目录的 bin/
// Bundles the web UI into web/dist/, and the CLI tools into web/dist/bin/ (copied into the Diem folder by the app).
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web/dist');
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'web/src/main.ts')],
  bundle: true, format: 'iife', target: 'safari16', outfile: join(dist, 'app.js'),
  sourcemap: 'inline', logLevel: 'warning',
});
cpSync(join(root, 'web/index.html'), join(dist, 'index.html'));
cpSync(join(root, 'web/style.css'), join(dist, 'style.css'));

// jot 记下来、day 日报素材、review 日报网页、sync-hook 同步本（实验功能）
const out = process.env.DIEM_WS ? join(process.env.DIEM_WS, 'bin') : join(dist, 'bin');
for (const name of ['jot', 'day', 'sync-hook', 'review']) {
  await build({
    entryPoints: [join(root, `tools/${name}.ts`)],
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(out, `${name}.mjs`),
    banner: { js: '#!/usr/bin/env node' }, logLevel: 'warning',
  });
}
console.log('built web/dist + bin/{jot,day,sync-hook,review}.mjs');
