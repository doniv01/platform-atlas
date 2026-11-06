import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

export function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'platform-atlas-test-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

export function staticFixture(root) {
  write(root, 'index.html', `<!doctype html><html><head>
<meta name="atlas-module" content="./atlases/woocommerce/atlas-data.mjs">
<link rel="stylesheet" href="./src/styles/foundation.css">
<link rel="stylesheet" href="./src/styles/app.css">
<link rel="icon" href="./assets/repository-mark.svg">
<script type="importmap">{"imports":{"three":"./vendor/three/three.module.js","three/addons/":"./vendor/three/addons/"}}</script>
<script type="application/json" id="atlas-registry">[{"id":"woocommerce","label":"WooCommerce"},{"id":"gumroad","label":"Gumroad"}]</script>
</head><body><script type="module" src="./src/app.mjs"></script></body></html>`);
  write(root, 'landing.html', `<!doctype html><html><head>
<title>Platform Atlas</title>
<link rel="stylesheet" href="./src/styles/foundation.css">
<link rel="stylesheet" href="./src/styles/landing.css">
<link rel="icon" href="./assets/repository-mark.svg">
</head><body>
<a href="./?atlas=woocommerce"><img src="./assets/repositories/woocommerce-3d.png" alt="WooCommerce">Open WooCommerce</a>
<a href="./?atlas=gumroad"><img src="./assets/repositories/gumroad-3d.png" alt="Gumroad">Open Gumroad</a>
<img src="./assets/launch/atlas-overview.jpg" alt="Platform Atlas overview">
<a href="https://github.com/doniv01/platform-atlas">GitHub project</a>
<script type="module" src="./src/landing.mjs"></script>
</body></html>`);
  write(root, 'src/app.mjs', `import './palette.mjs'; import { scene } from './city-three.mjs';\n`);
  write(root, 'src/landing.mjs', `import './palette.mjs';\n`);
  write(root, 'src/city-three.mjs', `import { Scene } from 'three'; import 'three/addons/example.js'; export const scene = Scene;\n`);
  write(root, 'src/palette.mjs', 'export const colors = [];\n');
  write(root, 'src/styles/foundation.css', '@font-face {font-family: Fixture; src: url("../../assets/fonts/fixture.woff2")}\n');
  write(root, 'src/styles/app.css', 'body {margin: 0}\n');
  write(root, 'src/styles/landing.css', 'body {margin: 0}\n');
  write(root, 'assets/fonts/fixture.woff2', 'font-fixture');
  write(root, 'assets/repository-mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const path of ['repositories/woocommerce-3d.png', 'repositories/gumroad-3d.png', 'launch/atlas-overview.jpg']) write(root, `assets/${path}`, 'image-fixture');
  write(root, 'vendor/three/three.module.js', 'export const Scene = {};');
  write(root, 'vendor/three/addons/example.js', 'export const fixture = true;');
  for (const id of ['woocommerce', 'gumroad']) write(root, `atlases/${id}/atlas-data.mjs`, `import '../../src/palette.mjs'; export const ATLAS_DATA = {};\n`);
  write(root, 'LICENSE', 'MIT fixture\n');
  write(root, 'THIRD_PARTY_NOTICES.md', 'Fixture notices\n');
}

// Construct a tiny bare object database directly. No git commit, checkout,
// subprocess hooks, fixture package scripts, or target modules are executed.
export function gitFixture(directory, files, remote = 'https://github.com/antiwork/gumroad') {
  mkdirSync(join(directory, 'objects'), { recursive: true });
  function object(type, bytes) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const raw = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
    const hash = createHash('sha1').update(raw).digest('hex');
    write(directory, `objects/${hash.slice(0, 2)}/${hash.slice(2)}`, deflateSync(raw));
    return hash;
  }
  const tree = new Map();
  for (const [path, value] of Object.entries(files)) {
    const parts = path.split('/');
    let branch = tree;
    for (const part of parts.slice(0, -1)) {
      if (!branch.has(part)) branch.set(part, new Map());
      branch = branch.get(part);
    }
    branch.set(parts.at(-1), { hash: object('blob', value.content ?? value), mode: value.mode ?? '100644' });
  }
  function treeObject(branch) {
    return object('tree', Buffer.concat([...branch.entries()].sort(([a, av], [b, bv]) => `${a}${av instanceof Map ? '/' : ''}`.localeCompare(`${b}${bv instanceof Map ? '/' : ''}`, 'en')).map(([name, value]) => {
      const directory = value instanceof Map;
      return Buffer.concat([Buffer.from(`${directory ? '40000' : value.mode} ${name}\0`), Buffer.from(directory ? treeObject(value) : value.hash, 'hex')]);
    })));
  }
  const commit = object('commit', `tree ${treeObject(tree)}\nauthor Atlas Fixture <fixture@example.invalid> 0 +0000\ncommitter Atlas Fixture <fixture@example.invalid> 0 +0000\n\nStatic fixture\n`);
  write(directory, 'refs/heads/fixture', `${commit}\n`);
  write(directory, 'HEAD', 'ref: refs/heads/fixture\n');
  write(directory, 'config', `[core]\n\trepositoryformatversion = 0\n\tbare = true\n[remote "origin"]\n\turl = ${remote}\n`);
  return commit;
}

export function sourceFixture(root) {
  const snapshot = '.cache/sources/gumroad-fixture';
  const files = {
    'package.json': '{"name":"fixture-root","scripts":{"postinstall":"exit 99"},"dependencies":{"fixture-core":"*"}}',
    'packages/core/package.json': '{"name":"fixture-core"}',
    'src/index.js': `import './other.js';\nimport 'fixture-core';\nthrow new Error('Source must never execute');\n`,
    'src/other.js': 'export const value = 1;',
    'src/evil.js': { content: '/etc/passwd', mode: '120000' },
    'lib/entry.rb': "require_relative 'other'\n",
    'lib/other.rb': 'class Other; end\n',
    'php/entry.php': "<?php\nrequire __DIR__ . '/other.php';\n",
    'php/other.php': '<?php\nclass Other {}\n',
    'vendor/ignored.js': 'throw new Error("excluded")',
    'broken/package.json': 'null',
  };
  const commit = gitFixture(join(root, snapshot), files);
  const provenance = {
    schemaVersion: '1.0.0', atlas: 'gumroad', repository: 'antiwork/gumroad',
    remoteUrl: 'https://github.com/antiwork/gumroad', defaultBranch: 'fixture',
    ref: 'refs/heads/fixture', commit, fetchedAt: '2026-01-01T00:00:00.000Z', snapshot,
    resolution: 'Test fixture; not a network fetch.',
  };
  write(root, '.cache/gumroad-latest.json', JSON.stringify(provenance));
  write(root, `${snapshot}/atlas-provenance.json`, JSON.stringify(provenance));
  return { commit, snapshot, files };
}
