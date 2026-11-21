// Records a tutorial script (demo/<id>.txt) as a 1920×1080 video.
//
//   node tools/record-demo.mjs 01-primeiro-solido
//
// Output in demo/out/: <id>.mp4, <id>.srt (captions) and <id>.capitulos.txt (YouTube chapters).
// If the script has a "trilha: a.mid b.mid …" line, those pieces are rendered with a piano
// SoundFont (tools/trilha.py; set CSG_SF2 or keep it in ~/Músicas/salamander/) and mixed in.
// Pass --sem-trilha to skip it, --so-trilha to only remix the music into an already recorded video, or --rascunho to only run the script and report evaluation errors. Needs Chrome/Chromium and ffmpeg (and fluidsynth + numpy for music). The page runs in "record" mode: instead of playing in real
// time, each call to demo.next() performs one step and says how long its frame lasts, so the
// video is smooth and identical on every run, however slow the machine.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm, readFile, readdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
const draft = process.argv.includes('--rascunho'); // run the script without filming: fast check
const withMusic = !process.argv.includes('--sem-trilha') && !draft;
const onlyMusic = process.argv.includes('--so-trilha'); // remix the soundtrack into an existing video
if (!id) {
  console.error('uso: node tools/record-demo.mjs <roteiro>   (arquivo demo/<roteiro>.txt)');
  process.exit(1);
}
const FPS = 30;
const HTTP_PORT = 8790;
const CDP_PORT = 9339;
const W = 1280, H = 720, SCALE = 1.5; // CSS pixels × scale = 1920×1080

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeBinary() {
  for (const c of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try { execFileSync('which', [c], { stdio: 'ignore' }); return c; } catch { /* next */ }
  }
  throw new Error('Chrome/Chromium não encontrado');
}

// ---------- minimal Chrome DevTools Protocol client ----------
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return cdp(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('não consegui conectar ao Chrome');
}

function cdp(url) {
  const ws = new WebSocket(url);
  let next = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = next++;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return new Promise((resolve) => { ws.onopen = () => resolve({ send, evaluate, close: () => ws.close() }); });
}

// ---------- captions ----------
const clock = (ms, sep = ',') => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(t % 1000).padStart(3, '0')}`;
};
const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${clock(c.start)} --> ${clock(c.end)}\n${c.text}\n`).join('\n');
const chapterClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- soundtrack ----------
const LUFS = -20; // calm background level (there is no narration)

async function findSf2() {
  if (process.env.CSG_SF2) return process.env.CSG_SF2;
  const base = join(homedir(), 'Músicas', 'salamander');
  for (const d of await readdir(base).catch(() => [])) {
    const f = (await readdir(join(base, d)).catch(() => [])).find((x) => x.endsWith('.sf2'));
    if (f) return join(base, d, f);
  }
  throw new Error('SoundFont não encontrado: defina CSG_SF2 ou use --sem-trilha');
}

async function addSoundtrack(video, midis, seconds) {
  const wav = video.replace(/\.mp4$/, '.trilha.wav');
  execFileSync('python3', [join(root, 'tools', 'trilha.py'), '--sf2', await findSf2(), '--saida', wav,
    '--duracao', seconds.toFixed(2), ...midis], { stdio: 'inherit' });
  // integrated loudness (EBU R128) → gain to reach LUFS
  const report = spawnSyncText('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
  const m = [...report.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)].pop();
  const measured = m ? Number(m[1]) : -18;
  const gain = (LUFS - measured).toFixed(1);
  const tmp = video.replace(/\.mp4$/, '.com-trilha.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-af', `volume=${gain}dB,alimiter=limit=0.89:level=false`, '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp]);
  await rename(tmp, video);
  console.log(`✓ trilha: ${midis.map((p) => p.split('/').pop()).join(' + ')} (${measured.toFixed(1)} → ${LUFS} LUFS)`);
}

function spawnSyncText(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

// ---------- main ----------
const midisOf = (script) => /^\s*trilha:\s*(.+)$/m.exec(script)?.[1].trim().split(/\s+/).map((p) => p.replace(/^~(?=\/)/, homedir()));

async function remixOnly() {
  const video = join(root, 'demo', 'out', `${id}.mp4`);
  const midis = midisOf(await readFile(join(root, 'demo', `${id}.txt`), 'utf8'));
  if (!midis) throw new Error(`demo/${id}.txt não tem linha "trilha:"`);
  const seconds = Number(spawnSyncText('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).trim());
  await addSoundtrack(video, midis, seconds);
}

async function main() {
  if (onlyMusic) return remixOnly();
  const outDir = join(root, 'demo', 'out');
  await mkdir(outDir, { recursive: true });
  const profile = join(tmpdir(), `csg-demo-chrome-${process.pid}`);
  const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const chrome = spawn(chromeBinary(), [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`, `--force-device-scale-factor=${SCALE}`, 'about:blank',
  ], { stdio: 'ignore' });
  let ffmpeg;
  try {
    await sleep(600);
    const page = await connect();
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html?demo=${encodeURIComponent(id)}&record=1` });
    for (let i = 0; ; i++) {
      const state = await page.evaluate('window.demoError ?? (window.demo?.ready === true)').catch(() => false);
      if (typeof state === 'string') throw new Error(state);
      if (state === true) break;
      if (i > 300) throw new Error('o roteiro não iniciou (veja o console da página)');
      await sleep(100);
    }

    if (draft) {
      let t = 0;
      for (let ms = await page.evaluate('window.demo.next()'); ms != null; ms = await page.evaluate('window.demo.next()')) t += ms;
      const r = await page.evaluate('({ log: window.demo.log, src: window.app.editor.value, errors: window.app.state.errors.map((e) => e.message) })');
      console.log(`roteiro ${id}: ${chapterClock(t)} de vídeo`);
      for (const e of r.log) console.log(`  linha ${e.line}: ${e.errors.join(' | ')}`);
      console.log(`--- programa final ---\n${r.src}\n--- ${r.errors.length ? `ERROS: ${r.errors.join(' | ')}` : 'sem erros'}`);
      return;
    }
    const out = join(outDir, `${id}.mp4`);
    ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ffmpeg.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${c}`)))));
    const write = (buf) => (ffmpeg.stdin.write(buf) ? null : new Promise((r) => ffmpeg.stdin.once('drain', r)));

    let t = 0, frames = 0, steps = 0;
    const started = Date.now();
    for (;;) {
      const ms = await page.evaluate('window.demo.next()');
      if (ms == null) break;
      steps++;
      t += ms;
      const target = Math.round((t * FPS) / 1000);
      if (target > frames) {
        const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
        const buf = Buffer.from(shot.data, 'base64');
        while (frames < target) { await write(buf); frames++; }
      }
      if (steps % 100 === 0) process.stdout.write(`\r  ${chapterClock(t)} de vídeo, ${steps} passos…`);
    }
    ffmpeg.stdin.end();
    await done;
    const { cues, chapters } = await page.evaluate('({ cues: window.demo.cues, chapters: window.demo.chapters })');
    await writeFile(join(outDir, `${id}.srt`), toSrt(cues));
    // YouTube chapters: the first at 0:00 and none shorter than 10 s (a short one merges into the next)
    const list = [];
    for (const c of chapters) {
      const start = list.length ? c.start : 0;
      if (list.length && start - list.at(-1).start < 10_000) list.at(-1).text = c.text;
      else list.push({ start, text: c.text });
    }
    await writeFile(join(outDir, `${id}.capitulos.txt`), list.map((c) => `${chapterClock(c.start)} ${c.text}`).join('\n') + '\n');
    page.close();
    const script = await readFile(join(root, 'demo', `${id}.txt`), 'utf8');
    const midis = midisOf(script);
    if (midis && withMusic) await addSoundtrack(out, midis, t / 1000);
    console.log(`\r✓ demo/out/${id}.mp4: ${chapterClock(t)} (${frames} quadros, ${steps} passos, gravado em ${Math.round((Date.now() - started) / 1000)} s)`);
    console.log(`✓ demo/out/${id}.srt e demo/out/${id}.capitulos.txt`);
  } finally {
    ffmpeg?.stdin.destroyed === false && ffmpeg.stdin.end();
    chrome.kill();
    server.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
