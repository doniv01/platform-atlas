import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

// Check every existing component, including dangling symlinks. Do this before
// creating a cache/output directory; a lexical prefix alone is insufficient.
export function safeChild(root, value, { allowRoot = false } = {}) {
  const base = realpathSync(root);
  const target = resolve(base, value);
  if (!isWithin(base, target) || (!allowRoot && target === base)) {
    throw new Error(`Path must be inside ${base}: ${value}`);
  }
  let cursor = base;
  for (const part of relative(base, target).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function managedDirectory(root, name) {
  const path = safeChild(root, name);
  mkdirSync(path, { recursive: true });
  if (!lstatSync(path).isDirectory()) throw new Error(`Expected directory: ${path}`);
  return path;
}

export function newGeneratedPath(root, value) {
  const path = safeChild(root, value);
  const generated = resolve(realpathSync(root), 'generated');
  if (!isWithin(generated, path) || path === generated) {
    throw new Error('Output must be a new file or directory inside generated/. Curated atlases are protected.');
  }
  if (existsSync(path)) throw new Error(`Output already exists; choose a new name: ${path}`);
  return path;
}

export function walkFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = safeChild(root, resolve(directory, entry.name));
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Only regular files and directories are supported: ${path}`);
  }
  return files;
}

export function isMain(url) {
  return Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url);
}

export function parseOptions(argv, allowed, booleans = []) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '-h' || argument === '--help') { result.help = true; continue; }
    const key = argument.replace(/^--/, '');
    if (!argument.startsWith('--') || !allowed.includes(key) || Object.hasOwn(result, key)) {
      throw new Error(`Unknown or duplicate option: ${argument}`);
    }
    if (booleans.includes(key)) { result[key] = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[key] = value;
  }
  return result;
}
