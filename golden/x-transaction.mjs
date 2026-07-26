/**
 * golden/x-transaction.mjs — proves the in-plugin x-client-transaction-id
 * generator is byte-identical to the canonical reference implementation
 * (github.com/Lqm1/x-client-transaction-id).
 *
 * Fully offline + deterministic: runs against frozen X fixtures
 * (fixtures/x_home.html + fixtures/ondemand.s.js) with an injected timestamp
 * and random byte, so the entire transaction id — not just the animation key —
 * is asserted equal to a value independently computed by the reference.
 *
 * Ground truth (reference, GET /i/api/graphql/Bcw3RzK-PatNAmbnw54hFw/
 * SearchTimeline, timeNow=123456789, randomByte=128, these exact fixtures):
 *   animationKey = 10bd57d0f5c28f5c28f5c04a3d70a3d70a3c04a3d70a3d70a3c0f5c28f5c28f5c00
 *   tid          = gDMFEFDu9fF/nBux3S+8XbUdE8A/7aW+vDRZENM5GBcvtNr30IN7mz2m52qA+DAMrJVN24f0jA8zwm/CPnDO2f3qX2Hegw
 *
 * If these change, X rotated its shell — re-freeze the fixtures AND re-run the
 * reference to regenerate the expected values (do not hand-edit them).
 *
 * Run:  node golden/x-transaction.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(join(HERE, '..', 'node_modules', 'esbuild'));

// Frozen fixtures + the reference's ground-truth outputs for them.
const HTML = readFileSync(join(HERE, 'fixtures', 'x_home.html'), 'utf8');
const ONDEMAND = readFileSync(join(HERE, 'fixtures', 'ondemand.s.js'), 'utf8');
const ONDEMAND_URL = 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.e3d9a21a.js';
const FIXED_TIME = 123456789;
const FIXED_RANDOM = 128;
const PATH = '/i/api/graphql/Bcw3RzK-PatNAmbnw54hFw/SearchTimeline';
const EXPECT_ANIM = '10bd57d0f5c28f5c28f5c04a3d70a3d70a3c04a3d70a3d70a3c0f5c28f5c28f5c00';
const EXPECT_TID = 'gDMFEFDu9fF/nBux3S+8XbUdE8A/7aW+vDRZENM5GBcvtNr30IN7mz2m52qA+DAMrJVN24f0jA8zwm/CPnDO2f3qX2Hegw';

// Bundle the plugin module (obsidian not referenced by it, but stub anyway).
const outdir = mkdtempSync(join(tmpdir(), 'jpc-xtxn-'));
const outfile = join(outdir, 'xtxn.cjs');
await esbuild.build({
  entryPoints: [join(HERE, '..', 'src', 'x', 'XTransactionId.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent',
});
const { XTransactionGenerator, resolveOnDemandUrl, extractIndices } = require(outfile);

let failures = 0, checks = 0;
const check = (ok, msg) => { checks++; console.log(`  ${ok ? '✓' : (failures++, '✗')} ${msg}`); };

// Injected deps: serve the frozen fixtures instead of the network.
const deps = {
  parseHtml: (html) => parseHTML(html).document,
  async fetchText(url) {
    if (url === 'https://x.com/home') return HTML;
    if (url.includes('ondemand.s')) return ONDEMAND;
    throw new Error(`unexpected fetch: ${url}`);
  },
};

console.log('\n══ Extraction (against the frozen X shell) ══');
check(resolveOnDemandUrl(HTML) === ONDEMAND_URL, `ondemand URL resolves (${resolveOnDemandUrl(HTML)})`);
const idx = extractIndices(ONDEMAND);
check(JSON.stringify(idx) === JSON.stringify([41, 9, 34, 15]), `key-byte indices [41,9,34,15] (got ${JSON.stringify(idx)})`);

console.log('\n══ Byte-identical to the reference implementation ══');
const gen = await XTransactionGenerator.create(deps);
check(gen.getAnimationKey() === EXPECT_ANIM, `animationKey matches reference`);
if (gen.getAnimationKey() !== EXPECT_ANIM) console.log(`      got: ${gen.getAnimationKey()}`);

const tid = await gen.generate('GET', PATH, FIXED_TIME, FIXED_RANDOM);
check(tid === EXPECT_TID, `transaction id matches reference (deterministic time+random)`);
if (tid !== EXPECT_TID) console.log(`      got:      ${tid}\n      expected: ${EXPECT_TID}`);

console.log('\n══ Shape sanity (live-mode output) ══');
const live = await gen.generate('GET', PATH); // real time + random
check(/^[A-Za-z0-9+/]+$/.test(live) && live.length >= 80, `live id is base64, ${live.length} chars`);
const live2 = await gen.generate('GET', PATH);
check(live !== live2, `consecutive live ids differ (random mask applied)`);

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures}/${checks} x-transaction checks pass`);
process.exit(failures ? 1 : 0);
