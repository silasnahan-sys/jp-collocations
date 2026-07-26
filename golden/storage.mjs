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
  };
  const { scrubbed, secrets } = MIG.scrubSettingsForPersist(live);
  check('persisted copy is scrubbed', scrubbed.x.authToken === '' && scrubbed.x.csrfToken === '' && scrubbed.ytHistory.cookie === '' && scrubbed.notes.ocrApiKey === '');
  check('secrets returned for localStorage', secrets.xAuthToken === 'AT' && secrets.ocrApiKey === 'KEY');
  check('LIVE settings object untouched', live.x.authToken === 'AT' && live.notes.ocrApiKey === 'KEY');
  check('non-secret fields survive scrub', scrubbed.maxResults === 20 && scrubbed.x.bearerToken === 'B');
}

console.log(fail ? `\n✗ storage: ${fail} failed (${pass} passed)` : `\n✓ storage: all ${pass} pass`);
process.exit(fail ? 1 : 0);
