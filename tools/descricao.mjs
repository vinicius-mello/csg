// YouTube description for a recorded tutorial: title, chapters and credits.
//
//   node tools/descricao.mjs 01-primeiro-solido      (or with no argument: every recorded lesson)
//
// Reads demo/<id>.txt and demo/out/<id>.capitulos.txt; writes demo/out/<id>.descricao.txt.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [work, piece] of a piano-midi.de file: track names (meta FF 03) give the work, then the piece;
// when the second one is missing or generic, the piece is the text event (FF 01) after the composer.
async function midiTitles(file) {
  const b = await readFile(file);
  const names = [], texts = [];
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] !== 0x01 && b[i + 1] !== 0x03)) continue;
    let j = i + 2, n = 0;
    do { n = (n << 7) | (b[j] & 0x7f); } while (b[j++] & 0x80);
    const s = b.subarray(j, j + n).toString('latin1').trim();
    if (b[i + 1] === 0x01) texts.push(s);
    else if (s && !/^piano/i.test(s) && !names.includes(s)) names.push(s);
  }
  const k = texts.findIndex((s) => /schumann/i.test(s));
  if ((!names[1] || /schumann/i.test(names[1])) && texts[k + 1]) names[1] = texts[k + 1];
  return names;
}

async function describe(id) {
  const script = await readFile(join(root, 'demo', `${id}.txt`), 'utf8');
  const chapters = await readFile(join(root, 'demo', 'out', `${id}.capitulos.txt`), 'utf8');
  const [title, subtitle = ''] = (/^\s*título:\s*(.+)$/m.exec(script)?.[1] ?? id).split('|').map((s) => s.trim());
  const track = /^\s*trilha:\s*(.+)$/m.exec(script)?.[1].trim().split(/\s+/) ?? [];
  const pieces = [];
  for (const m of track) {
    const t = await midiTitles(m.replace(/^~(?=\/)/, homedir())).catch(() => []);
    pieces.push(t.length > 1 ? `${t[1]} (${t[0].replace('Opus', 'Op.')})` : basename(m));
  }
  const text = `CSG — ${title}: ${subtitle}

Tutorial da linguagem CSG, para modelar sólidos com notação matemática e imprimi-los em 3D.
Experimente no navegador: https://vinicius-mello.github.io/csg/
Manual (PDF): https://vinicius-mello.github.io/csg/docs/csg-manual.pdf
Código-fonte: https://github.com/vinicius-mello/csg

Capítulos
${chapters.trim()}
${pieces.length ? `
Música: Robert Schumann — ${pieces.join('; ')}.
Sequências MIDI: Bernd Krüger, piano-midi.de (CC BY-SA).
Piano: Salamander Grand Piano, Alexander Holm (CC BY 3.0).
` : ''}`;
  await writeFile(join(root, 'demo', 'out', `${id}.descricao.txt`), text);
  console.log(`✓ demo/out/${id}.descricao.txt`);
}

const ids = process.argv[2]
  ? [process.argv[2]]
  : (await readdir(join(root, 'demo', 'out'))).filter((f) => f.endsWith('.capitulos.txt')).map((f) => f.replace('.capitulos.txt', '')).sort();
for (const id of ids) await describe(id);
