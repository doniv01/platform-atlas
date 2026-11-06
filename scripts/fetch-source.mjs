import { lstatSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gitText } from './lib/git.mjs';
import { isMain, managedDirectory, parseOptions, PROJECT_ROOT, safeChild } from './lib/paths.mjs';

export const SOURCES = Object.freeze({
  woocommerce: Object.freeze({ repository: 'woocommerce/woocommerce', url: 'https://github.com/woocommerce/woocommerce.git' }),
  gumroad: Object.freeze({ repository: 'antiwork/gumroad', url: 'https://github.com/antiwork/gumroad.git' }),
});

export function sourceFor(id) {
  if (!Object.hasOwn(SOURCES, id)) throw new Error('Choose --atlas woocommerce or --atlas gumroad.');
  return SOURCES[id];
}

export function parseRemoteHead(text) {
  const lines = text.trim().split(/\r?\n/);
  const refs = lines.map((line) => /^ref: (refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/+\-]*)\tHEAD$/.exec(line)).filter(Boolean);
  const commits = lines.map((line) => /^([a-f0-9]{40}|[a-f0-9]{64})\tHEAD$/.exec(line)).filter(Boolean);
  if (refs.length !== 1 || commits.length !== 1) throw new Error('Remote must advertise exactly one default branch and full HEAD SHA.');
  const ref = refs[0][1];
  if (ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.lock')) throw new Error('Unsafe default branch ref.');
  return { defaultBranch: ref.slice('refs/heads/'.length), ref, commit: commits[0][1] };
}

export function fetchSource({ atlas, root = PROJECT_ROOT, git = gitText }) {
  const source = sourceFor(atlas);
  // Resolve HEAD on every invocation, then fetch exactly that SHA. Branch movement
  // during the fetch cannot silently change the snapshot we recorded.
  const head = parseRemoteHead(git(['ls-remote', '--symref', source.url, 'HEAD']));
  const cache = managedDirectory(root, '.cache');
  const snapshots = managedDirectory(root, '.cache/sources');
  const directory = mkdtempSync(join(snapshots, `${atlas}-${head.commit.slice(0, 12)}-`));
  git(['init', '--bare', '--template=', directory]);
  git(['-C', directory, 'config', 'remote.origin.url', source.url]);
  git(['-C', directory, 'fetch', '--depth=1', '--no-tags', '--no-recurse-submodules', source.url, head.commit], { timeout: 300000 });
  const actual = git(['-C', directory, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
  if (actual !== head.commit) throw new Error('Fetched SHA does not match the advertised remote HEAD.');
  const provenance = {
    schemaVersion: '1.0.0',
    atlas,
    repository: source.repository,
    remoteUrl: source.url.replace(/\.git$/, ''),
    ...head,
    fetchedAt: new Date().toISOString(),
    snapshot: relative(root, directory).split('\\').join('/'),
    resolution: 'Default remote HEAD observed at fetch time; not a permanent latest claim.',
  };
  const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
  writeFileSync(join(directory, 'atlas-provenance.json'), serialized, { flag: 'wx' });
  // Only the tool-owned pointer is replaced. Previous snapshots remain intact.
  const pointer = safeChild(root, `.cache/${atlas}-latest.json`);
  try {
    if (!lstatSync(pointer).isFile()) throw new Error(`Expected regular pointer file: ${pointer}`);
    const previous = JSON.parse(readFileSync(pointer, 'utf8'));
    if (previous.atlas !== atlas || previous.repository !== source.repository) throw new Error('Cache pointer is not owned by this source.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(cache, `${atlas}-${head.commit}-${Date.now()}.tmp`);
  writeFileSync(temporary, serialized, { flag: 'wx' });
  renameSync(temporary, pointer);
  return provenance;
}

if (isMain(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), ['atlas']);
    if (options.help) console.log('npm run source:fetch -- --atlas <woocommerce|gumroad>\nFetch the default remote HEAD into a new, ignored .cache/sources/ bare snapshot.');
    else {
      const result = fetchSource({ atlas: options.atlas });
      console.log(`${result.repository}\nDefault branch: ${result.defaultBranch}\nPinned SHA: ${result.commit}\nFetched: ${result.fetchedAt}\nSnapshot: ${result.snapshot}\nNext: npm run atlas:generate -- --atlas ${result.atlas}`);
    }
  } catch (error) { console.error(`source:fetch: ${error.message}`); process.exitCode = 1; }
}
