/**
 * golden/storage.mjs — the data layer that must never lose the corpus (AUDIT §1).
 *
 * Locks in:
 *  - setSettings can NEVER touch _store keys (the saveSettings clobber bug)
 *  - concurrent store persists both land (no lost-update race)
 *  - rapid writes coalesce (debounce) and never overlap (serialized)
 *  - every write keeps the previous good version in .bak; a corrupt main
 *    file restores from .bak on load
 *  - migrations: derived indexes stripped from the blob; secrets extracted
 *    for device-local storage and blanked in the persisted copy
 *
 * Run:  node golden/storage.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DM = await import(pathToFileURL(join(HERE, '..', 'src', 'data', 'data-manager.ts')).href);
const MIG = await import(pathToFileURL(join(HERE, '..', 'src', 'data', 'blob-migrations.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const MAIN = 'data.json', BAK = 'data.json.bak';
const makeIO = () => {
  const files = new Map();
  let inFlight = 0;
  const stats = { mainWrites: 0, maxInFlight: 0 };
  return {
    files, stats,
    read: async (p) => (files.has(p) ? files.get(p) : null),
    write: async (p, t) => {
      inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2)); // writes take time — exposes overlap
      files.set(p, t);
      if (p === MAIN) stats.mainWrites++;
      inFlight--;
    },
  };
};
const dmWith = async (io, debounceMs = 5) => {
  const dm = new DM.DataManager(io, MAIN, BAK, debounceMs);
  const res = await dm.load();
  return { dm, res };
};
const disk = (io) => JSON.parse(io.files.get(MAIN));

console.log('══ DataManager: canonical blob ══');
{
  const io = makeIO();
  const { dm, res } = await dmWith(io);
  check('absent file → empty blob, not corrupt', !res.corrupt && !res.restoredFromBackup && !dm.has('_x'));

  await dm.setKey('_patternStore', { entries: [1, 2, 3] });
  check('setKey persists', disk(io)._patternStore.entries.length === 3);

  await dm.setKey('_srsDeck', { cards: 1 });
  check('setKey preserves sibling keys', disk(io)._patternStore.entries.length === 3 && disk(io)._srsDeck.cards === 1);
}

console.log('══ the §1.1 clobber: settings writes cannot touch stores ══');
{
  const io = makeIO();
  io.files.set(MAIN, JSON.stringify({ theme: 'old', _patternStore: { entries: [1, 2] } }));
  const { dm } = await dmWith(io);
  // a hostile/stale settings object even INCLUDING a _key must not clobber
  await dm.setSettings({ theme: 'new', maxResults: 50, _patternStore: 'STALE-SNAPSHOT' });
  const d = disk(io);
  check('settings keys replaced', d.theme === 'new' && d.maxResults === 50);
  check('_store keys untouched by setSettings', JSON.stringify(d._patternStore) === JSON.stringify({ entries: [1, 2] }));
  check('settingsSlice excludes _keys', !('_patternStore' in dm.settingsSlice()));
}

console.log('══ concurrency + debounce ══');
{
  const io = makeIO();
  const { dm } = await dmWith(io);
  await Promise.all([dm.setKey('_a', 1), dm.setKey('_b', 2), dm.setKey('_c', 3)]);
  const d = disk(io);
  check('concurrent persists all land', d._a === 1 && d._b === 2 && d._c === 3);
  check('rapid writes coalesce into one', io.stats.mainWrites === 1, `writes=${io.stats.mainWrites}`);

  const p1 = (dm.setKey('_d', 4), dm.flush());
  const p2 = (dm.setKey('_e', 5), dm.flush());
  await Promise.all([p1, p2]);
  check('writes never overlap (serialized)', io.stats.maxInFlight === 1, `maxInFlight=${io.stats.maxInFlight}`);
  check('later flush still lands everything', disk(io)._d === 4 && disk(io)._e === 5);
}

console.log('══ .bak: crash safety ══');
{
  const io = makeIO();
  io.files.set(MAIN, JSON.stringify({ _p: 'v1' }));
  const { dm } = await dmWith(io);
  await dm.setKey('_p', 'v2');
  check('.bak holds previous good version', JSON.parse(io.files.get(BAK))._p === 'v1' && disk(io)._p === 'v2');
  await dm.setKey('_p', 'v3');
  check('.bak rolls forward', JSON.parse(io.files.get(BAK))._p === 'v2' && disk(io)._p === 'v3');

  const io2 = makeIO();
  io2.files.set(MAIN, '{"_p": TRUNCATED');
  io2.files.set(BAK, JSON.stringify({ _p: 'good' }));
  const { dm: dm2, res: res2 } = await dmWith(io2);
  check('corrupt main restores from .bak', res2.restoredFromBackup && dm2.get('_p') === 'good');
  await dm2.flush();
  check('restore re-materializes main on disk (no 0-byte window)', JSON.parse(io2.files.get(MAIN))._p === 'good');

  const io2b = makeIO();
  io2b.files.set(MAIN, ''); // truncated to zero bytes mid-write (observed live)
  io2b.files.set(BAK, JSON.stringify({ _p: 'good' }));
  const { res: res2b } = await dmWith(io2b);
  check('0-byte main also restores from .bak', res2b.restoredFromBackup && !res2b.corrupt);

  const io3 = makeIO();
  io3.files.set(MAIN, 'not json');
  const { res: res3 } = await dmWith(io3);
  check('corrupt main + no bak → flagged corrupt, empty start', res3.corrupt && !res3.restoredFromBackup);
}

console.log('══ migrations: derived indexes out of the blob ══');
{
  const blob = { _surferBridge: { entries: { a: 1 }, discourseIndex: { huge: true }, kwicIndex: { huge: true }, engineVersion: 2 } };
  check('stripDerivedIndexes reports change', MIG.stripDerivedIndexes(blob) === true);
  check('indexes gone, entries kept', !('discourseIndex' in blob._surferBridge) && !('kwicIndex' in blob._surferBridge) && blob._surferBridge.entries.a === 1);
  check('idempotent (second run: no change)', MIG.stripDerivedIndexes(blob) === false);
  check('no _surferBridge → no change', MIG.stripDerivedIndexes({}) === false);
}

console.log('══ migrations: secrets leave the synced file ══');
{
  const blob = {
    x: { enabled: true, authToken: 'AT', csrfToken: 'CT', bearerToken: 'public-bearer' },
    ytHistory: { cookie: 'YTC' },
    notes: { ocrApiKey: 'sk-ant-xxx', langPref: 'ja' },
  };
  const { changed, secrets } = MIG.extractSecrets(blob);
  check('secrets extracted', changed && secrets.xAuthToken === 'AT' && secrets.xCsrfToken === 'CT' && secrets.ytCookie === 'YTC' && secrets.ocrApiKey === 'sk-ant-xxx');
  check('blob fields blanked in place', blob.x.authToken === '' && blob.x.csrfToken === '' && blob.ytHistory.cookie === '' && blob.notes.ocrApiKey === '');
  check('non-secrets untouched (bearer is public)', blob.x.bearerToken === 'public-bearer' && blob.notes.langPref === 'ja');
  check('already-clean blob → no change', MIG.extractSecrets(blob).changed === false);
}

console.log('══ alignBackup: no secret-bearing generation survives in .bak ══');
{
  const io = makeIO();
  io.files.set(MAIN, JSON.stringify({ x: { authToken: 'SECRET-AT', csrfToken: 'SECRET-CT' }, _patternStore: { entries: [1] } }));
  const { dm } = await dmWith(io);
  await dm.mutate((blob) => MIG.extractSecrets(blob).changed);
  // normal rolling backup: .bak now holds the PRE-scrub version (has secrets)
  check('(precondition) .bak briefly holds secrets', io.files.get(BAK).includes('SECRET-AT'));
  await dm.alignBackup();
  check('alignBackup scrubs the backup generation', !io.files.get(BAK).includes('SECRET-AT') && !io.files.get(BAK).includes('SECRET-CT'));
  check('corpus intact in both files', disk(io)._patternStore.entries.length === 1 && JSON.parse(io.files.get(BAK))._patternStore.entries.length === 1);
}

console.log('══ scrubSettingsForPersist: live object keeps secrets ══');
{
  const live = {
    maxResults: 20,
    x: { authToken: 'AT', csrfToken: 'CT', bearerToken: 'B' },
    ytHistory: { cookie: 'YTC' },
    notes: { ocrApiKey: 'KEY' },
    plex: { baseUrl: 'http://10.0.0.162:32400', token: 'PLEXTOK' },
    jimaku: { apiKey: 'JIMAKUKEY', mode: 'fallback' },
  };
  const { scrubbed, secrets } = MIG.scrubSettingsForPersist(live);
  check('persisted copy is scrubbed', scrubbed.x.authToken === '' && scrubbed.x.csrfToken === '' && scrubbed.ytHistory.cookie === '' && scrubbed.notes.ocrApiKey === '');
  check('secrets returned for localStorage', secrets.xAuthToken === 'AT' && secrets.ocrApiKey === 'KEY');
  check('LIVE settings object untouched', live.x.authToken === 'AT' && live.notes.ocrApiKey === 'KEY');
  check('non-secret fields survive scrub', scrubbed.maxResults === 20 && scrubbed.x.bearerToken === 'B');
  // AUDIT §2: every credential, including the newest one, stays out of the
  // blob that syncs with the vault.
  check('the Plex token is scrubbed', scrubbed.plex.token === '' && secrets.plexToken === 'PLEXTOK');
  check('the jimaku API key is scrubbed too',
    scrubbed.jimaku.apiKey === '' && secrets.jimakuApiKey === 'JIMAKUKEY', JSON.stringify(scrubbed.jimaku));
  check('and the non-secret jimaku settings survive', scrubbed.jimaku.mode === 'fallback');
  check('the live jimaku key is untouched', live.jimaku.apiKey === 'JIMAKUKEY');

  // The one-time migration for a blob written before the key existed.
  const blob = { jimaku: { apiKey: 'OLD', mode: 'always' }, plex: { token: 'P' } };
  const ex = MIG.extractSecrets(blob);
  check('an already-persisted jimaku key is migrated OUT of the blob',
    ex.changed && ex.secrets.jimakuApiKey === 'OLD' && blob.jimaku.apiKey === '', JSON.stringify(blob));
}

// ═══════════════════════════════════════════════════════════════════════════
// Partitioning. Measured 2026-08-06 on the live vault: data.json was 15.17MB,
// of which _patternStore was 11.4MB, and EVERY debounced save rewrote all of
// it twice (bak + main). ~30MB of IO to record that a checkbox moved — which
// is why the iPad stalls. These checks pin the property that fixes it: a save
// touches only the files whose keys changed.
// ═══════════════════════════════════════════════════════════════════════════
const PDIR = 'p';
const PART = (k) => `${PDIR}/part${k}.json`;
const makeIO2 = () => {
  const files = new Map();
  const order = [];                       // every path written/removed, in order
  const bytes = new Map();
  return {
    files, order, bytes,
    reset: () => { order.length = 0; bytes.clear(); },
    wrote: () => [...bytes.values()].reduce((a, b) => a + b, 0),
    read: async (p) => (files.has(p) ? files.get(p) : null),
    write: async (p, t) => { files.set(p, t); order.push(p); bytes.set(p, (bytes.get(p) ?? 0) + t.length); },
    remove: async (p) => { files.delete(p); order.push(`rm:${p}`); },
  };
};
const partDM = (io, min = 4096) => new DM.DataManager(io, MAIN, BAK, 5, { dir: PDIR, minChars: min });
const HEAVY = { entries: Array.from({ length: 400 }, (_, i) => ({ i, quote: 'あ'.repeat(60) })) };

console.log('══ partitioning: one heavy key must not make every save heavy ══');
{
  const io = makeIO2();
  const dm = partDM(io);
  await dm.load();
  await dm.setKey('_patternStore', HEAVY);
  await dm.setKey('_srsDeck', { cards: 3 });

  const d = disk(io);
  check('heavy key moved to its own file', io.files.has(PART('_patternStore')));
  check('main no longer carries it', !('_patternStore' in d));
  check('main carries the manifest', Array.isArray(d._parts) && d._parts.join() === '_patternStore');
  check('a small key stays inline', d._srsDeck.cards === 3);
  check('partitionedKeys() reports it', dm.partitionedKeys().join() === '_patternStore');

  // THE POINT OF ALL OF THIS
  io.reset();
  await dm.setKey('_srsDeck', { cards: 4 });
  check('a small save does not touch the heavy file',
    !io.order.some((p) => p.includes('part_patternStore')), io.order.join(' '));
  check('…and costs a rounding error in bytes', io.wrote() < 2000, `${io.wrote()} chars written`);

  // and the heavy key still saves when it is the one that changed
  io.reset();
  await dm.setKey('_patternStore', { entries: [{ i: 0, quote: 'あ'.repeat(6000) }] });
  check('a heavy save writes the heavy file', io.order.includes(PART('_patternStore')));
  check('…and does NOT rewrite it twice per flush',
    io.order.filter((p) => p === PART('_patternStore')).length === 1, io.order.join(' '));
}

console.log('══ partitioning: round-trip and write ORDER ══');
{
  const io = makeIO2();
  const dm = partDM(io);
  await dm.load();
  io.reset();
  await dm.setKey('_patternStore', HEAVY);
  // main is what promises the partition exists, so it must land LAST — the
  // dropSidecar lesson: an interrupted write must never leave a pointer to
  // something that is not there.
  check('partition file is written BEFORE the main manifest',
    io.order.indexOf(PART('_patternStore')) < io.order.indexOf(MAIN), io.order.join(' '));

  await dm.setKey('_srsDeck', { cards: 9 });
  const dm2 = partDM(io);
  const r2 = await dm2.load();
  check('reload restores the partitioned value byte-for-byte',
    JSON.stringify(dm2.get('_patternStore')) === JSON.stringify(HEAVY));
  check('reload restores inline values', dm2.get('_srsDeck').cards === 9);
  check('the manifest never leaks into the blob as a store', !dm2.has('_parts'));
  check('nothing reported missing', r2.missingPartitions.length === 0);
  check('settingsSlice still excludes partitioned stores', !('_patternStore' in dm2.settingsSlice()));
}

console.log('══ partitioning: a missing file is NOT an empty store ══');
{
  const io = makeIO2();
  io.files.set(MAIN, JSON.stringify({ _parts: ['_patternStore'], _srsDeck: { cards: 1 } }));
  const dm = partDM(io);
  const res = await dm.load();
  check('a promised-but-missing partition is REPORTED', res.missingPartitions.join() === '_patternStore');
  check('…and the key is ABSENT, not empty', !dm.has('_patternStore'));
  check('…and it is not counted as corruption of the whole blob', !res.corrupt);

  let refused = false;
  await dm.setKey('_patternStore', { entries: [] }).catch(() => { refused = true; });
  check('…and writes to it are REFUSED', refused);
  check('…so the default never reaches disk', !io.files.has(PART('_patternStore')));

  await dm.setKey('_srsDeck', { cards: 2 });
  check('other keys keep saving normally', disk(io)._srsDeck.cards === 2);
  check('the manifest KEEPS the missing key (a late sync can still fill it)',
    disk(io)._parts.join() === '_patternStore', JSON.stringify(disk(io)._parts));
  check('quarantinedKeys() names it', dm.quarantinedKeys().join() === '_patternStore');
}

console.log('══ partitioning: a partition has its own .bak ══');
{
  const io = makeIO2();
  const dm = partDM(io);
  await dm.load();
  const big = (tag) => ({ entries: [tag, 'x'.repeat(5000)] });   // over minChars
  await dm.setKey('_patternStore', big('v1'));
  await dm.setKey('_patternStore', big('v2'));
  check('partition .bak holds the previous good version',
    JSON.parse(io.files.get(`${PART('_patternStore')}.bak`)).entries[0] === 'v1');

  const io2 = makeIO2();
  io2.files.set(MAIN, JSON.stringify({ _parts: ['_patternStore'] }));
  io2.files.set(PART('_patternStore'), '{"entries": TRUNCA');
  io2.files.set(`${PART('_patternStore')}.bak`, JSON.stringify(big('good')));
  const dm2 = partDM(io2);
  const res2 = await dm2.load();
  check('a corrupt partition restores from its .bak',
    res2.missingPartitions.length === 0 && dm2.get('_patternStore').entries[0] === 'good');
  await dm2.flush();
  check('…and the corpse is overwritten with the good copy',
    JSON.parse(io2.files.get(PART('_patternStore'))).entries[0] === 'good');
}

console.log('══ partitioning: hysteresis, demotion, and off-by-default ══');
{
  const io = makeIO2();
  const dm = partDM(io, 1000);
  await dm.load();
  await dm.setKey('_p', { s: 'x'.repeat(1100) });
  check('over the line → promoted', io.files.has(PART('_p')));
  io.reset();
  await dm.setKey('_p', { s: 'x'.repeat(900) });      // under minChars, over half
  check('just under the line → STAYS partitioned (no flip-flop)',
    dm.partitionedKeys().join() === '_p' && !io.order.some((p) => p.startsWith('rm:')));
  await dm.setKey('_p', { s: 'x'.repeat(100) });      // under half → demote
  check('well under → demoted back inline', dm.partitionedKeys().length === 0 && disk(io)._p.s.length === 100);
  check('…and its file is removed', !io.files.has(PART('_p')));
  check('…and the manifest is gone with it', !('_parts' in disk(io)));

  // No partition options → byte-identical to the single-file manager. Every
  // check above this section runs in that mode and must keep passing.
  const io3 = makeIO();
  const dm3 = new DM.DataManager(io3, MAIN, BAK, 5);
  await dm3.load();
  await dm3.setKey('_patternStore', HEAVY);
  check('partitioning OFF → everything stays in data.json',
    JSON.parse(io3.files.get(MAIN))._patternStore.entries.length === 400
    && ![...io3.files.keys()].some((p) => p.startsWith(PDIR)));
}

console.log('══ repartition(): the split happens at load, not under a tap ══');
{
  const io = makeIO2();
  io.files.set(MAIN, JSON.stringify({ theme: 'x', _patternStore: HEAVY, _srsDeck: { cards: 1 } }));
  const dm = partDM(io);
  await dm.load();
  check('(precondition) loaded from a single legacy file', dm.get('_patternStore').entries.length === 400);
  await dm.repartition();
  check('repartition splits the heavy key out', io.files.has(PART('_patternStore')));
  check('…and the legacy shape survives one generation in .bak',
    JSON.parse(io.files.get(BAK))._patternStore.entries.length === 400);
  check('…and settings are untouched', disk(io).theme === 'x');
  io.reset();
  await dm.repartition();
  check('repartition is idempotent (no writes the second time)', io.order.length === 0, io.order.join(' '));
}

console.log(fail ? `\n✗ storage: ${fail} failed (${pass} passed)` : `\n✓ storage: all ${pass} pass`);
process.exit(fail ? 1 : 0);
