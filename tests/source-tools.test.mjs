import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { canonicalStringify, generateAtlas, loadConfig, sanitizeRemoteUrl, validateRef } from '../scripts/atlas-generate.mjs';
import { fetchSource, parseRemoteHead, sourceFor } from '../scripts/fetch-source.mjs';
import { generatePack, loadSnapshot } from '../scripts/generate-pack.mjs';
import { gitEnvironment } from '../scripts/lib/git.mjs';
import { newGeneratedPath, parseOptions, safeChild } from '../scripts/lib/paths.mjs';
import { sourceFixture, temporary, write } from './helpers.mjs';

test('helpers reject traversal, symlinks, curated output, unsafe refs and invalid options', (t) => {
  const root = temporary(t);
  for (const path of ['../outside', 'atlases/gumroad/atlas-data.mjs', 'generated', 'src/app.mjs']) assert.throws(() => newGeneratedPath(root, path));
  assert.equal(newGeneratedPath(root, 'generated/review'), join(root, 'generated/review'));
  write(root, 'generated/existing.json', '{}');
  assert.throws(() => newGeneratedPath(root, 'generated/existing.json'), /exists/);
  symlinkSync(join(root, 'missing'), join(root, 'link'));
  assert.throws(() => safeChild(root, 'link/file'), /Symlink/);
  for (const ref of ['--help', '-bad', 'HEAD..main', 'main@{1}', 'refs//heads/main', 'main.lock']) assert.throws(() => validateRef(ref));
  validateRef('refs/heads/trunk');
  assert.equal(sanitizeRemoteUrl('https://user:secret@github.com/owner/repo'), null);
  assert.equal(sanitizeRemoteUrl('https://github.com:8443/owner/repo'), null);
  assert.equal(sanitizeRemoteUrl('https://github.com/owner/repo?secret=x'), null);
  assert.equal(sanitizeRemoteUrl('git@github.com:antiwork/gumroad.git'), 'https://github.com/antiwork/gumroad');
  assert.throws(() => parseOptions(['--out', 'one', '--out', 'two'], ['out']), /duplicate/);
  assert.throws(() => sourceFor('__proto__'));
  assert.throws(() => sourceFor('https://example.com/repo'));
});

test('Git environment removes repository and config injection', () => {
  const env = gitEnvironment({ PATH: '/bin', GIT_DIR: '/secret', GIT_WORK_TREE: '/original', GIT_CONFIG_COUNT: '1', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/original/objects', GIT_SSH_COMMAND: 'arbitrary' });
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_COUNT', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_SSH_COMMAND']) assert.equal(env[name], undefined);
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(env.PATH, '/bin');
});

test('default remote HEAD is discovered and pinned, not a hardcoded branch', (t) => {
  const sha = 'a'.repeat(40);
  const advertisement = `ref: refs/heads/release/current\tHEAD\n${sha}\tHEAD\n`;
  assert.deepEqual(parseRemoteHead(advertisement), { defaultBranch: 'release/current', ref: 'refs/heads/release/current', commit: sha });
  for (const value of [sha, `${sha}\tHEAD`, `${advertisement}${sha}\tHEAD\n`, `ref: refs/heads/../bad\tHEAD\n${sha}\tHEAD`]) assert.throws(() => parseRemoteHead(value));
  const root = temporary(t);
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return advertisement;
    if (args.includes('rev-parse')) return sha;
    return '';
  };
  const first = fetchSource({ atlas: 'gumroad', root, git });
  const second = fetchSource({ atlas: 'gumroad', root, git });
  assert.notEqual(first.snapshot, second.snapshot);
  assert.ok(existsSync(join(root, first.snapshot, 'atlas-provenance.json')));
  assert.ok(calls.some((args) => args.includes('fetch') && args.at(-1) === sha));
  assert.ok(calls.every((args) => !args.includes('checkout') && !args.includes('reset') && !args.includes('pull')));
  assert.equal(JSON.parse(readFileSync(join(root, '.cache/gumroad-latest.json'))).snapshot, second.snapshot);
  assert.throws(() => fetchSource({ atlas: 'gumroad', root, git: (args) => args[0] === 'ls-remote' ? advertisement : args.includes('rev-parse') ? 'b'.repeat(40) : '' }), /does not match/);
  assert.equal(JSON.parse(readFileSync(join(root, '.cache/gumroad-latest.json'))).snapshot, second.snapshot);
});

test('scanner reads committed objects without executing source; inference and declarations stay distinct', (t) => {
  const root = temporary(t);
  const fixture = sourceFixture(root);
  const args = { repositoryPath: join(root, fixture.snapshot), ref: fixture.commit };
  const first = generateAtlas(args);
  assert.equal(canonicalStringify(first), canonicalStringify(generateAtlas(args)));
  assert.equal(first.source.commit, fixture.commit);
  assert.equal(first.source.repository, 'antiwork/gumroad');
  assert.ok(first.nodes.some((node) => node.path === 'src/index.js'));
  assert.ok(!first.nodes.some((node) => /evil|ignored/.test(node.path)));
  assert.ok(first.scan.diagnostics.some((item) => item.code === 'invalid-manifest'));
  for (const extractor of ['js-static-import', 'ruby-require', 'php-require', 'package-json-dependency']) assert.ok(first.edges.some((edge) => edge.evidence[0].extractor === extractor), extractor);
  for (const edge of first.edges) {
    assert.equal(edge.truth.repository, edge.kind === 'declares-dependency' ? 'declared' : 'heuristic');
    assert.equal(edge.truth.runtime, 'unverified');
    assert.equal(edge.truth.deployment, 'unverified');
  }
  const config = loadConfig();
  config.limits.maxNodes = 2;
  const limited = generateAtlas({ ...args, config });
  assert.equal(limited.nodes.length, 2);
  assert.equal(limited.scan.incomplete, true);
  assert.ok(limited.scan.diagnostics.some((item) => item.code === 'node-limit'));
});

test('generated pack pins provenance, imports as data, respects viewer cap, and never overwrites', async (t) => {
  const root = temporary(t);
  const fixture = sourceFixture(root);
  const result = generatePack({ atlas: 'gumroad', root, out: 'generated/review', maxNodes: 5 });
  const module = await import(pathToFileURL(join(result.output, 'atlas-data.mjs')));
  assert.equal(module.ATLAS_DATA.meta.repositoryRevision, fixture.commit);
  assert.equal(module.ATLAS_DATA.meta.evidenceMode, 'generated-exploratory');
  assert.equal(module.ATLAS_DATA.nodes.length, 5);
  assert.ok(module.ATLAS_DATA.edges.every((edge) => /^(Inferred|Declared):/.test(edge.label)));
  assert.equal(result.provenance.runtime, 'unverified');
  const before = readFileSync(join(result.output, 'atlas-data.mjs'));
  assert.throws(() => generatePack({ atlas: 'gumroad', root, out: 'generated/review' }), /exists/);
  assert.deepEqual(readFileSync(join(result.output, 'atlas-data.mjs')), before);
  assert.throws(() => generatePack({ atlas: 'gumroad', root, out: 'atlases/gumroad' }), /protected/);
  assert.throws(() => generatePack({ atlas: 'gumroad', root, out: 'generated/invalid', maxNodes: 0 }), /integer/);
  const pointer = JSON.parse(readFileSync(join(root, '.cache/gumroad-latest.json')));
  pointer.snapshot = '../original-repository';
  write(root, '.cache/gumroad-latest.json', JSON.stringify(pointer));
  assert.throws(() => loadSnapshot(root, 'gumroad'));
  assert.equal(existsSync(join(root, 'generated/invalid')), false);
});
