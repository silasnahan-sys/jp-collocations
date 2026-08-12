/**
 * golden/stub/loader.mjs — resolve `obsidian` to a stub so UI modules can load.
 *
 * The harness loads TypeScript straight from `src/` under Node's strip-only
 * type loader, which is why almost every golden covers a PURE module: the
 * moment a file imports `obsidian`, Node cannot resolve it (the installed
 * package is `.d.ts` only — there is no JavaScript in it at all) and the suite
 * dies at import time.
 *
 * That is the reason the input layer had no coverage. `drag-out.ts` reaches
 * `posture.ts` through `pointer-drag.ts`, `posture.ts` imports `Platform`, and
 * the whole subtree became untestable — including two rules the plugin had
 * already been bitten by and written down.
 *
 * Registered at runtime from inside a suite (`module.register`), so suites stay
 * plain `node golden/<name>.mjs` with no flags and `all.mjs` needs no special
 * case.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OBSIDIAN = pathToFileURL(join(HERE, 'obsidian.mjs')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'obsidian') return { url: OBSIDIAN, shortCircuit: true };
  return next(specifier, context);
}
