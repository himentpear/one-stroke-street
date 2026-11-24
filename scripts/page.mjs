import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const root = new URL('../', import.meta.url);
export async function renderPage() {
  const read = name => readFile(new URL('src/' + name, root), 'utf8');
  const [template, styles, scene, game] = await Promise.all([
    read('page.html'), read('style.css'), read('scene.svg'),
    build({
      absWorkingDir: fileURLToPath(root), entryPoints: ['src/game.js'], bundle: true,
      write: false, format: 'iife', target: 'es2020', charset: 'utf8', legalComments: 'none'
    })
  ]);
  const script = game.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  return template
    .replace('<!-- inline:style -->', () => '<style>\n' + styles + '</style>')
    .replace('<!-- inline:scene -->', () => scene.trimEnd())
    .replace('<!-- inline:game -->', () => '<script>\n' + script + '</script>');
}
