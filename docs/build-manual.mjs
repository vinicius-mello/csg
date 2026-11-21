// Builds docs/csg-manual.pdf from docs/manual.tex (LuaLaTeX):
//   1. checks every \begin{csg}[run] program with the real interpreter + kernel;
//   2. writes gen/functions.tex and gen/symbols.tex from the code (never stale);
//   3. renders the figures (\csgfig{…}) with the app's viewer in headless Chrome;
//   4. colours the csg blocks with the editor's tokenizer and compiles with latexmk -lualatex.
// Usage: npm run manual [-- --no-figures]   (needs lualatex/latexmk and google-chrome or chromium)
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadManifold, Kernel } from '../js/geom/kernel.js';
import { run } from '../js/lang/interpreter.js';
import { SYMBOLS } from '../js/lang/symbols.js';
import { createPrelude } from '../js/lang/builtins.js';
import { Builtin } from '../js/lang/values.js';
import { tokenize } from '../js/editor/highlight.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8771;

// ---------- LaTeX escaping ----------
const TEX = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '%': '\\%', '&': '\\&',
  '$': '\\$', _: '\\_', '^': '\\^{}', '~': '\\textasciitilde{}', '"': '\\textquotedbl{}' };
const tex = (s) => s.replace(/[\\{}#%&$_^~"]/g, (c) => TEX[c]);
const tt = (s) => `\\texttt{${tex(s)}}`;

// ---------- csg blocks ----------
// \begin{csg}[run, id=nome] … \end{csg}
function blocks(src) {
  return [...src.matchAll(/\\begin\{csg\}(?:\[([^\]]*)\])?\n([\s\S]*?)\n\\end\{csg\}/g)].map((m) => {
    const opts = Object.fromEntries((m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const [k, v = true] = s.split('=').map((x) => x.trim()); return [k, v]; }));
    return { whole: m[0], opts, code: m[2] };
  });
}

// ---------- 1. check the programs ----------
async function checkPrograms(list) {
  const kernel = new Kernel(await loadManifold());
  const runnable = list.filter((b) => b.opts.run);
  let failures = 0;
  for (const b of runnable) {
    const r = run(b.code, kernel);
    if (r.errors.length) {
      failures++;
      console.error(`✗ programa com erro:\n${b.code}\n→ ${r.errors.map((e) => e.message).join('; ')}\n`);
    }
    kernel.dispose();
  }
  if (failures) throw new Error(`${failures} programa(s) do manual falharam`);
  console.log(`✓ ${runnable.length} programas do manual avaliados sem erro`);
}

// ---------- 2. generated reference ----------
const CATEGORIES = [
  ['Primitivas', ['cube', 'box', 'sphere', 'cylinder', 'cone', 'torus', 'prism', 'polyhedron', 'hull', 'minkowski']],
  ['Isometrias', ['T', 'Tx', 'Ty', 'Tz', 'Rx', 'Ry', 'Rz', 'R', 'M']],
  ['Escalas e transformações afins', ['S', 'scale', 'Sx', 'Sy', 'Sz', 'at', 'inverse', 'isometry']],
  ['Sólidos: consultas e posicionamento', ['union', 'intersection', 'bounds', 'size', 'volume', 'area', 'isempty', 'center', 'ground']],
  ['Listas e coleções', ['len', 'range', 'map', 'filter', 'fold', 'reduce', 'zip', 'enumerate', 'reverse', 'sort', 'flatten', 'take', 'drop', 'first', 'last', 'sum', 'prod', 'any', 'all', 'count', 'indexof', 'repeat', 'iterate']],
  ['Matemática', ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'floor', 'ceil', 'round', 'sign', 'exp', 'ln', 'log', 'min', 'max', 'clamp', 'lerp', 'norm', 'unit', 'dot', 'cross', 'dist']],
];

const table = (spec, head, rows) => `\\begin{longtable}{${spec}}
\\toprule
${head ? `${head} \\\\\n\\midrule\n\\endhead\n` : ''}${rows.join('\n')}
\\bottomrule
\\end{longtable}
`;

function symbolsTable() {
  const rows = SYMBOLS.map((s) => `{\\Large\\ttfamily ${tex(s.sym)}} & ${tex(s.name)} & ${tt(s.latex.map((l) => `\\${l}`).join(' '))} & ${s.ascii.length ? tt(s.ascii.join('  ')) : '—'} \\\\`);
  const head = ['Símbolo', 'Significado', 'Atalho no editor', 'Grafia ASCII'].map((h) => `\\colhead{${h}}`).join(' & ');
  return table('@{}>{\\centering\\arraybackslash}p{0.08\\linewidth}L{0.33}L{0.30}L{0.24}@{}', head, rows);
}

function functionsReference() {
  const prelude = createPrelude();
  const seen = new Set();
  const section = (title, names) => {
    const rows = names.filter((n) => prelude[n] instanceof Builtin).map((n) => {
      seen.add(n);
      const b = prelude[n];
      const sig = b.variadic ? `${n}(${b.params[0].name}…)` : `${n}(${b.params.map((p) => (p.optional ? `${p.name}?` : p.name)).join(', ')})`;
      const desc = b.doc.includes(' — ') ? b.doc.split(' — ').slice(1).join(' — ') : '';
      return `${tt(sig)} & ${tex(desc)} \\\\`;
    });
    return `\\subsection*{${tex(title)}}\n${table('@{}L{0.42}L{0.58}@{}', '', rows)}`;
  };
  const out = CATEGORIES.map(([t, ns]) => section(t, ns)).join('\n');
  const missing = Object.keys(prelude).filter((k) => prelude[k] instanceof Builtin && !seen.has(k));
  if (missing.length) throw new Error(`funções sem categoria no manual: ${missing.join(', ')}`);
  return out;
}

// ---------- 4. highlighting ----------
const BUILTINS = new Set([...Object.keys(createPrelude()), 'empty']);
const VERB = (s) => s.replace(/[\\{}]/g, (c) => ({ '\\': '\\tkBS{}', '{': '\\tkLB{}', '}': '\\tkRB{}' })[c]);

function highlight(code) {
  return tokenize(code, BUILTINS).map(([s, e, cls]) => {
    const text = VERB(code.slice(s, e));
    return cls ? `\\${cls.replace('tk-', 'tk')}{${text}}` : text;
  }).join('');
}

function expandBlocks(src, list) {
  for (const b of list) {
    const body = b.opts.plain
      ? `\\begin{csgpl}\n${b.code}\n\\end{csgpl}`
      : `\\begin{csghl}\n${highlight(b.code)}\n\\end{csghl}`;
    src = src.replace(b.whole, () => `\\begin{csgbox}\n${body}\n\\end{csgbox}`);
  }
  return src;
}

// ---------- 3. figures ----------
function chrome() {
  for (const c of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try { execFileSync('which', [c], { stdio: 'ignore' }); return c; } catch { /* next */ }
  }
  throw new Error('Chrome/Chromium não encontrado');
}

function serve() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  return new Promise((resolve) => setTimeout(() => resolve(p), 800));
}

function chromeShot(args) {
  const profile = join(tmpdir(), `csg-manual-chrome-${process.pid}`);
  execFileSync(chrome(), ['--headless=new', `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...args], { stdio: 'ignore', timeout: 120_000 });
}

// Crop the white margin around a figure (optional: needs Python with Pillow).
function trim(file) {
  const py = `
from PIL import Image, ImageChops
im = Image.open(${JSON.stringify(file)}).convert('RGB')
bg = Image.new('RGB', im.size, (255, 255, 255))
box = ImageChops.difference(im, bg).point(lambda v: 255 if v > 12 else 0).getbbox()
if box:
    pad = 24
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
    im.crop(box).save(${JSON.stringify(file)})
`;
  try { execFileSync('python3', ['-c', py], { stdio: 'ignore' }); } catch { console.warn('  (sem Pillow: figura não recortada)'); }
}

async function renderFigures(src, list) {
  await mkdir(join(here, 'img'), { recursive: true });
  const server = await serve();
  try {
    for (const [, params, name] of src.replace(/^\s*%.*$/gm, "").matchAll(/\\csgfig\{([^}]*)\}\{([^}]*)\}/g)) {
      const q = new URLSearchParams(params);
      // pre=ID: render the program of \begin{csg}[…, id=ID] (figure and text never diverge)
      if (q.has('pre')) {
        const b = list.find((x) => x.opts.id === q.get('pre'));
        if (!b) throw new Error(`figura ${name}: bloco id=${q.get('pre')} não encontrado`);
        q.set('src', b.code);
        q.delete('pre');
      }
      const [w, h] = (q.get('size') ?? '900x560').split('x');
      const out = join(here, 'img', `${name}.png`);
      chromeShot([`--window-size=${w},${h}`, '--force-device-scale-factor=2', '--virtual-time-budget=30000',
        `--screenshot=${out}`, `http://127.0.0.1:${PORT}/docs/render.html?${q}`]);
      trim(out);
      console.log(`✓ figura img/${name}.png`);
    }
  } finally {
    server.kill();
  }
}

// ---------- main ----------
async function main() {
  const src = await readFile(join(here, 'manual.tex'), 'utf8');
  const list = blocks(src);
  await checkPrograms(list);
  await mkdir(join(here, 'gen'), { recursive: true });
  await writeFile(join(here, 'gen', 'functions.tex'), functionsReference());
  await writeFile(join(here, 'gen', 'symbols.tex'), symbolsTable());
  if (!process.argv.includes('--no-figures')) await renderFigures(src, list);
  await mkdir(join(here, 'build'), { recursive: true });
  await writeFile(join(here, 'build', 'csg-manual.tex'), expandBlocks(src, list));
  try {
    execFileSync('latexmk', ['-lualatex', '-interaction=nonstopmode', '-halt-on-error', '-outdir=build',
      'build/csg-manual.tex'], { cwd: here, stdio: ['ignore', 'ignore', 'inherit'], timeout: 300_000 });
  } catch {
    throw new Error('LuaLaTeX falhou; veja docs/build/csg-manual.log');
  }
  await copyFile(join(here, 'build', 'csg-manual.pdf'), join(here, 'csg-manual.pdf'));
  console.log('✓ docs/csg-manual.pdf');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
