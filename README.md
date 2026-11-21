# CSG

Modelagem de sólidos por CSG (geometria construtiva de sólidos) com uma linguagem de inspiração matemática, para impressão 3D. Roda inteiramente no navegador.

```
furos ≔ ⋃{ Rz(k · 45°) · T(24, 0, 0) · cylinder(2, 10) | k ∈ 0..<8 }
peça  ≔ cylinder(30, 4) ∖ furos ∖ sphere(8)
⊢ peça
```

- **Aplicação:** https://vinicius-mello.github.io/csg/
- **Manual (PDF):** [docs/csg-manual.pdf](docs/csg-manual.pdf)

## Recursos

- Linguagem com notação de conjuntos: `∪ ∩ ∖ △ ⊕`, famílias `⋃ ⋂`, somatórios `Σ ∏`, compreensões `{ e | x ∈ A, condição }`.
- Isometrias, escalas e transformações afins como valores (`T`, `Rz`, `S`, `M`, composição `∘`, inversa `⁻¹`).
- Funções, aplicação parcial, seções `(∪)`, *pipes* `|>`, `map`, `filter`, `fold`, `reduce`.
- Editor com realce, atalhos estilo LaTeX (`\cup` → `∪`) e paleta de símbolos; visualização 3D em WebGL.
- Exportação de objetos nomeados em STL (binário ou ASCII).

## Executar localmente

Usa módulos ES e WebAssembly, então precisa ser servida por HTTP:

```sh
npm install          # só para testes e para o manual
npm run vendor       # copia o manifold-3d para vendor/ (já versionado)
npm run serve        # http://localhost:8000
npm test
```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `js/lang/` | léxico, parser (Pratt), avaliador e funções embutidas |
| `js/geom/` | núcleo geométrico sobre o [manifold](https://github.com/elalish/manifold) |
| `js/editor/`, `js/view/` | editor e visualizador WebGL2 |
| `js/io/` | STL |
| `docs/` | manual em LaTeX (`npm run manual` gera `csg-manual.pdf`) |
| `fonts/` | JuliaMono (SIL OFL 1.1), reduzida aos símbolos da linguagem |

## Dependências

Apenas o [manifold-3d](https://github.com/elalish/manifold) (Apache 2.0), incluído em `vendor/`. As fontes JuliaMono são distribuídas sob a SIL Open Font License 1.1 (`fonts/JuliaMono-LICENSE.txt`).
