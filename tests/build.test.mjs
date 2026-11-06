import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build } from '../scripts/build.mjs';
import { generatePack } from '../scripts/generate-pack.mjs';
import { normalizeBasePath, validateStaticTree } from '../scripts/manifest.mjs';
import { PROJECT_ROOT } from '../scripts/lib/paths.mjs';
import { requestPath, staticServer } from '../scripts/serve.mjs';
import { sourceFixture, staticFixture, temporary, write } from './helpers.mjs';

const LANDING_FILES = ['landing.html', 'src/landing.mjs', 'src/styles/landing.css', 'assets/repositories/woocommerce-3d.png', 'assets/repositories/gumroad-3d.png', 'assets/launch/atlas-overview.jpg'];

function landingAtlasLinks(html, pageUrl) {
  const links = [...html.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/gi)]
    .map((match) => new URL(match[2].replaceAll('&amp;', '&'), pageUrl))
    .filter((url) => url.searchParams.has('atlas'));
  assert.deepEqual(new Set(links.map((url) => url.searchParams.get('atlas'))), new Set(['woocommerce', 'gumroad']));
  for (const url of links) {
    assert.equal(url.origin, pageUrl.origin);
    assert.equal(url.pathname, new URL('./', pageUrl).pathname, 'Landing links must open the app at the project root');
  }
  return links;
}

test('real release manifest resolves both HTML pages, packs, palette, CSS and local assets at root and project base', () => {
  const root = validateStaticTree(PROJECT_ROOT);
  const project = validateStaticTree(PROJECT_ROOT, { basePath: '/a-project/' });
  assert.equal(root.checkedReferences, project.checkedReferences);
  assert.ok(root.files.includes('src/palette.mjs'));
  for (const id of ['woocommerce', 'gumroad']) assert.ok(root.registry.some((entry) => entry.id === id));
  for (const path of ['index.html', 'src/app.mjs', 'src/styles/foundation.css', 'src/styles/app.css', ...LANDING_FILES]) assert.ok(root.files.includes(path), path);
});

test('real landing links open both curated atlases at the root and GitHub Pages project path', () => {
  const landing = readFileSync(join(PROJECT_ROOT, 'landing.html'), 'utf8');
  for (const base of ['/', '/platform-atlas/']) landingAtlasLinks(landing, new URL(`https://atlas.invalid${base}landing.html`));
});

test('build copies only static entries and notices, includes palette, is repeatable, and preserves good dist on failure', (t) => {
  const root = temporary(t);
  staticFixture(root);
  for (const file of ['.cache/secret', 'generated/private.txt', 'docs/draft.md', 'scripts/private.mjs', '.github/private.yml', '.env']) write(root, file, 'exclude me');
  build({ root });
  const dist = join(root, 'dist');
  assert.deepEqual(readdirSync(dist).sort(), ['.nojekyll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets', 'atlases', 'build-manifest.json', 'index.html', 'landing.html', 'src', 'vendor'].sort());
  for (const path of ['index.html', ...LANDING_FILES]) assert.deepEqual(readFileSync(join(dist, path)), readFileSync(join(root, path)), path);
  assert.equal(readFileSync(join(dist, 'src/palette.mjs'), 'utf8'), readFileSync(join(root, 'src/palette.mjs'), 'utf8'));
  const first = readFileSync(join(dist, 'build-manifest.json'), 'utf8');
  const manifest = JSON.parse(first);
  assert.ok(manifest.entries.includes('landing.html'));
  for (const path of LANDING_FILES) assert.match(manifest.files[path], /^[a-f0-9]{64}$/);
  build({ root });
  assert.equal(readFileSync(join(dist, 'build-manifest.json'), 'utf8'), first);
  unlinkSync(join(root, 'src/palette.mjs'));
  assert.throws(() => build({ root }), /Unresolved/);
  assert.equal(readFileSync(join(dist, 'build-manifest.json'), 'utf8'), first);
});

for (const page of ['index.html', 'landing.html']) {
  test(`static validation requires ${page} to be a regular file`, (t) => {
    const root = temporary(t);
    staticFixture(root);
    unlinkSync(join(root, page));
    assert.throws(() => validateStaticTree(root), { message: `Missing static entry: ${page}` });
    mkdirSync(join(root, page));
    assert.throws(() => validateStaticTree(root), { message: `${page} must be a file.` });
  });

  test(`static validation checks ${page} assets at root and project base and preserves a good build`, (t) => {
    const root = temporary(t);
    staticFixture(root);
    build({ root });
    const original = readFileSync(join(root, page), 'utf8');
    const previousManifest = readFileSync(join(root, 'dist/build-manifest.json'), 'utf8');
    const cases = [
      ['<script src="./src/missing.mjs"></script>', /Unresolved/],
      ['<link rel="stylesheet" href="./src/styles/missing.css">', /Unresolved/],
      ['<img src="./assets/missing.png">', /Unresolved/],
      ['<source src="./assets/missing.webm">', /Unresolved/],
      ['<video poster="./assets/missing.png"></video>', /Unresolved/],
      ['<audio src="./assets/missing.mp3"></audio>', /Unresolved/],
      ['<img src="/assets/repository-mark.svg">', /relative URL/],
      ['<img src="https://cdn.example.invalid/image.png">', /relative URL/],
      ['<img src="../outside.png">', /Unresolved|escapes the project base/],
      ['<base href="/">', /HTML base element/],
    ];
    for (const [tag, error] of cases) {
      write(root, page, original.replace('</head>', `${tag}</head>`));
      for (const basePath of ['/', '/demo/']) assert.throws(() => validateStaticTree(root, { basePath }), error, tag);
    }
    write(root, page, original.replace('</head>', '<img src="./assets/missing.png"></head>'));
    assert.throws(() => build({ root }), /Unresolved/);
    assert.equal(readFileSync(join(root, 'dist/build-manifest.json'), 'utf8'), previousManifest);
    assert.equal(readFileSync(join(root, 'dist', page), 'utf8'), original);
    write(root, page, original.replace('</head>', '<img src="./assets/repository-mark.svg?v=2#mark"></head>'));
    validateStaticTree(root, { basePath: '/demo/' });
  });
}

test('build rejects unknown dist, root assets, missing imports, and symlink escape', (t) => {
  const root = temporary(t);
  staticFixture(root);
  write(root, 'dist/keep.txt', 'user data');
  assert.throws(() => build({ root }), /unrecognized/);
  assert.equal(readFileSync(join(root, 'dist/keep.txt'), 'utf8'), 'user data');
  write(root, 'src/app.mjs', `import '/src/palette.mjs';`);
  assert.throws(() => validateStaticTree(root), /relative/);
  write(root, 'src/app.mjs', `import './missing.mjs';`);
  assert.throws(() => validateStaticTree(root), /Unresolved/);
  write(root, 'src/app.mjs', `import './palette.mjs';`);
  symlinkSync(join(root, 'dist/keep.txt'), join(root, 'assets/escape.txt'));
  assert.throws(() => validateStaticTree(root), /Symlink/);
  for (const base of ['project', '//cdn/', '/../escape/', '/a?x=1', '/a/#x']) assert.throws(() => normalizeBasePath(base));
  assert.equal(normalizeBasePath('/atlas'), '/atlas/');
});

test('optional generated build adds an exploratory picker entry without modifying curated sources', (t) => {
  const root = temporary(t);
  staticFixture(root);
  sourceFixture(root);
  const originalIndex = readFileSync(join(root, 'index.html'), 'utf8');
  const originalLanding = readFileSync(join(root, 'landing.html'), 'utf8');
  const originalCurated = readFileSync(join(root, 'atlases/gumroad/atlas-data.mjs'), 'utf8');
  generatePack({ atlas: 'gumroad', root, out: 'generated/review' });
  build({ root, pack: 'generated/review' });
  const built = validateStaticTree(join(root, 'dist'), { basePath: '/project/' });
  assert.deepEqual(built.registry.map((item) => item.id), ['gumroad-exploratory', 'woocommerce', 'gumroad']);
  assert.equal(built.registry.find((entry) => entry.repository === 'antiwork/gumroad').id, 'gumroad-exploratory');
  assert.equal(built.registry[0].title, 'Gumroad · exploratory');
  assert.match(readFileSync(join(root, 'dist/index.html'), 'utf8'), /name="atlas-module" content="\.\/atlases\/gumroad-exploratory\/atlas-data.mjs"/);
  assert.equal(readFileSync(join(root, 'index.html'), 'utf8'), originalIndex);
  assert.equal(readFileSync(join(root, 'landing.html'), 'utf8'), originalLanding);
  assert.equal(readFileSync(join(root, 'dist/landing.html'), 'utf8'), originalLanding);
  landingAtlasLinks(originalLanding, new URL('https://atlas.invalid/project/landing.html'));
  assert.equal(readFileSync(join(root, 'atlases/gumroad/atlas-data.mjs'), 'utf8'), originalCurated);
  build({ root });
  assert.equal(existsSync(join(root, 'dist/atlases/gumroad-exploratory')), false);
});

for (const basePath of ['/', '/demo/']) {
  for (const preview of [false, true]) {
    test(`${preview ? 'built preview' : 'source server'} serves landing assets and curated app deep links at ${basePath}`, async (t) => {
      const root = temporary(t);
      staticFixture(root);
      if (preview) build({ root });
      const server = staticServer({ root: preview ? join(root, 'dist') : root, basePath });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const pageUrl = new URL(`${basePath}landing.html`, origin);
      const landing = await fetch(pageUrl);
      assert.equal(landing.status, 200);
      assert.match(landing.headers.get('content-type'), /text\/html/);
      const html = await landing.text();
      assert.equal(html, readFileSync(join(root, 'landing.html'), 'utf8'));
      for (const url of landingAtlasLinks(html, pageUrl)) {
        const app = await fetch(url);
        assert.equal(app.status, 200);
        assert.equal(await app.text(), readFileSync(join(root, 'index.html'), 'utf8'));
        assert.equal(requestPath(`${url.pathname}${url.search}`, basePath), 'index.html');
      }
      for (const path of LANDING_FILES.slice(1)) {
        const response = await fetch(new URL(path, pageUrl));
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get('content-type'), /javascript|text\/css|image\/(png|jpeg)/, path);
      }
      const head = await fetch(pageUrl, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      for (const path of ['landing', 'landing.html/missing', 'src/missing-landing.mjs']) assert.equal((await fetch(new URL(path, pageUrl))).status, 404, path);
      if (basePath !== '/') assert.equal((await fetch(new URL('/landing.html', origin))).status, 404);
    });
  }
}

test('HTTP serves project-relative ESM and refuses cache, traversal, symlinks and SPA fallbacks', async (t) => {
  const root = temporary(t);
  staticFixture(root);
  write(root, '.cache/secret', 'private');
  symlinkSync(join(root, '.cache/secret'), join(root, 'assets/escape.txt'));
  const server = staticServer({ root, basePath: '/demo/' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(`${base}/demo?atlas=gumroad`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/demo/?atlas=gumroad');
  const index = await fetch(`${base}/demo/?atlas=gumroad`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /atlas-registry/);
  const module = await fetch(`${base}/demo/src/app.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  for (const path of ['/src/app.mjs', '/demo/.cache/secret', '/demo/assets/escape.txt', '/demo/src/nope.mjs', '/demo/docs/draft.md', '/demo/%ZZ']) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  for (const path of ['/demo/%2e%2e/secret', '/demo/assets/%2e%2e/.cache/secret', '/demo/assets/%5csecret', '/demo/assets/%00']) assert.throws(() => requestPath(path, '/demo/'));
  assert.equal((await fetch(`${base}/demo/`, { method: 'POST' })).status, 405);
  const head = await fetch(`${base}/demo/src/app.mjs`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
