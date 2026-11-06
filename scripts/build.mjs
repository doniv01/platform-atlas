import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { NOTICE_FILES, readRegistry, STATIC_ENTRIES, validateStaticTree } from './manifest.mjs';
import { isMain, isWithin, parseOptions, PROJECT_ROOT, safeChild, walkFiles } from './lib/paths.mjs';

function copyTree(root, source, destination) {
  const files = lstatSync(source).isDirectory() ? walkFiles(root, source) : [source];
  for (const file of files) {
    const target = file === source ? destination : join(destination, relative(source, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
  }
}

function addExploratoryPack(root, stage, pack) {
  const directory = safeChild(root, pack);
  if (!isWithin(join(root, 'generated'), directory) || directory === join(root, 'generated')) throw new Error('--pack must name a directory inside generated/.');
  const provenance = JSON.parse(readFileSync(safeChild(root, join(directory, 'provenance.json')), 'utf8'));
  if (!/^(woocommerce|gumroad)-exploratory$/.test(provenance.packId) || provenance.evidenceMode !== 'generated-exploratory' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(provenance.commit)) throw new Error('Invalid exploratory pack provenance.');
  const data = readFileSync(safeChild(root, join(directory, 'atlas.json')));
  if (createHash('sha256').update(data).digest('hex') !== provenance.atlasDocumentSha256) throw new Error('Exploratory atlas.json hash does not match provenance.');
  const destination = join(stage, 'atlases', provenance.packId);
  mkdirSync(destination);
  for (const name of ['atlas-data.mjs', 'provenance.json', 'atlas.json', 'scanner.config.json', 'README.md']) copyFileSync(safeChild(root, join(directory, name)), join(destination, name));
  const htmlPath = join(stage, 'index.html');
  let html = readFileSync(htmlPath, 'utf8');
  const registry = readRegistry(html);
  // The default's repository identity can also match its curated sibling.
  // Place this entry first so repository-based picker fallback selects it.
  registry.unshift({ id: provenance.packId, title: `${provenance.atlas === 'woocommerce' ? 'WooCommerce' : 'Gumroad'} · exploratory`, repository: provenance.repository, summary: `Generated source relationships at ${provenance.commit.slice(0, 12)}; inferred, not curated.`, mark: './assets/repository-mark.svg' });
  html = html.replace(/(<script\b(?=[^>]*\bid=["']atlas-registry["'])[^>]*>)[\s\S]*?(<\/script>)/i, (_, start, end) => `${start}${JSON.stringify(registry).replaceAll('<', '\\u003c')}${end}`);
  let replaced = false;
  html = html.replace(/<meta\b(?=[^>]*\bname=["']atlas-module["'])[^>]*>/i, () => {
    replaced = true;
    return `<meta name="atlas-module" content="./atlases/${provenance.packId}/atlas-data.mjs" />`;
  });
  if (!replaced) throw new Error('Missing atlas-module metadata.');
  writeFileSync(htmlPath, html);
  return provenance;
}

export function build({ root = PROJECT_ROOT, pack } = {}) {
  const dist = safeChild(root, 'dist');
  if (existsSync(dist)) {
    const marker = safeChild(root, 'dist/build-manifest.json');
    if (!existsSync(marker) || JSON.parse(readFileSync(marker, 'utf8')).builder !== 'platform-atlas-static-v1') throw new Error('Refusing to replace an unrecognized dist/. Move it aside before building.');
    walkFiles(root, dist); // Reject symlinks before replacing a previous output.
  }
  const workspace = mkdtempSync(join(root, '.dist-'));
  const stage = join(workspace, 'site');
  mkdirSync(stage);
  let previous;
  try {
    for (const entry of [...STATIC_ENTRIES, ...NOTICE_FILES]) copyTree(root, safeChild(root, entry), join(stage, entry));
    const provenance = pack ? addExploratoryPack(root, stage, pack) : undefined;
    const manifest = validateStaticTree(stage);
    validateStaticTree(stage, { basePath: '/project-path-check/' });
    const hashes = Object.fromEntries(walkFiles(stage).map((file) => [relative(stage, file).split('\\').join('/'), createHash('sha256').update(readFileSync(file)).digest('hex')]));
    writeFileSync(join(stage, '.nojekyll'), '');
    writeFileSync(join(stage, 'build-manifest.json'), `${JSON.stringify({ builder: 'platform-atlas-static-v1', schemaVersion: 1, entries: STATIC_ENTRIES, checkedReferences: manifest.checkedReferences, files: hashes, ...(provenance ? { exploratory: provenance } : {}) }, null, 2)}\n`);
    if (existsSync(dist)) { previous = join(workspace, 'previous'); renameSync(dist, previous); }
    try { renameSync(stage, dist); }
    catch (error) { if (previous) { renameSync(previous, dist); previous = undefined; } throw error; }
    if (previous) { rmSync(previous, { recursive: true }); previous = undefined; }
    return { output: dist, files: Object.keys(hashes).length, checkedReferences: manifest.checkedReferences };
  } finally {
    // All deleted paths are inside this build's newly allocated temporary folder.
    // Preserve it if rollback failed so the previous build can be recovered.
    if (!previous) rmSync(workspace, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), ['pack']);
    if (options.help) console.log('npm run build [-- --pack generated/name]\nCopy the static allowlist into dist/ and verify root and project-path references.');
    else { const result = build(options); console.log(`Built dist/: ${result.files} files, ${result.checkedReferences} local references checked at / and /project-path-check/.`); }
  } catch (error) { console.error(`build: ${error.message}`); process.exitCode = 1; }
}
