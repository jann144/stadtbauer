import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Erzeugt beim Build den Service Worker mit der Liste aller Dateien, die offline verfügbar sein sollen. */
function offlineSupport(): Plugin {
  return {
    name: 'stadtbauer-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = new Set(['./', './index.html']);
      // Aus public/ nur Dateien, auch aus Unterordnern; ein Ordnername in der Liste ließe die Installation scheitern.
      const assets = readdirSync('public', { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative('public', join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
      for (const name of [...Object.keys(bundle), ...assets]) files.add(`./${name}`);
      const source = readFileSync('pwa/sw.js', 'utf8')
        // Der Zeitstempel sorgt dafür, dass jede Veröffentlichung die alten Dateien ersetzt.
        .replace('__VERSION__', new Date().toISOString())
        .replace('__FILES__', JSON.stringify([...files]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative Pfade, damit das Spiel auch in einem Unterordner (GitHub Pages) läuft.
  base: './',
  build: { target: 'es2022' },
  plugins: [offlineSupport()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
