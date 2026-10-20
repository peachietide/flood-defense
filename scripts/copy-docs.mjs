// 把构建产物复制到 docs/，供 GitHub Pages 托管。
// 用法：npm run build:pages
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'dist', 'index.html');
const to = resolve(root, 'docs', 'index.html');

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
console.log('已复制 dist/index.html → docs/index.html');
