// Renderiza los ejemplos visuales del repo:
//   node scripts/render-examples.mjs                 → todos los stills (examples/stills/*.jpg) + showcase.mp4
//   node scripts/render-examples.mjs stills          → solo stills
//   node scripts/render-examples.mjs video           → solo examples/showcase.mp4
//   node scripts/render-examples.mjs stills chart pyramid   → solo esas plantillas
//
// Un único bundle + un único navegador para todo (mucho más rápido que N × `npx remotion still`).
// Corre con prioridad BAJA y concurrency 1 para no ahogar la máquina.
import os from 'node:os';
import path from 'node:path';
import {readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill, renderMedia, openBrowser} from '@remotion/renderer';

// RENDER_PRIORITY=normal si la máquina está saturada y el proceso se queda sin CPU.
if (process.env.RENDER_PRIORITY !== 'normal') {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* noop */ }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROPS_DIR = path.join(ROOT, 'examples', 'props');
const STILLS_DIR = path.join(ROOT, 'examples', 'stills');
const [mode = 'all', ...only] = process.argv.slice(2);
const SCALE = Number(process.env.STILL_SCALE || 0.5);          // 1920x1080 → 960x540
const VIDEO_SCALE = Number(process.env.VIDEO_SCALE || 2 / 3);  // 1920x1080 → 1280x720

mkdirSync(STILLS_DIR, {recursive: true});
console.log('Bundling…');
const serveUrl = await bundle({entryPoint: path.join(ROOT, 'src', 'index.tsx'), publicDir: path.join(ROOT, 'public'), enableCaching: process.env.REMOTION_CACHE === '1'});
const browser = await openBrowser('chrome');
const report = {ok: [], failed: []};

if (mode === 'all' || mode === 'stills') {
  const files = readdirSync(PROPS_DIR).filter((f) => f.endsWith('.json'))
    .filter((f) => !only.length || only.includes(f.replace(/\.json$/, '')));
  for (const f of files) {
    const name = f.replace(/\.json$/, '');
    const props = JSON.parse(readFileSync(path.join(PROPS_DIR, f), 'utf8'));
    const at = Number(props._example?.stillAtSeconds ?? 2.5);
    const t0 = Date.now();
    try {
      const composition = await selectComposition({serveUrl, id: 'PipelineMotion', inputProps: props, puppeteerInstance: browser});
      const frame = Math.min(composition.durationInFrames - 1, Math.round(at * composition.fps));
      await renderStill({
        serveUrl, composition, inputProps: props, frame, puppeteerInstance: browser,
        output: path.join(STILLS_DIR, `${name}.jpg`), imageFormat: 'jpeg', jpegQuality: 88, scale: SCALE,
        timeoutInMilliseconds: 120000,
      });
      report.ok.push(name);
      console.log(`OK   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      report.failed.push({name, error: String(e?.message || e).split('\n')[0]});
      console.log(`FAIL ${name}: ${String(e?.message || e).split('\n')[0]}`);
    }
  }
}

if (mode === 'all' || mode === 'video') {
  const props = JSON.parse(readFileSync(path.join(ROOT, 'examples', 'showcase.json'), 'utf8'));
  const composition = await selectComposition({serveUrl, id: 'PipelineMotion', inputProps: props, puppeteerInstance: browser});
  console.log(`Rendering showcase (${composition.durationInFrames} frames)…`);
  await renderMedia({
    serveUrl, composition, inputProps: props, puppeteerInstance: browser,
    codec: 'h264', crf: 26, x264Preset: 'medium', scale: VIDEO_SCALE, concurrency: 1,
    outputLocation: path.join(ROOT, 'examples', 'showcase.mp4'),
    timeoutInMilliseconds: 180000,
    onProgress: ({progress}) => process.stdout.write(`\r  ${(progress * 100).toFixed(0)}%   `),
  });
  console.log('\nOK   showcase.mp4');
}

await browser.close({silent: true});
if (existsSync(STILLS_DIR)) writeFileSync(path.join(ROOT, 'examples', 'render-report.json'), JSON.stringify(report, null, 2));
console.log(`\nStills OK: ${report.ok.length}  ·  fallidos: ${report.failed.length}`);
