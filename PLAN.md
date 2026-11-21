# Plano — Modelador CSG com DSL matemática

Aplicação web (HTML + CSS + JS puro, sem etapa de build) para modelar sólidos por
Geometria Construtiva de Sólidos. O usuário escreve um programa numa DSL de notação
matemática; o programa é avaliado numa árvore CSG, convertida em malha, exibida em 3D
e exportável como STL.

---

## 1. Princípios e decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Dependências | Uma só em runtime: `manifold-3d`, servido localmente | Pedido explícito: mínimo de dependências |
| Módulos | ES Modules nativos, sem bundler | Rodar com `python -m http.server` (ES modules não funcionam em `file://`) |
| Núcleo CSG | **`manifold-3d` 3.5.5** (WASM), copiado em `vendor/manifold/` (`npm run vendor`) | Robusto, rápido, malhas sempre fechadas. O BSP próprio da etapa 1 foi descartado |
| Visualização | **WebGL2 cru** (câmera orbital, grade, eixos) | Three.js seria a única dependência pesada; o necessário são ~500 linhas |
| Editor | `<textarea>` transparente sobre `<pre>` com realce | Sem CodeMirror/Monaco; suporte completo a Unicode |
| Execução | Avaliação + CSG em **Web Worker** | UI nunca trava; avaliação cancelável |
| Unidades/eixos | mm, **Z para cima**, mesa em z = 0 | Convenção de impressão 3D/STL |
| Testes | `node --test` (nativo, sem deps) | Lexer, parser, avaliador e geometria testáveis fora do browser |

---

## 2. A linguagem (DSL)

### 2.1 Visão geral por exemplo

```
# parâmetros
n ≔ 8
r ≔ 30

# funções
furo(θ) ≔ Rz(θ) ∘ T(r - 6, 0, 0) · cylinder(r = 2, h = 10)
pilar(p) ≔ T(p) · box(4, 4, 20)

# objetos nomeados (aparecem no menu e podem ser exportados)
base   ≔ cylinder(r = r, h = 4)
furos  ≔ ⋃{ furo(k · 360°/n) | k ∈ 0..<n }
cantos ≔ ⋃{ pilar(⟨20sx, 20sy, 0⟩) | sx ∈ {-1, 1}, sy ∈ {-1, 1} }

peça ≔ (base ∖ furos) ∪ cantos ∖ sphere(8)

⊢ peça        # o que é exibido
```

### 2.2 Tipos de valor

`Número` · `Booleano` · `Vetor` (⟨x,y,z⟩) · `Sólido` · `Isometria` · `Lista` ·
`Intervalo` (preguiçoso) · `Função` (incluindo operadores como funções).
Tipagem dinâmica, com mensagens de erro em português apontando linha/coluna.

### 2.3 Sintaxe — cada símbolo tem alias ASCII

| Conceito | Unicode | ASCII | Atalho no editor |
|---|---|---|---|
| Definição | `≔` | `:=` | `:=` |
| União / interseção | `∪` `∩` | `\/` `/\` (sólidos também `+`) | `\cup` `\cap` |
| Diferença / dif. simétrica | `∖` `△` | `\` ou `-` / — | `\setminus` `\triangle` |
| Uniões/interseções grandes | `⋃` `⋂` | `union(xs)` `intersection(xs)` | `\bigcup` `\bigcap` |
| Soma / produto numéricos | `Σ` `∏` | `sum` `prod` | `\sum` `\prod` |
| Pertinência | `∈` | `in` | `\in` |
| Composição de isometrias | `∘` | `@` | `\circ` |
| Aplicação a um sólido | `·` | `*` | `\cdot` |
| Inversa | `⁻¹` | `^-1` | `\inv` |
| Lambda | `x ↦ e` | `x -> e` | `\mapsto` |
| Vetor (= lista) | `⟨1,2,3⟩` | `[1,2,3]` | `\langle` |
| Comparação | `≠ ≤ ≥` | `!= <= >=` | `\ne \le \ge` |
| Lógica | `∧ ∨ ¬` | `and or not` | `\and \or \not` |
| Graus, constantes | `45°` `π` `τ` `√2` `x²` | `45deg` `pi` `tau` `sqrt(2)` `x^2` | `\deg \pi \sqrt` |
| Conjunto vazio | `∅` | `empty` | `\empty` |
| Exibir | `⊢ e` | `show e` | `\vdash` |

Multiplicação implícita apenas **número seguido de identificador** (`2π`, `20sx`) —
evita ambiguidades com aplicação de função.

### 2.4 Primitivas — nomes em inglês (centradas na origem salvo indicação; parâmetros nomeados ou posicionais)

`box(a, b, c)` / `cube(a)` · `sphere(r)` · `cylinder(r, h)` · `cone(r₁, r₂, h)` ·
`torus(R, r)` · `prism(n, r, h)` · `polyhedron(points, faces)`.
Todas aceitam `n =` (segmentos) e herdam a qualidade global do menu.
Fase posterior: perfis 2D (`polygon`, `circle`) + `extrude(profile, h)` e `revolve(profile)`.

### 2.5 Isometrias, escalas e transformações afins

- **Isometrias:** `T(x,y,z)` / `T(v)` / `Tx Ty Tz` (translação), `Rx(θ) Ry(θ) Rz(θ)` / `R(eixo, θ, ponto?)` (rotação), `Mx My Mz` / `M(normal, ponto?)` (reflexão) e `id`.
- **Escalas:** `S(k)` é uniforme (uma semelhança). `S(x, y, z)` / `S(v)` / `Sx Sy Sz` escalam por eixo. `scale(…)` é sinônimo de `S`. Fator zero é erro; fator negativo é reflexão.
- **Composição:** todas são valores do mesmo tipo (matriz afim 4×4). Compõem com `∘`, invertem com `⁻¹`, elevam com `^` e se aplicam com `·` a sólidos, pontos e listas.
- **Isometria ou não:** a composição de isometrias continua isometria, e `isometry(g)` testa isso. Com uma escala no meio, o tipo passa a ser "transformação afim", inclusive nas mensagens de erro.
- **`at(g, p)`:** aplica `g` em torno do ponto `p`, isto é, `T(p) ∘ g ∘ T(-p)`.
- **Orientação:** reflexões e escalas negativas (det < 0) reorientam as faces automaticamente.

### 2.6 Operações de conjunto

`A ∪ B`, `A ∩ B`, `A ∖ B`, `A △ B`, `∅` (elemento neutro de ∪), `⋃ xs`, `⋂ xs`.
Precedência (maior → menor): pós-fixos (chamada, `[i]`, `.x`, `°`, `²`, `⁻¹`) › `^` › `∘` › `-x √x` ›
`· × / mod` › `⋃ ⋂ Σ ∏` › `+ - ++` › `.. ..<` › `⊕` › `∩` › `∪ ∖ △` (mesmo nível, à esquerda, como `+ -`) ›
comparações encadeáveis › `¬ ∧ ∨` › `|>` › `↦ if let`.

### 2.7 Construções funcionais

```
# compreensão (notação de construção de conjuntos) → Lista
{ T(10i, 10j, 0) · cube(5) | i ∈ 0..4, j ∈ 0..4, i + j ≤ 4 }

# intervalos: fechado, semiaberto, com passo
0..10   0..<10   0..2..10

# grandes operadores aceitam qualquer coleção
⋃{ … }      ⋂ lista      Σ{ k² | k ∈ 1..10 }

# funções de ordem superior
map(f, xs)   filter(p, xs)   fold(f, inicial, xs)   reduce(f, xs)
zip(xs, ys)  len(xs)  xs[i]  xs ++ ys

# operadores como funções (seções)
reduce((∪), xs)    map((Rz(90°) ·), peças)

# pipe
0..<12 |> map(k ↦ Rz(30°k) · dente) |> reduce((∪))

# local e condicional
let h ≔ 10, w ≔ 2h in box(w, w, h)
if n > 3 then prism(n, 5, 2) else cylinder(5, 2)

# recursão (com limite de profundidade)
fractal(k) ≔ if k = 0 then cube(9)
             else ⋃{ T(3v) · fractal(k-1) | v ∈ cantos }
```

### 2.8 Objetos nomeados

Toda definição de topo sem parâmetros cujo valor é `Sólido` é um **objeto nomeado**:
aparece na lista lateral/menu, pode ser exibido e exportado como STL (`peça.stl`).
`⊢ e` define o que a viewport mostra; sem `⊢`, mostra o último sólido nomeado.

---

## 3. Pipeline de avaliação

```
texto ─► Lexer ─► Parser (Pratt) ─► AST ─► Avaliador ──► Manifold (WASM) ─► Malha ─► Viewer / STL
```

1. **Lexer**: entende Unicode; normaliza os aliases ASCII e `\latex` para os tokens canônicos. Decide as quebras de linha (continuação por indentação, operador ou colchete aberto).
2. **Parser**: Pratt, com recuperação de erro por instrução. Nós da AST carregam `span`.
3. **Avaliador**: interpretador de árvore. As definições de topo são preguiçosas, sem ordem fixa e com detecção de ciclo. Há limites de passos e de profundidade de recursão.
4. **Sólidos**: são construídos direto no `manifold-3d`, que já é preguiçoso e tem a união em lote (`⋃`). Os handles WASM ficam numa arena, liberada na avaliação seguinte. Isso substituiu o otimizador e o cache que estavam planejados.
5. **Worker**: guarda os sólidos da última execução válida e entrega a malha de outros objetos sob demanda. Com erro de sintaxe, mantém o último modelo. Execuções longas são canceladas reiniciando o worker.

## 4. Interface

```
┌──────────────────────────────────────────────────────────────────────┐
│ Arquivo  Editar  Exibir  Qualidade  Exemplos  Ajuda        ▶ Avaliar │  menu
├──────────────────────────────────────────────────────────────────────┤
│ ∪ ∩ ∖ △ ⋃ ⋂ ∈ ∘ · ↦ ⟨⟩ ° π √ ≔ ≤ ≥ ≠ ∅ ⊢                              │  paleta
├────────────────────────────┬─────────────────────────────────────────┤
│  1  n ≔ 8                  │                                         │
│  2  base ≔ cylinder(…)     │            viewport WebGL               │
│  3  peça ≔ base ∖ furos    │                                         │
│     ~~~~ erro sublinhado   │   ┌ objetos ─────┐                      │
│                            │   │ ● peça   ⤓   │  lista de nomeados   │
│                            │   │ ○ base   ⤓   │  (exibir / STL)      │
├────────────────────────────┴───┴──────────────┴──────────────────────┤
│ ✓ avaliado em 142 ms · 18 302 triângulos · peça: 60×60×20 mm         │  status
└──────────────────────────────────────────────────────────────────────┘
```

**Editor**
- Realce de sintaxe (tokens do próprio lexer — uma única fonte de verdade).
- Substituição automática estilo LaTeX: `\cup` + espaço/Tab → `∪`; `:=` → `≔`; `->` → `↦`.
- Paleta de símbolos clicável com tooltip (nome, atalho, alias ASCII).
- Erros sublinhados com mensagem ao passar o mouse; números de linha; Tab/indentação;
  desfazer nativo preservado; avaliação com debounce (~400 ms) ou Ctrl+Enter.
- Fonte com boa cobertura matemática (p.ex. JuliaMono embarcada como `.woff2` local,
  com fallback para fontes do sistema).

**Viewport**
- Câmera orbital (arrastar), pan (botão direito/Shift), zoom (roda), "enquadrar" (F),
  vistas padrão (frente/topo/lado/iso), perspectiva ↔ ortográfica.
- Sombreamento plano com iluminação de duas luzes; aramado opcional; grade da mesa em
  z = 0 com escala em mm; eixos XYZ coloridos; objetos não selecionados em modo
  "fantasma" translúcido opcional.

**Menu**
- *Arquivo*: novo, abrir `.csg`, salvar `.csg`, **exportar STL** (objeto selecionado;
  binário por padrão, ASCII opcional), exportar todos.
- *Exibir*: aramado, grade, eixos, normais, fantasmas, projeção, tema claro/escuro.
- *Qualidade*: segmentos por círculo (rascunho/normal/fino), avaliação automática on/off.
- *Exemplos*: biblioteca de programas que demonstram cada recurso.
- *Ajuda*: referência da linguagem e tabela de símbolos (gerada da mesma tabela do lexer).
- Autossalvamento em `localStorage`.

---

## 5. Estrutura de arquivos

```
index.html  css/style.css
vendor/manifold/           # manifold.js + manifold.wasm (únicas dependências)
js/
  main.js                  # controlador: editor, worker, viewer, menus, arquivos
  worker.js                # avalia e gera malhas fora da thread principal
  examples.js  help.js     # exemplos e referência (gerada da tabela de símbolos)
  lang/  symbols.js lexer.js parser.js evaluator.js values.js builtins.js interpreter.js errors.js
  geom/  kernel.js (manifold-3d) mat4.js mesh.js
  view/  viewer.js         # WebGL2
  editor/ editor.js highlight.js
  io/    stl.js
tests/   lang.test.js examples.test.js   # node --test
```

---

## 6. Etapas de implementação

1. ✅ **Geometria e STL**: matrizes de isometria, malha, escritor STL. O kernel passou a ser o `manifold-3d`.
2. ✅ **Linguagem**: lexer, parser, avaliador, prelúdio e testes (`npm test`).
3. ✅ **Visualizador**: WebGL2 com câmera orbital, grade, eixos, arestas e vistas padrão.
4. ✅ **Editor e interface**: realce, `\latex` com sugestões, substituições automáticas, paleta, menus, painel de objetos, exportação STL, autossalvamento e ajuda.
5. ✅ **Desempenho**: worker com cancelamento e `⋃` em lote no kernel.
6. Pendente: perfis 2D (`polygon`, `circle`) com `extrude` e `revolve` (o `CrossSection` do manifold já oferece isso) e mais exemplos.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| WASM não carrega (ex.: aberto via `file://`) | aviso na barra de status e na viewport; servir com `npm run serve` |
| Memória WASM crescendo | arena de handles liberada a cada avaliação |
| Editor caseiro com Unicode (seleção, IME, desfazer) | textarea nativa é a fonte da verdade; edições via `execCommand('insertText')` preservam o desfazer |
| Recursão ou compreensões explosivas | limites de passos e profundidade com erro claro; worker reiniciado se a avaliação passar de 1 s e houver nova edição |
