# _attic

Unreachable code moved out of `src/` (AUDIT §3, 2026-07-18). Verified dead two
ways: absent from the esbuild metafile AND not `import type`-referenced by any
live file (type-only imports are erased by the bundler, so the metafile alone
is not proof — `surfer-types.ts` stays in `src/` for exactly that reason).

Contents: the citation L1–L5 pipeline, `rhetorical-*` modules,
`program-builder`, `schema-driven-l4`, `TextClassifier`, and the duplicate
upper-cased SRS pair (`ChunkExtractor`/`CardGenerator` — the live ones are the
lower-cased files in `src/srs/`).

These are kept for reference, not compiled (`tsconfig` includes `src/` only).
If you resurrect one, move it back into `src/` and wire it from `main.ts`.
