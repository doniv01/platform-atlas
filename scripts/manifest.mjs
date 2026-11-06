import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { safeChild, walkFiles } from './lib/paths.mjs';

const HTML_ENTRIES = Object.freeze(['index.html', 'landing.html']);
export const STATIC_ENTRIES = Object.freeze([...HTML_ENTRIES, 'src', 'assets', 'atlases', 'vendor']);
export const NOTICE_FILES = Object.freeze(['LICENSE', 'THIRD_PARTY_NOTICES.md']);

export function normalizeBasePath(value = '/') {
  if (value === '/') return value;
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\/?$/.test(value) || value.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Base path must be / or a project path such as /platform-atlas/.');
  }
  return `${value.replace(/\/$/, '')}/`;
}

export function readRegistry(html) {
  const match = html.match(/<script\b(?=[^>]*\bid=["']atlas-registry["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('index.html needs an atlas-registry JSON script.');
  const registry = JSON.parse(match[1]);
  if (!Array.isArray(registry) || !registry.length) throw new Error('Atlas registry must be a nonempty array.');
  const ids = new Set();
  for (const entry of registry) {
    if (!entry || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Atlas registry has an invalid or duplicate id.');
    ids.add(entry.id);
  }
  return registry;
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [match[1].toLowerCase(), match[3]]));
}

// A deliberately small static-ESM contract check, not a JavaScript parser.
// Literal imports, re-exports, import-map entries, CSS URLs/imports, HTML assets,
// and every registered data module are checked. Computed browser imports still
// need a browser smoke test when the loader changes.
export function validateStaticTree(root, { basePath = '/' } = {}) {
  const base = normalizeBasePath(basePath);
  const origin = 'https://atlas.invalid';
  const pageUrl = new URL(`${base}index.html`, origin);
  const files = [];
  for (const entry of STATIC_ENTRIES) {
    const path = safeChild(root, entry);
    if (!existsSync(path)) throw new Error(`Missing static entry: ${entry}`);
    const stat = lstatSync(path);
    const isHtml = HTML_ENTRIES.includes(entry);
    if (isHtml ? !stat.isFile() : !stat.isDirectory()) throw new Error(`${entry} must be a ${isHtml ? 'file' : 'directory'}.`);
    files.push(...(stat.isDirectory() ? walkFiles(root, path) : [path]));
  }
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const mapMatch = html.match(/<script\b(?=[^>]*\btype=["']importmap["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!mapMatch) throw new Error('Missing local Three.js import map.');
  const imports = JSON.parse(mapMatch[1]).imports;
  if (!imports || !imports.three || !imports['three/addons/']) throw new Error('Import map must include three and three/addons/.');
  let checkedReferences = 0;
  function check(reference, importer = pageUrl, { directory = false, allowData = false } = {}) {
    if (!reference || reference.startsWith('#')) return;
    if (allowData && reference.startsWith('data:')) return;
    if (reference.startsWith('/') || reference.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(reference)) throw new Error(`Asset/import must be a local relative URL: ${reference}`);
    const url = new URL(reference, importer);
    if (url.origin !== origin || !url.pathname.startsWith(base)) throw new Error(`Reference escapes the project base: ${reference}`);
    const path = safeChild(root, decodeURIComponent(url.pathname.slice(base.length)));
    if (!existsSync(path) || (directory ? !lstatSync(path).isDirectory() : !lstatSync(path).isFile())) throw new Error(`Unresolved ${reference} from ${importer.pathname}`);
    checkedReferences += 1;
  }
  for (const [specifier, target] of Object.entries(imports)) check(target, pageUrl, { directory: specifier.endsWith('/') });
  for (const entry of HTML_ENTRIES) {
    const page = entry === 'index.html' ? html : readFileSync(resolve(root, entry), 'utf8');
    const importer = new URL(entry, pageUrl);
    if (/<base\b/i.test(page)) throw new Error(`${entry}: use relative URLs; an HTML base element changes project-path resolution.`);
    for (const tag of page.matchAll(/<(?:script|link|img|source|video|audio)\b[^>]*>/gi)) {
      const attr = attributes(tag[0]);
      for (const name of ['src', 'href', 'poster']) if (attr[name]) check(attr[name], importer, { allowData: true });
    }
  }
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributes(m[0])).find((a) => a.name === 'atlas-module');
  if (!meta?.content) throw new Error('Missing atlas-module metadata.');
  check(meta.content);
  const registry = readRegistry(html);
  for (const entry of registry) {
    check(`./atlases/${entry.id}/atlas-data.mjs`);
    if (entry.art) check(entry.art);
    if (entry.mark) check(entry.mark);
    if (entry.module) check(entry.module);
  }
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const importer = new URL(rel, pageUrl);
    if (/\.(?:mjs|js)$/.test(file)) {
      const code = readFileSync(file, 'utf8');
      const literals = [
        ...code.matchAll(/\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s*)?(["'])([^"'\n]+)\1/g),
        ...code.matchAll(/\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g),
      ];
      for (const match of literals) {
        const specifier = match[2];
        if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(specifier)) check(specifier, importer);
        else {
          const key = Object.keys(imports).filter((item) => item === specifier || (item.endsWith('/') && specifier.startsWith(item))).sort((a, b) => b.length - a.length)[0];
          if (!key) throw new Error(`Unmapped bare import ${specifier} in ${rel}`);
          check(imports[key] + (key.endsWith('/') ? specifier.slice(key.length) : ''), pageUrl);
        }
      }
    } else if (/\.css$/.test(file)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g)) check(match[2], importer, { allowData: true });
      for (const match of css.matchAll(/@import\s+(["'])([^"']+)\1/g)) check(match[2], importer);
    }
  }
  return { files: files.map((file) => relative(root, file).split('\\').join('/')).sort(), registry, checkedReferences, basePath: base };
}
