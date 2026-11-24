import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { renderPage, root } from './page.mjs';

const args = process.argv.slice(2);
const preview = args.includes('--preview');
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const port = Number(option('--port', preview ? 4173 : 5173));
const host = option('--host', '127.0.0.1');
const base = option('--base', '/');
if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !/^\/(?:[\w-]+\/)*$/.test(base)) {
  throw new Error('Expected a host, port 1–65535, and a base such as /one-stroke-street/.');
}
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = (req.url || '/').split('?')[0];
  if (base !== '/' && pathname === base.slice(0, -1)) {
    res.writeHead(308, { Location: base }).end();
    return;
  }
  if (pathname !== base && pathname !== base + 'index.html') {
    res.writeHead(404).end();
    return;
  }
  try {
    const html = preview ? await readFile(new URL('dist/index.html', root)) : await renderPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(error.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('页面生成失败，请查看终端日志。');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log('http://' + host + ':' + port + base));
