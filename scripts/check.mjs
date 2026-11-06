import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT, walkFiles } from './lib/paths.mjs';
import { validateStaticTree } from './manifest.mjs';

try {
  let count = 0;
  for (const name of ['src', 'atlases', 'scripts', 'tests']) {
    const directory = join(PROJECT_ROOT, name);
    if (!existsSync(directory)) continue;
    for (const path of walkFiles(PROJECT_ROOT, directory).filter((file) => /\.(mjs|js)$/.test(file))) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
      count += 1;
    }
  }
  const manifest = validateStaticTree(PROJECT_ROOT);
  validateStaticTree(PROJECT_ROOT, { basePath: '/platform-atlas/' });
  console.log(`Syntax: ${count} modules. Static references: ${manifest.checkedReferences}. Root and project paths valid.`);
} catch (error) { console.error(`check: ${error.message}`); process.exitCode = 1; }
