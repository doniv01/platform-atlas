#!/usr/bin/env node

import { runGit as invokeGit } from './lib/git.mjs';
import { newGeneratedPath } from './lib/paths.mjs';

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  resolve,
  posix,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GENERATOR_NAME = 'platform-atlas-generator';
const GENERATOR_VERSION = '1.0.0';
const SCHEMA_VERSION = '1.0.0';
const PROJECT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG_PATH = resolve(PROJECT_DIRECTORY, 'scripts/scanner.config.json');

const HARD_LIMITS = Object.freeze({
  maxDistricts: 1000,
  maxEdges: 100000,
  maxFileBytes: 4 * 1024 * 1024,
  maxGitTreeBytes: 64 * 1024 * 1024,
  maxNodes: 20000,
  maxTotalBytes: 256 * 1024 * 1024,
  maxTrackedFiles: 250000,
});

const SOURCE_EXTENSIONS = new Map([
  ['.cjs', 'javascript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.php', 'php'],
  ['.rb', 'ruby'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
]);

const MANIFEST_NAMES = new Map([
  ['composer.json', 'json'],
  ['Gemfile', 'ruby'],
  ['package.json', 'json'],
]);

const JS_RESOLUTION_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
];

const OBSERVED_TRUTH = Object.freeze({
  deployment: 'unverified',
  repository: 'observed',
  runtime: 'unverified',
});

const DECLARED_TRUTH = Object.freeze({
  deployment: 'unverified',
  repository: 'declared',
  runtime: 'unverified',
});

const HEURISTIC_TRUTH = Object.freeze({
  deployment: 'unverified',
  repository: 'heuristic',
  runtime: 'unverified',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix, ...parts) {
  return `${prefix}_${sha256(parts.join('\0')).slice(0, 20)}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
  }
  return result;
}

export function canonicalStringify(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}: ${error.message}`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function validateConfig(config) {
  assertPlainObject(config, 'Atlas config');
  const allowedKeys = new Set(['exclude', 'limits', 'repositoryName']);
  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown config key: ${key}`);
  }

  if (!Array.isArray(config.exclude) || config.exclude.some((item) => typeof item !== 'string')) {
    throw new Error('Config exclude must be an array of glob strings.');
  }
  assertPlainObject(config.limits, 'Config limits');
  for (const name of Object.keys(config.limits)) {
    if (!Object.hasOwn(HARD_LIMITS, name)) throw new Error(`Unknown config limit: ${name}`);
  }

  for (const [name, hardMaximum] of Object.entries(HARD_LIMITS)) {
    const value = config.limits[name];
    const minimum = name === 'maxEdges' ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > hardMaximum) {
      throw new Error(`Config limit ${name} must be an integer from ${minimum} to ${hardMaximum}.`);
    }
  }

  if (config.repositoryName !== null && (
    typeof config.repositoryName !== 'string'
    || config.repositoryName.trim().length === 0
    || config.repositoryName.length > 200
  )) {
    throw new Error('Config repositoryName must be null or a non-empty string of at most 200 characters.');
  }
}

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const defaults = readJson(DEFAULT_CONFIG_PATH, 'default config');
  const suppliedPath = resolve(configPath);
  const supplied = suppliedPath === DEFAULT_CONFIG_PATH
    ? defaults
    : readJson(suppliedPath, 'atlas config');
  assertPlainObject(defaults, 'Default config');
  assertPlainObject(supplied, 'Atlas config');

  const config = {
    ...defaults,
    ...supplied,
    exclude: supplied.exclude ?? defaults.exclude,
    limits: {
      ...defaults.limits,
      ...(supplied.limits ?? {}),
    },
  };
  validateConfig(config);
  return canonicalize(config);
}

function globToRegExp(glob) {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const next = glob[index + 1];

    if (character === '*' && next === '*') {
      const after = glob[index + 2];
      if (after === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (character === '*') {
      pattern += '[^/]*';
    } else if (character === '?') {
      pattern += '[^/]';
    } else {
      pattern += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`);
}

function compileExcludes(globs) {
  return globs.map((glob) => globToRegExp(glob));
}

function isExcluded(path, excludePatterns) {
  return excludePatterns.some((pattern) => pattern.test(path));
}

function runGit(repositoryPath, args, options = {}) {
  return invokeGit(['-C', repositoryPath, ...args], options);
}

function gitText(repositoryPath, args, options) {
  const result = runGit(repositoryPath, args, options);
  if (result.status !== 0) return undefined;
  return result.stdout.toString('utf8').trim();
}

export function validateRef(ref) {
  if (ref === 'HEAD') return;
  if (
    typeof ref !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,254}$/.test(ref)
    || ref.includes('..')
    || ref.includes('@{')
    || ref.includes('//')
    || ref.endsWith('/')
    || ref.endsWith('.lock')
  ) {
    throw new Error(`Unsafe or unsupported Git ref: ${String(ref)}`);
  }
}

function resolveRepository(repositoryPath) {
  let requestedPath;
  try {
    requestedPath = realpathSync(resolve(repositoryPath));
  } catch (error) {
    throw new Error(`Repository path does not exist: ${repositoryPath}`);
  }
  const bare = gitText(requestedPath, ['rev-parse', '--is-bare-repository'], { allowFailure: true });
  if (bare === 'true') return requestedPath;
  const root = gitText(requestedPath, ['rev-parse', '--show-toplevel'], {
    allowFailure: true,
    maxBuffer: 1024 * 1024,
  });
  if (!root) throw new Error(`Not a Git repository: ${repositoryPath}`);
  return realpathSync(root);
}

function resolveCommit(repositoryRoot, ref) {
  validateRef(ref);
  const commit = gitText(repositoryRoot, ['rev-parse', '--verify', `${ref}^{commit}`], {
    maxBuffer: 1024 * 1024,
  });
  if (!commit || !/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new Error(`Unable to resolve Git ref to a commit: ${ref}`);
  }
  return commit;
}

function parseTreeRecord(record) {
  const tabIndex = record.indexOf(0x09);
  if (tabIndex === -1) return undefined;
  const header = record.subarray(0, tabIndex).toString('ascii');
  const match = /^(\d+)\s+(\w+)\s+([0-9a-f]+)\s+(-|\d+)$/.exec(header);
  if (!match) return undefined;

  const path = record.subarray(tabIndex + 1).toString('utf8');
  return {
    mode: match[1],
    type: match[2],
    oid: match[3],
    size: match[4] === '-' ? undefined : Number(match[4]),
    path,
  };
}

function listTree(repositoryRoot, commit, limits) {
  const result = runGit(repositoryRoot, [
    'ls-tree', '-r', '-z', '-l', '--full-tree', commit,
  ], {
    maxBuffer: limits.maxGitTreeBytes,
  });
  const records = [];
  let start = 0;
  for (let index = 0; index < result.stdout.length; index += 1) {
    if (result.stdout[index] !== 0) continue;
    const parsed = parseTreeRecord(result.stdout.subarray(start, index));
    if (parsed) records.push(parsed);
    start = index + 1;
    if (records.length > limits.maxTrackedFiles) {
      throw new Error(
        `Repository has more than maxTrackedFiles (${limits.maxTrackedFiles}) tracked entries.`,
      );
    }
  }
  return records.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function isSafeRepositoryPath(path) {
  return Boolean(path)
    && !path.includes('\uFFFD')
    && !/[\\\\\x00-\x1f\x7f]/.test(path)
    && !/["'<>&]/.test(path)
    && !posix.isAbsolute(path)
    && path !== '..'
    && !path.startsWith('../')
    && posix.normalize(path) === path;
}

function languageForPath(path) {
  const name = posix.basename(path);
  if (MANIFEST_NAMES.has(name)) return MANIFEST_NAMES.get(name);
  return SOURCE_EXTENSIONS.get(extname(name).toLowerCase());
}

function isManifestPath(path) {
  return MANIFEST_NAMES.has(posix.basename(path));
}

function readBlobs(repositoryRoot, entries, maxTotalBytes) {
  const uniqueEntries = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!seen.has(entry.oid)) {
      seen.add(entry.oid);
      uniqueEntries.push(entry);
    }
  }

  if (uniqueEntries.length === 0) return new Map();
  const input = Buffer.from(`${uniqueEntries.map((entry) => entry.oid).join('\n')}\n`, 'ascii');
  const result = runGit(repositoryRoot, ['cat-file', '--batch'], {
    input,
    maxBuffer: maxTotalBytes + uniqueEntries.length * 128 + 1024 * 1024,
  });

  const blobs = new Map();
  let offset = 0;
  for (const requested of uniqueEntries) {
    const newline = result.stdout.indexOf(0x0a, offset);
    if (newline === -1) throw new Error(`Git cat-file returned an incomplete header for ${requested.path}.`);
    const header = result.stdout.subarray(offset, newline).toString('ascii');
    const match = /^([0-9a-f]+)\s+blob\s+(\d+)$/.exec(header);
    if (!match) throw new Error(`Git cat-file could not read tracked blob for ${requested.path}.`);
    const size = Number(match[2]);
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= result.stdout.length + 1) {
      throw new Error(`Git cat-file returned incomplete content for ${requested.path}.`);
    }
    blobs.set(requested.oid, result.stdout.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  return blobs;
}

function lineOfSubstring(text, needle) {
  const index = text.indexOf(needle);
  if (index === -1) return 1;
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function addDiagnostic(diagnostics, code, message, path, severity = 'warning') {
  diagnostics.push({
    code,
    severity,
    message,
    ...(path ? { path } : {}),
  });
}

function manifestPriority(path) {
  const name = posix.basename(path);
  if (name === 'package.json') return 0;
  if (name === 'composer.json') return 1;
  return 2;
}

function parseManifest(path, text, diagnostics) {
  const name = posix.basename(path);
  const directory = posix.dirname(path) === '.' ? '' : posix.dirname(path);
  if (name === 'Gemfile') {
    const dependencies = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\s*gem\s+['"]([^'"]+)['"]/.exec(lines[index]);
      if (match) dependencies.push({ name: match[1], line: index + 1, extractor: 'gemfile-dependency' });
    }
    return {
      data: undefined,
      dependencies,
      directory,
      manifestPath: path,
      packageName: directory ? posix.basename(directory) : 'ruby-root',
    };
  }

  let data;
  try {
    data = JSON.parse(text);
    assertPlainObject(data, 'Manifest');
  } catch (error) {
    addDiagnostic(diagnostics, 'invalid-manifest', `Manifest is not valid JSON: ${error.message}`, path);
    return {
      data: undefined,
      dependencies: [],
      directory,
      manifestPath: path,
      packageName: directory ? posix.basename(directory) : undefined,
    };
  }

  const dependencies = [];
  const groups = name === 'package.json'
    ? ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    : ['require', 'require-dev'];
  for (const group of groups) {
    const values = data[group];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const dependencyName of Object.keys(values).sort()) {
      dependencies.push({
        name: dependencyName,
        line: lineOfSubstring(text, `"${dependencyName}"`),
        extractor: name === 'package.json' ? 'package-json-dependency' : 'composer-json-dependency',
      });
    }
  }

  return {
    data,
    dependencies,
    directory,
    manifestPath: path,
    packageName: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined,
  };
}

function extractJavaScriptRelations(text) {
  const relations = [];
  const patterns = [
    { extractor: 'js-static-import', regex: /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g },
    { extractor: 'js-require', regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
    { extractor: 'js-dynamic-import', regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  ];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { extractor, regex } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line))) {
        const key = `${index + 1}\0${extractor}\0${match[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          relations.push({
            extractor,
            kind: extractor === 'js-require' ? 'requires' : 'imports',
            line: index + 1,
            mode: match[1].startsWith('.') ? 'relative' : 'package',
            specifier: match[1],
          });
        }
      }
    }
  }
  return relations;
}

function parsePhpInclude(expression) {
  const direct = /^['"]([^'"]+)['"]$/.exec(expression.trim());
  if (direct) return { mode: direct[1].startsWith('.') ? 'relative' : 'root', specifier: direct[1] };
  const directory = /^(?:__DIR__|dirname\s*\(\s*__FILE__\s*\))\s*\.\s*['"]([^'"]+)['"]$/.exec(expression.trim());
  if (directory) return { mode: 'relative', specifier: `.${directory[1].startsWith('/') ? '' : '/'}${directory[1]}` };
  return undefined;
}

function extractPhpRelations(text) {
  const relations = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const include = /\b(require_once|require|include_once|include)\s*(?:\(\s*)?(.+?)(?:\s*\))?\s*;/.exec(line);
    if (include) {
      const parsed = parsePhpInclude(include[2]);
      if (parsed) {
        relations.push({
          extractor: `php-${include[1].replace('_once', '')}`,
          kind: 'includes',
          line: index + 1,
          ...parsed,
        });
      }
    }

    const use = /^\s*use\s+(?!function\b|const\b)([^;]+);/.exec(line);
    if (use && !use[1].includes('{')) {
      for (const imported of use[1].split(',')) {
        const specifier = imported.trim().replace(/\s+as\s+\w+$/i, '').replace(/^\\/, '');
        if (specifier) {
          relations.push({
            extractor: 'php-use',
            kind: 'imports',
            line: index + 1,
            mode: 'php-symbol',
            specifier,
          });
        }
      }
    }
  }
  return relations;
}

function extractPhpSymbols(text) {
  const symbols = [];
  let namespace = '';
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const namespaceMatch = /^\s*namespace\s+([^;{]+)[;{]/.exec(line);
    if (namespaceMatch) namespace = namespaceMatch[1].trim().replace(/^\\|\\$/g, '');
    const declaration = /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (declaration) symbols.push(namespace ? `${namespace}\\${declaration[1]}` : declaration[1]);
  }
  return symbols;
}

function extractRubyRelations(text) {
  const relations = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(require_relative|require|load)\s*(?:\(\s*)?['"]([^'"]+)['"]/.exec(lines[index]);
    if (!match) continue;
    relations.push({
      extractor: `ruby-${match[1].replace('_relative', '')}`,
      kind: 'requires',
      line: index + 1,
      mode: match[1] === 'require_relative' ? 'relative' : 'ruby-root',
      specifier: match[2],
    });
  }
  return relations;
}

function safeJoin(base, specifier) {
  if (!specifier || posix.isAbsolute(specifier) || specifier.includes('\0')) return undefined;
  const joined = posix.normalize(posix.join(base, specifier));
  if (joined === '..' || joined.startsWith('../') || posix.isAbsolute(joined)) return undefined;
  return joined.replace(/^\.\//, '');
}

function pathCandidates(sourcePath, specifier, mode, language) {
  const cleanSpecifier = language === 'javascript' || language === 'typescript'
    ? specifier.replace(/[?#].*$/, '')
    : specifier;
  const sourceDirectory = posix.dirname(sourcePath) === '.' ? '' : posix.dirname(sourcePath);
  const bases = [];
  if (mode === 'relative') {
    const joined = safeJoin(sourceDirectory, cleanSpecifier);
    if (joined) bases.push(joined);
  } else if (mode === 'root') {
    const joined = safeJoin('', cleanSpecifier);
    if (joined) bases.push(joined);
  } else if (mode === 'ruby-root') {
    const root = safeJoin('', cleanSpecifier);
    const lib = safeJoin('lib', cleanSpecifier);
    if (root) bases.push(root);
    if (lib) bases.push(lib);
  }

  const candidates = [];
  for (const base of bases) {
    candidates.push(base);
    if (language === 'javascript' || language === 'typescript') {
      const extension = extname(base);
      if (!extension) {
        for (const suffix of JS_RESOLUTION_EXTENSIONS) candidates.push(`${base}${suffix}`);
        for (const suffix of JS_RESOLUTION_EXTENSIONS) candidates.push(`${base}/index${suffix}`);
      } else if (extension === '.js') {
        candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`, `${base.slice(0, -3)}.jsx`);
      }
    } else if (language === 'ruby' && !extname(base)) {
      candidates.push(`${base}.rb`);
    } else if (language === 'php' && !extname(base)) {
      candidates.push(`${base}.php`);
    }
  }
  return [...new Set(candidates)];
}

function deepestPackage(path, packageByDirectory) {
  let selected;
  for (const [directory, manifest] of packageByDirectory) {
    const inside = directory === '' || path === directory || path.startsWith(`${directory}/`);
    if (!inside) continue;
    if (!selected || directory.length > selected.directory.length) selected = { directory, manifest };
  }
  return selected;
}

export function sanitizeRemoteUrl(remote) {
  if (!remote) return null;
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  try {
    const parsed = new URL(remote);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) return null;
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}

function inferRepositoryName(repositoryRoot, remoteUrl, configuredName) {
  if (configuredName) return configuredName;
  if (remoteUrl) return remoteUrl.split('/').slice(-2).join('/');
  return basename(repositoryRoot);
}

function sortDiagnostics(diagnostics) {
  return diagnostics.sort((left, right) => (
    left.code.localeCompare(right.code, 'en')
    || (left.path ?? '').localeCompare(right.path ?? '', 'en')
    || left.message.localeCompare(right.message, 'en')
  ));
}

export function generateAtlas({ repositoryPath, ref = 'HEAD', config = loadConfig() }) {
  if (!repositoryPath) throw new Error('repositoryPath is required.');
  validateConfig(config);
  const repositoryRoot = resolveRepository(repositoryPath);
  const commit = resolveCommit(repositoryRoot, ref);
  const diagnostics = [];
  const excludePatterns = compileExcludes(config.exclude);
  const tree = listTree(repositoryRoot, commit, config.limits);
  const trackedFiles = tree.length;

  let unsafePaths = 0;
  let excludedFiles = 0;
  let oversizedFiles = 0;
  const candidates = [];
  for (const entry of tree) {
    if (entry.type !== 'blob' || entry.mode === '120000' || entry.size === undefined) continue;
    if (!isSafeRepositoryPath(entry.path)) {
      unsafePaths += 1;
      continue;
    }
    if (isExcluded(entry.path, excludePatterns)) {
      excludedFiles += 1;
      continue;
    }
    const language = languageForPath(entry.path);
    if (!language) continue;
    if (entry.size > config.limits.maxFileBytes) {
      oversizedFiles += 1;
      continue;
    }
    candidates.push({
      ...entry,
      isManifest: isManifestPath(entry.path),
      language,
    });
  }

  candidates.sort((left, right) => (
    Number(right.isManifest) - Number(left.isManifest)
    || manifestPriority(left.path) - manifestPriority(right.path)
    || left.path.localeCompare(right.path, 'en')
  ));
  const eligibleFiles = candidates.length + oversizedFiles;

  const selected = [];
  let selectedBytes = 0;
  let nodeLimited = 0;
  let byteLimited = 0;
  for (const candidate of candidates) {
    if (selected.length >= config.limits.maxNodes) {
      nodeLimited += 1;
      continue;
    }
    if (selectedBytes + candidate.size > config.limits.maxTotalBytes) {
      byteLimited += 1;
      continue;
    }
    selected.push(candidate);
    selectedBytes += candidate.size;
  }
  selected.sort((left, right) => left.path.localeCompare(right.path, 'en'));

  if (unsafePaths) addDiagnostic(diagnostics, 'unsafe-path', `${unsafePaths} tracked paths were skipped because they could not be represented safely.`);
  if (oversizedFiles) addDiagnostic(diagnostics, 'file-size-limit', `${oversizedFiles} eligible files exceeded maxFileBytes (${config.limits.maxFileBytes}).`);
  if (nodeLimited) addDiagnostic(diagnostics, 'node-limit', `${nodeLimited} eligible files were omitted by maxNodes (${config.limits.maxNodes}).`);
  if (byteLimited) addDiagnostic(diagnostics, 'byte-limit', `${byteLimited} eligible files were omitted by maxTotalBytes (${config.limits.maxTotalBytes}).`);

  const blobs = readBlobs(repositoryRoot, selected, config.limits.maxTotalBytes);
  const contentByPath = new Map();
  let binaryFiles = 0;
  for (const entry of selected) {
    const blob = blobs.get(entry.oid);
    if (!blob || blob.includes(0)) {
      binaryFiles += 1;
      continue;
    }
    const text = blob.toString('utf8');
    if (text.includes('\uFFFD')) {
      binaryFiles += 1;
      continue;
    }
    contentByPath.set(entry.path, text);
  }
  if (binaryFiles) addDiagnostic(diagnostics, 'binary-source', `${binaryFiles} eligible files were skipped because they were not valid UTF-8 text.`);

  const actualEntries = selected.filter((entry) => contentByPath.has(entry.path));
  const entryByPath = new Map(actualEntries.map((entry) => [entry.path, entry]));
  const pathSet = new Set(entryByPath.keys());

  const manifestInfos = [];
  for (const entry of actualEntries.filter((item) => item.isManifest)) {
    manifestInfos.push({
      ...parseManifest(entry.path, contentByPath.get(entry.path), diagnostics),
      entry,
    });
  }
  manifestInfos.sort((left, right) => (
    left.directory.localeCompare(right.directory, 'en')
    || manifestPriority(left.manifestPath) - manifestPriority(right.manifestPath)
    || left.manifestPath.localeCompare(right.manifestPath, 'en')
  ));

  const packageByDirectory = new Map();
  for (const manifest of manifestInfos) {
    if (!packageByDirectory.has(manifest.directory)) packageByDirectory.set(manifest.directory, manifest);
  }

  const desiredDistricts = new Map();
  const desiredDistrictKeyByPath = new Map();
  for (const entry of actualEntries) {
    const packageMatch = deepestPackage(entry.path, packageByDirectory);
    let key;
    let definition;
    if (packageMatch?.directory) {
      key = `package:${packageMatch.directory}`;
      definition = {
        kind: 'package',
        label: packageMatch.manifest.packageName
          ?? (packageMatch.directory ? posix.basename(packageMatch.directory) : 'repository package'),
        path: packageMatch.directory,
        manifestPath: packageMatch.manifest.manifestPath,
      };
    } else if (entry.path.includes('/')) {
      const topLevel = entry.path.split('/')[0];
      key = `directory:${topLevel}`;
      definition = { kind: 'directory', label: topLevel, path: topLevel };
    } else if (packageMatch) {
      key = 'package:';
      definition = {
        kind: 'package',
        label: packageMatch.manifest.packageName ?? 'repository package',
        path: '',
        manifestPath: packageMatch.manifest.manifestPath,
      };
    } else {
      key = 'root:';
      definition = { kind: 'root', label: 'repository root', path: '' };
    }
    desiredDistricts.set(key, definition);
    desiredDistrictKeyByPath.set(entry.path, key);
  }

  const orderedDistrictKeys = [...desiredDistricts.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  const keptDistrictKeys = new Set(orderedDistrictKeys.slice(0, config.limits.maxDistricts));
  const needsOtherDistrict = orderedDistrictKeys.length > keptDistrictKeys.size;
  if (needsOtherDistrict) {
    addDiagnostic(
      diagnostics,
      'district-limit',
      `${orderedDistrictKeys.length - keptDistrictKeys.size} districts were grouped by maxDistricts (${config.limits.maxDistricts}).`,
    );
  }

  const districtIdByKey = new Map();
  for (const key of keptDistrictKeys) districtIdByKey.set(key, stableId('d', key));
  const otherDistrictId = needsOtherDistrict ? stableId('d', 'other') : undefined;

  const nodes = [];
  const nodeIdByPath = new Map();
  const manifestInfoByPath = new Map(manifestInfos.map((manifest) => [manifest.manifestPath, manifest]));
  for (const entry of actualEntries) {
    const districtKey = desiredDistrictKeyByPath.get(entry.path);
    const districtId = districtIdByKey.get(districtKey) ?? otherDistrictId;
    const manifest = manifestInfoByPath.get(entry.path);
    const id = stableId('n', entry.isManifest ? 'manifest' : 'module', entry.path);
    nodeIdByPath.set(entry.path, id);
    nodes.push({
      id,
      kind: entry.isManifest ? 'manifest' : 'module',
      label: posix.basename(entry.path),
      path: entry.path,
      districtId,
      language: entry.language,
      bytes: entry.size,
      ...(manifest?.packageName ? { packageName: manifest.packageName } : {}),
      truth: { ...OBSERVED_TRUTH },
      evidence: [{ path: entry.path, line: 1, extractor: 'git-tracked-file' }],
    });
  }
  nodes.sort((left, right) => left.id.localeCompare(right.id, 'en'));

  const phpSymbolToPath = new Map();
  for (const entry of actualEntries.filter((item) => item.language === 'php' && !item.isManifest)) {
    for (const symbol of extractPhpSymbols(contentByPath.get(entry.path))) {
      if (!phpSymbolToPath.has(symbol)) phpSymbolToPath.set(symbol, entry.path);
    }
  }

  const packageManifestByName = new Map();
  for (const manifest of manifestInfos) {
    if (manifest.packageName && !packageManifestByName.has(manifest.packageName)) {
      packageManifestByName.set(manifest.packageName, manifest.manifestPath);
    }
  }

  const edgeById = new Map();
  function recordEdge({ fromPath, toPath, kind, label, confidence, extractor, line, truth }) {
    const from = nodeIdByPath.get(fromPath);
    const to = nodeIdByPath.get(toPath);
    if (!from || !to || from === to) return;
    const id = stableId('e', from, to, kind, label, fromPath, String(line));
    if (edgeById.has(id)) return;
    edgeById.set(id, {
      id,
      from,
      to,
      kind,
      label,
      confidence,
      truth: { ...truth },
      evidence: [{ path: fromPath, line, extractor }],
    });
  }

  for (const entry of actualEntries.filter((item) => !item.isManifest)) {
    const text = contentByPath.get(entry.path);
    const relations = entry.language === 'php'
      ? extractPhpRelations(text)
      : entry.language === 'ruby'
        ? extractRubyRelations(text)
        : extractJavaScriptRelations(text);

    for (const relation of relations) {
      let targetPath;
      if (relation.mode === 'package') {
        targetPath = packageManifestByName.get(relation.specifier);
      } else if (relation.mode === 'php-symbol') {
        targetPath = phpSymbolToPath.get(relation.specifier.replace(/^\\/, ''));
      } else {
        targetPath = pathCandidates(
          entry.path,
          relation.specifier,
          relation.mode,
          entry.language,
        ).find((candidate) => pathSet.has(candidate));
      }
      if (!targetPath) continue;
      recordEdge({
        fromPath: entry.path,
        toPath: targetPath,
        kind: relation.kind,
        label: relation.specifier,
        confidence: 'medium',
        extractor: relation.extractor,
        line: relation.line,
        truth: HEURISTIC_TRUTH,
      });
    }
  }

  for (const manifest of manifestInfos) {
    for (const dependency of manifest.dependencies) {
      const targetPath = packageManifestByName.get(dependency.name);
      if (!targetPath) continue;
      recordEdge({
        fromPath: manifest.manifestPath,
        toPath: targetPath,
        kind: 'declares-dependency',
        label: dependency.name,
        confidence: 'high',
        extractor: dependency.extractor,
        line: dependency.line,
        truth: DECLARED_TRUTH,
      });
    }
  }

  let edges = [...edgeById.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  if (edges.length > config.limits.maxEdges) {
    addDiagnostic(
      diagnostics,
      'edge-limit',
      `${edges.length - config.limits.maxEdges} relationships were omitted by maxEdges (${config.limits.maxEdges}).`,
    );
    edges = edges.slice(0, config.limits.maxEdges);
  }

  const districtMetrics = new Map();
  for (const node of nodes) {
    const metrics = districtMetrics.get(node.districtId) ?? { bytes: 0, nodeCount: 0 };
    metrics.bytes += node.bytes;
    metrics.nodeCount += 1;
    districtMetrics.set(node.districtId, metrics);
  }

  const districts = [];
  for (const key of [...keptDistrictKeys].sort((left, right) => left.localeCompare(right, 'en'))) {
    const id = districtIdByKey.get(key);
    districts.push({
      id,
      ...desiredDistricts.get(key),
      ...(districtMetrics.get(id) ?? { bytes: 0, nodeCount: 0 }),
    });
  }
  if (needsOtherDistrict) {
    districts.push({
      id: otherDistrictId,
      kind: 'other',
      label: 'Other packages and directories',
      path: '',
      ...(districtMetrics.get(otherDistrictId) ?? { bytes: 0, nodeCount: 0 }),
    });
  }
  districts.sort((left, right) => left.id.localeCompare(right.id, 'en'));

  const remote = gitText(repositoryRoot, ['config', '--get', 'remote.origin.url'], {
    allowFailure: true,
    maxBuffer: 1024 * 1024,
  });
  const remoteUrl = sanitizeRemoteUrl(remote);
  const repository = inferRepositoryName(repositoryRoot, remoteUrl, config.repositoryName);
  const limitCodes = new Set([
    'binary-source',
    'byte-limit',
    'district-limit',
    'edge-limit',
    'file-size-limit',
    'node-limit',
    'unsafe-path',
  ]);

  return canonicalize({
    schemaVersion: SCHEMA_VERSION,
    source: {
      provider: 'local-git',
      repository,
      remoteUrl,
      requestedRef: ref,
      commit,
    },
    generator: {
      name: GENERATOR_NAME,
      version: GENERATOR_VERSION,
      configHash: sha256(canonicalStringify(config)),
    },
    scan: {
      trackedFiles,
      eligibleFiles,
      analyzedFiles: actualEntries.length,
      analyzedBytes: actualEntries.reduce((sum, entry) => sum + entry.size, 0),
      skippedFiles: trackedFiles - actualEntries.length,
      incomplete: diagnostics.some((diagnostic) => limitCodes.has(diagnostic.code)),
      limits: { ...config.limits },
      diagnostics: sortDiagnostics(diagnostics),
    },
    districts,
    nodes,
    edges,
  });
}

function helpText() {
  return `Platform Atlas deterministic repository generator

Usage:
  npm run scan -- --repo <local-git-checkout> [options]

Options:
  --repo <path>      Local Git repository to inspect (required)
  --ref <ref>        Commit, branch, or tag to scan (default: HEAD)
  --config <path>    JSON config (default: scripts/scanner.config.json)
  --output <path>    Write NEW generated/*.json AtlasDocument (default: stdout; use - for stdout)
  -h, --help         Show this help

Safety:
  The generator reads tracked blobs through Git. It never executes target code,
  installs its dependencies, imports its modules, or checks out another ref.
`;
}

function parseArguments(argv) {
  const options = { ref: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (!['--repo', '--ref', '--config', '--output'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    options[argument.slice(2)] = value;
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(helpText());
      return 0;
    }
    if (!options.repo) throw new Error('--repo is required.');
    const config = loadConfig(options.config ?? DEFAULT_CONFIG_PATH);
    const atlas = generateAtlas({
      repositoryPath: options.repo,
      ref: options.ref,
      config,
    });
    const serialized = canonicalStringify(atlas);
    if (!options.output || options.output === '-') {
      process.stdout.write(serialized);
    } else {
      const outputPath = newGeneratedPath(PROJECT_DIRECTORY, options.output);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
    }
    return 0;
  } catch (error) {
    process.stderr.write(`atlas-generate: ${error.message}\n`);
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) process.exitCode = main();
