import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifold, Kernel } from '../js/geom/kernel.js';
import { run } from '../js/lang/interpreter.js';
import { parse } from '../js/lang/parser.js';
import { lex } from '../js/lang/lexer.js';

let kernel;
before(async () => { kernel = new Kernel(await loadManifold()); });
after(() => kernel.dispose());

// Evaluate a program and return the text of its ⊢ results.
function show(src) {
  const r = run(src, kernel);
  if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.shows.map((s) => s.text ?? 'sólido');
}
const val = (expr) => show(`⊢ ${expr}`)[0];
const errorOf = (src) => {
  const r = run(src, kernel);
  assert.ok(r.errors.length, `expected an error for: ${src}`);
  return r.errors[0].message;
};
const volume = (src, name) => {
  const r = run(src, kernel);
  if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join('; '));
  const o = r.objects.find((x) => x.name === name);
  return kernel.volume(o.solid);
};
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('lexer: ASCII and LaTeX spellings normalise to the same tokens', () => {
  const types = (s) => lex(s).map((t) => t.type).filter((t) => t !== 'eof');
  assert.deepEqual(types('A ∪ B'), types('A \\/ B'));
  assert.deepEqual(types('A ∪ B'), types('A \\cup B'));
  assert.deepEqual(types('x ≔ 1'), types('x := 1'));
  assert.deepEqual(types('x ↦ x'), types('x -> x'));
  assert.deepEqual(types('a ≤ b ∧ c ≠ d'), types('a <= b and c != d'));
  assert.deepEqual(types('A ∖ B'), types('A \\ B'));
  assert.equal(lex('\\theta')[0].value, 'θ');
  assert.equal(lex('x²')[1].value, 2);
  assert.equal(lex('g⁻¹')[1].value, -1);
});

test('lexer: line continuation rules', () => {
  const stmts = (s) => parse(s).program.body.length;
  assert.equal(stmts('a ≔ 1\nb ≔ 2'), 2);
  assert.equal(stmts('a ≔ 1 +\n  2'), 1);
  assert.equal(stmts('a ≔ cube(1)\n  ∪ sphere(1)'), 1);
  assert.equal(stmts('a ≔ cube(1)\n∪ sphere(1)'), 1);
  assert.equal(stmts('a ≔ [1,\n2,\n3]'), 1);
  assert.equal(stmts('f(k) ≔ if k = 0 then 1\n  else 2\nb ≔ 3'), 2);
  assert.equal(stmts('a ≔ 1; b ≔ 2'), 2);
});

test('arithmetic, precedence and implicit multiplication', () => {
  assert.equal(val('1 + 2 · 3'), '7');
  assert.equal(val('2^3^2'), '512');
  assert.equal(val('-2²'), '-4');
  assert.equal(val('2π = τ'), 'true');
  assert.equal(val('let x ≔ 3 in 2x²'), '18');
  assert.equal(val('let x ≔ 3 in 2x^2'), '18');
  assert.equal(val('1/2π = 1/(2·π)'), 'true');
  assert.equal(val('180° = π'), 'true');
  assert.equal(val('√16 + √(9)'), '7');
  assert.equal(val('⌊3.7⌋ + ⌈0.2⌉'), '4');
  assert.equal(val('7 mod 3'), '1');
  assert.equal(val('-7 mod 3'), '2');
  assert.equal(val('0 ≤ 3 < 5'), 'true');
  assert.equal(val('0 ≤ 7 < 5'), 'false');
});

test('lists, vectors and ranges', () => {
  assert.equal(val('[1, 2, 3] + ⟨1, 1, 1⟩'), '[2, 3, 4]');
  assert.equal(val('[1, 0, 0] · [0, 1, 0]'), '0');
  assert.equal(val('[1, 0, 0] × [0, 1, 0]'), '[0, 0, 1]');
  assert.equal(val('2 · [1, 2, 3]'), '[2, 4, 6]');
  assert.equal(val('len(0..<10)'), '10');
  assert.equal(val('len(1..10)'), '10');
  assert.equal(val('range(0, 1, 0.25)'), '0..1');
  assert.equal(val('len(range(0, 1, 0.25))'), '5');
  assert.equal(val('3 ∈ 1..5'), 'true');
  assert.equal(val('[1, 2] ∈ [[1, 2], [3]]'), 'true');
  assert.equal(val('{1, 2} ∪ {2, 3}'), '[1, 2, 3]');
  assert.equal(val('[1, 2, 3].y'), '2');
  assert.equal(val('[10, 20, 30][2]'), '30');
  assert.equal(val('[1] ++ [2, 3]'), '[1, 2, 3]');
});

test('comprehensions', () => {
  assert.equal(val('{ i² | i ∈ 1..4 }'), '[1, 4, 9, 16]');
  assert.equal(val('[ [i, j] | i ∈ 0..1, j ∈ 0..1 ]'), '[[0, 0], [0, 1], [1, 0], [1, 1]]');
  assert.equal(val('{ i + j | i, j ∈ 0..2, i < j }'), '[1, 2, 3]');
  assert.equal(val('{ x | x ∈ 1..10, x mod 3 = 0 }'), '[3, 6, 9]');
  assert.equal(val('{ x | x ∈ 1..5, x ∈ [2, 4, 9] }'), '[2, 4]');
  assert.equal(val('{ y | x ∈ 1..3, y ≔ 10x }'), '[10, 20, 30]');
  assert.equal(val('{ a + b | [a, b] ∈ [[1, 2], [3, 4]] }'), '[3, 7]');
  assert.equal(val('[ k | k in 0..<3 ]'), '[0, 1, 2]');
});

test('big operators', () => {
  assert.equal(val('Σ{ k | k ∈ 1..100 }'), '5050');
  assert.equal(val('Σ_{k=1}^{10} k²'), '385');
  assert.equal(val('Σ_{k ∈ 1..3} 2k + 1'), '13');
  assert.equal(val('∏(1..5)'), '120');
  assert.equal(val('Σ[[1, 0, 0], [0, 2, 0]]'), '[1, 2, 0]');
});

test('functions: definitions, lambdas, currying, composition, sections, pipes', () => {
  assert.equal(show('f(x) ≔ x + 1\n⊢ f(2)')[0], '3');
  assert.equal(show('f(x, n = 2) ≔ x^n\n⊢ f(3), f(3, n = 3)').join(), '9,27');
  assert.equal(val('(x ↦ x²)(4)'), '16');
  assert.equal(val('((x, y) ↦ x - y)(5, 3)'), '2');
  assert.equal(val('map(x ↦ 2x, 1..3)'), '[2, 4, 6]');
  assert.equal(val('1..3 |> map(x ↦ 2x)'), '[2, 4, 6]');
  assert.equal(val('fold((+), 0, 1..4)'), '10');
  assert.equal(val('reduce((·), 1..5)'), '120');
  assert.equal(val('map((· 10), [1, 2])'), '[10, 20]');
  assert.equal(val('map((10 -), [1, 2])'), '[9, 8]');
  assert.equal(val('((x ↦ x + 1) ∘ (x ↦ 2x))(5)'), '11');
  assert.equal(val('filter(x ↦ x > 2, 1..5)'), '[3, 4, 5]');
  assert.equal(val('max{ i² | i ∈ -3..2 }'), '9');
  assert.equal(val('iterate(x ↦ 2x, 3, 1)'), '[1, 2, 4, 8]');
  assert.equal(val('zip(1..3, [4, 5, 6]) |> map([a, b] ↦ a·b)'), '[4, 10, 18]');
  assert.equal(val('cylinder(1)').startsWith('função'), true);
});

test('recursion, let, if, order-independent definitions', () => {
  assert.equal(show('fact(n) ≔ if n = 0 then 1 else n · fact(n - 1)\n⊢ fact(10)')[0], '3628800');
  assert.equal(show('⊢ b\nb ≔ a + 1\na ≔ 41')[0], '42');
  assert.equal(val('let a ≔ 2, b ≔ a + 1, sq(x) ≔ x² in sq(b)'), '9');
  assert.equal(show('even(n) ≔ if n = 0 then true else odd(n - 1)\nodd(n) ≔ if n = 0 then false else even(n - 1)\n⊢ even(10)')[0], 'true');
});

test('isometries form a group', () => {
  assert.equal(val('Rz(90°) · [1, 0, 0]'), '[0, 1, 0]');
  assert.equal(val('(T(1, 2, 3) ∘ Rz(90°)) · [1, 0, 0]'), '[1, 3, 3]');
  assert.equal(val('T([1, 2, 3])⁻¹ · [0, 0, 0]'), '[-1, -2, -3]');
  assert.equal(val('Rz(30°)^3 = Rz(90°)'), 'true');
  assert.equal(val('Mx ∘ Mx = id'), 'true');
  assert.equal(val('R([0, 0, 1], 90°, [1, 0, 0]) · [2, 0, 0]'), '[1, 1, 0]');
  assert.equal(val('M([1, 0, 0], [5, 0, 0]) · [0, 0, 0]'), '[10, 0, 0]');
  assert.equal(val('Rz(90°)([1, 0, 0])'), '[0, 1, 0]');
});

test('scalings and affine transformations', () => {
  assert.equal(val('S(2) · [1, 2, 3]'), '[2, 4, 6]');
  assert.equal(val('S(1, 2, 3) · [1, 1, 1]'), '[1, 2, 3]');
  assert.equal(val('S([2, 1, 1]) = Sx(2)'), 'true');
  assert.equal(val('Sx(-1) = Mx'), 'true');
  assert.equal(val('S(2)⁻¹ = S(0.5)'), 'true');
  assert.equal(val('(T(1, 2, 3) ∘ S(2))⁻¹ · [3, 4, 5]'), '[1, 1, 1]');
  assert.equal(val('at(S(2), [10, 0, 0]) · [11, 0, 0]'), '[12, 0, 0]');
  assert.equal(val('S(3)^2 = S(9)'), 'true');
  assert.equal(val('isometry(Rz(30°) ∘ T(1, 2, 3) ∘ Mx)'), 'true');
  assert.equal(val('isometry(Rz(30°) ∘ S(2))'), 'false');
  assert.equal(val('Rz(30°) ∘ S(2)'), 'transformação afim');
  near(volume('a ≔ S(2) · cube(5)', 'a'), 1000);
  near(volume('a ≔ S(1, 2, 3) · cube(1)', 'a'), 6);
  near(volume('a ≔ Sz(-2) · cube(1)', 'a'), 2); // negative factor mirrors; orientation stays valid
  near(volume('a ≔ (Rz(45°) ∘ S(2, 1, 1)) · cube(1) ∖ cube(0.1)', 'a'), 2 - 0.001);
  const ellipsoid = volume('a ≔ S(1, 2, 3) · sphere(1, 64)', 'a');
  assert.ok(Math.abs(ellipsoid - (4 / 3) * Math.PI * 6) < 0.5, `ellipsoid ${ellipsoid}`);
  assert.match(errorOf('⊢ S(0) · cube(1)'), /fator de escala zero/);
  assert.match(errorOf('⊢ S(1, 0) · cube(1)'), /fator de escala zero/);
  assert.match(errorOf('⊢ (S(2) ∘ M([1,0,0]))(3)'), /transformação afim recebe|se aplica a sólidos/);
});

test('solids: set operations and volumes', () => {
  near(volume('a ≔ cube(2)', 'a'), 8);
  near(volume('a ≔ cube(2) ∪ T(1, 1, 1) · cube(2)', 'a'), 15);
  near(volume('a ≔ cube(2) ∩ T(1, 1, 1) · cube(2)', 'a'), 1);
  near(volume('a ≔ cube(2) ∖ T(1, 1, 1) · cube(2)', 'a'), 7);
  near(volume('a ≔ cube(2) △ T(1, 1, 1) · cube(2)', 'a'), 14);
  near(volume('a ≔ cube(2) + T(1, 1, 1) · cube(2) - cube(0.5)', 'a'), 15 - 0.125);
  near(volume('a ≔ Mx · T(5, 0, 0) · box(1, 2, 3)', 'a'), 6);
  near(volume('a ≔ ⋃{ T(2i, 0, 0) · cube(1) | i ∈ 0..<5 }', 'a'), 5);
  near(volume('a ≔ ⋂{ Rz(k · 30°) · cube(2) | k ∈ 0..2 } ∖ ∅', 'a'), 8, 4);
  near(volume('a ≔ reduce((∪), [cube(1), T(3,0,0)·cube(1)])', 'a'), 2);
  near(volume('a ≔ [cube(1), T(3,0,0)·cube(1)] |> union', 'a'), 2);
  near(volume('a ≔ T(0,0,10) · [cube(1), cube(2)] |> (⋃)', 'a'), 8);
  near(volume('a ≔ hull(T(-5,0,0)·cube(1), T(5,0,0)·cube(1))', 'a'), 11);
  near(volume('a ≔ polyhedron([[0,0,0],[1,0,0],[0,1,0],[0,0,1]], [[0,2,1],[0,1,3],[0,3,2],[1,2,3]])', 'a'), 1 / 6);
  const r = run('a ≔ ground(T(0, 0, -7) · cube(2))\n⊢ bounds(a)', kernel);
  assert.equal(r.shows[0].text, '[[-1, -1, 0], [1, 1, 2]]');
});

test('named objects and ⊢', () => {
  const r = run('n ≔ 3\nbase ≔ cube(1)\npeça ≔ base ∪ T(2,0,0)·base', kernel);
  assert.deepEqual(r.objects.map((o) => o.name), ['base', 'peça']);
  assert.equal(r.shows.length, 1);
  assert.equal(r.shows[0].name, 'peça');
  assert.deepEqual(r.values, [{ name: 'n', text: '3' }]);
  const r2 = run('a ≔ cube(1)\nb ≔ sphere(1)\n⊢ a, b\n⊢ volume(a)', kernel);
  assert.deepEqual(r2.shows.map((s) => s.label), ['a', 'b', 'volume(a)']);
});

test('the plan example evaluates', () => {
  const src = `
# parâmetros
n ≔ 8
r ≔ 30

furo(θ) ≔ Rz(θ) ∘ T(r - 6, 0, 0) · cylinder(r = 2, h = 10)
pilar(p) ≔ T(p) · box(4, 4, 20)

base   ≔ cylinder(r = r, h = 4)
furos  ≔ ⋃{ furo(k · 360°/n) | k ∈ 0..<n }
cantos ≔ ⋃{ pilar(⟨20sx, 20sy, 0⟩) | sx ∈ {-1, 1}, sy ∈ {-1, 1} }

peça ≔ (base ∖ furos) ∪ cantos ∖ sphere(8)

⊢ peça
`;
  const r = run(src, kernel);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.objects.map((o) => o.name), ['base', 'furos', 'cantos', 'peça']);
  const mesh = kernel.toMesh(r.shows[0].solid);
  assert.ok(mesh.topology().closed);
  assert.ok(kernel.genus(r.shows[0].solid) >= 8);
});

test('errors are reported with positions', () => {
  const r = run('a ≔ cube(1)\nb ≔ a ∪ 3', kernel);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /'∪' não se aplica a sólido e número/);
  assert.equal(r.errors[0].span.start, 'a ≔ cube(1)\nb ≔ '.length);

  assert.match(errorOf('a ≔ b\nb ≔ a'), /circular/);
  assert.match(errorOf('⊢ foo'), /'foo' não está definido/);
  assert.match(errorOf('⊢ cube(-1)'), /positivo/);
  assert.match(errorOf('⊢ cylinder(1) ∪ cube(1)'), /aplicação parcial de cylinder, faltando h/);
  assert.match(errorOf('⊢ cube(1) · cube(1)'), /para interseção use ∩/);
  assert.match(errorOf('⊢ (1 +'), /esperava|incompleta/);
  assert.match(errorOf('a ≔ 1\na ≔ 2'), /já foi definido/);
  assert.match(errorOf('f(x) ≔ f(x)\n⊢ f(1)'), /recursão profunda/);
  assert.match(errorOf('⊢ if 1 then 2 else 3'), /booleana/);
  assert.match(errorOf('⊢ cylinder(r = 1, h = 2, q = 3)'), /não tem parâmetro 'q'/);
  assert.match(errorOf('⊢ \\foo'), /comando desconhecido/);

  // A failing definition is reported once; dependants stay silent.
  const r2 = run('a ≔ 1/0\nb ≔ a + 1\nc ≔ cube(1)', kernel);
  assert.equal(r2.errors.length, 1);
  assert.deepEqual(r2.objects.map((o) => o.name), ['c']);

  // Several syntax errors in one pass.
  assert.equal(run('a ≔ (1\nb ≔ 2 +\nc ≔ )', kernel).errors.length >= 2, true);
});
