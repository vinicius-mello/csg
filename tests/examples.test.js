import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifold, Kernel } from '../js/geom/kernel.js';
import { run } from '../js/lang/interpreter.js';
import { EXAMPLES } from '../js/examples.js';
import { toBinarySTL, parseBinarySTL } from '../js/io/stl.js';

let kernel;
before(async () => { kernel = new Kernel(await loadManifold()); });
after(() => kernel.dispose());

for (const ex of EXAMPLES) {
  test(`example "${ex.title}" evaluates to closed solids`, () => {
    const t0 = performance.now();
    const r = run(ex.source, kernel);
    assert.deepEqual(r.errors.map((e) => e.message), []);
    const solids = r.shows.filter((s) => s.solid);
    assert.ok(solids.length >= 1, 'shows at least one solid');
    for (const s of solids) {
      const mesh = kernel.toMesh(s.solid);
      assert.ok(mesh.triangleCount > 0, `${s.label} is not empty`);
      assert.ok(mesh.topology().closed, `${s.label} is closed`);
      assert.ok(mesh.volume() > 0, `${s.label} has positive volume`);
      const stl = toBinarySTL(mesh);
      assert.equal(parseBinarySTL(stl).length, mesh.triangleCount);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 10_000, `took ${ms.toFixed(0)} ms`);
    kernel.dispose();
  });
}

test('menger fraction is (20/27)²', () => {
  const r = run(EXAMPLES.find((e) => e.id === 'menger').source, kernel);
  assert.ok(Math.abs(Number(r.shows[1].text) - (20 / 27) ** 2) < 1e-4);
});

test('tour prints expected values', () => {
  const r = run(EXAMPLES.find((e) => e.id === 'tour').source, kernel);
  assert.deepEqual(r.shows.slice(1).map((s) => s.text), ['385', '[1, 9, 25, 49, 81]', '[4, 8, 12, 16, 20]', '30', 'true']);
});
