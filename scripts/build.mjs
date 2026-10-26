import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/client', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/worker.ts'], outfile: 'dist/worker.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'es2023', sourcemap: false }),
  build({ entryPoints: ['public/app.js'], outfile: 'dist/client/app.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true }),
  copyFile('public/index.html', 'dist/client/index.html'),
  copyFile('public/style.css', 'dist/client/style.css')
]);
console.log('Built the Worker and web assets. No private care data is bundled.');
