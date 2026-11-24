import { mkdir, writeFile } from 'node:fs/promises';
import { renderPage, root } from './page.mjs';

const html = await renderPage();
await mkdir(new URL('dist/', root), { recursive: true });
await Promise.all(['dist/index.html', 'index.html'].map(path => writeFile(new URL(path, root), html)));
console.log('Built index.html and dist/index.html (' + Buffer.byteLength(html) + ' bytes each).');
