import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { canonicalStringify, generateAtlas, loadConfig } from './atlas-generate.mjs';
import { sourceFor } from './fetch-source.mjs';
import { createAdapter, createViewerData } from './viewer-pack.mjs';
import { isMain, isWithin, newGeneratedPath, parseOptions, PROJECT_ROOT, safeChild } from './lib/paths.mjs';

export function loadSnapshot(root, atlas) {
  const source = sourceFor(atlas);
  const pointer = JSON.parse(readFileSync(safeChild(root, `.cache/${atlas}-latest.json`), 'utf8'));
  if (pointer.atlas !== atlas || pointer.repository !== source.repository || pointer.remoteUrl !== source.url.replace(/\.git$/, '') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pointer.commit)) {
    throw new Error('Invalid cached provenance; run source:fetch again.');
  }
  if (typeof pointer.snapshot !== 'string') throw new Error('Snapshot path is missing.');
  const repositoryPath = safeChild(root, pointer.snapshot);
  if (!isWithin(join(root, '.cache/sources'), repositoryPath) || repositoryPath === join(root, '.cache/sources')) throw new Error('Snapshot must be inside .cache/sources/.');
  const saved = JSON.parse(readFileSync(safeChild(root, join(repositoryPath, 'atlas-provenance.json')), 'utf8'));
  if (canonicalStringify(saved) !== canonicalStringify(pointer)) throw new Error('Snapshot provenance differs from the cache pointer.');
  return { provenance: pointer, repositoryPath };
}

export function generatePack({ atlas, root = PROJECT_ROOT, out, config = loadConfig(), maxNodes = 180 }) {
  const snapshot = loadSnapshot(root, atlas);
  const output = newGeneratedPath(root, out ?? `generated/${atlas}-${snapshot.provenance.commit}`);
  const document = generateAtlas({ repositoryPath: snapshot.repositoryPath, ref: snapshot.provenance.commit, config });
  if (document.source.remoteUrl !== snapshot.provenance.remoteUrl || document.source.repository !== snapshot.provenance.repository) {
    throw new Error('Scanned source does not match the fetched repository; remove a repositoryName config override or fetch again.');
  }
  const json = canonicalStringify(document);
  const inputHash = createHash('sha256').update(json).digest('hex');
  const viewerData = createViewerData(document, maxNodes);
  const provenance = {
    ...snapshot.provenance,
    packId: `${atlas}-exploratory`,
    evidenceMode: 'generated-exploratory',
    generatedAt: new Date().toISOString(),
    generator: document.generator,
    atlasDocumentSha256: inputHash,
    viewerNodeCount: viewerData.nodes.length,
    sourceNodeCount: document.nodes.length,
    viewerEdgeCount: viewerData.edges.length,
    sourceEdgeCount: document.edges.length,
    scanIncomplete: document.scan.incomplete,
    runtime: 'unverified',
    deployment: 'unverified',
  };
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output); // Deliberately refuses an existing directory; no --force mode.
  for (const [name, content] of Object.entries({
    'atlas.json': json,
    'atlas-data.mjs': createAdapter(viewerData, inputHash),
    'provenance.json': `${JSON.stringify(provenance, null, 2)}\n`,
    'scanner.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'README.md': `# ${snapshot.provenance.repository} exploratory pack\n\nPinned SHA: ${document.source.commit}\n\nDefault HEAD was observed at ${snapshot.provenance.fetchedAt}. This output is not continuously refreshed.\n\n${viewerData.nodes.length} of ${document.nodes.length} scanned nodes and ${viewerData.edges.length} of ${document.edges.length} scanned relationships are represented in the viewer. Scan incomplete: ${document.scan.incomplete}. Inspect atlas.json diagnostics and scanner.config.json exclusions for coverage.\n\nImport/include/require relationships are inferred by textual heuristics. Manifest dependencies are declared. No generated edge has been curated; runtime and deployment remain unverified. No application code or dependencies were executed.\n\nPreview from the release root:\n\n\x60\x60\x60sh\nnpm run build -- --pack ${relative(root, output).split('\\').join('/')}\nnpm run preview\n\x60\x60\x60\n\nThis adds an exploratory option to the built picker and selects it by default. Curated sources remain unchanged. Use npm run build without --pack to restore a build of just the curated demos.\n`,
  })) writeFileSync(join(output, name), content, { flag: 'wx' });
  return { output, provenance };
}

if (isMain(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), ['atlas', 'out', 'config', 'max-nodes']);
    if (options.help) console.log('npm run atlas:generate -- --atlas <woocommerce|gumroad> [--out generated/name] [--max-nodes 180] [--config path.json]\nReads the last successful fetch; never fetches implicitly or replaces a curated pack.');
    else {
      const result = generatePack({ atlas: options.atlas, out: options.out, config: loadConfig(options.config), maxNodes: options['max-nodes'] === undefined ? 180 : Number(options['max-nodes']) });
      console.log(`Generated ${relative(PROJECT_ROOT, result.output)}\nPinned SHA: ${result.provenance.commit}\nViewer: ${result.provenance.viewerNodeCount}/${result.provenance.sourceNodeCount} scanned nodes\nInspect provenance.json and atlas.json before sharing.`);
    }
  } catch (error) { console.error(`atlas:generate: ${error.message}`); process.exitCode = 1; }
}
