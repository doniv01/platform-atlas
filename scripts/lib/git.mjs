import { spawnSync } from 'node:child_process';
import { devNull } from 'node:os';

export function gitEnvironment(environment = process.env) {
  // Avoid inherited GIT_DIR, object alternates, injected -c config, or replacement
  // objects changing which repository/ref is actually scanned.
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')));
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
  };
}

export function runGit(args, { cwd, input, maxBuffer = 16 * 1024 * 1024, timeout = 120000, allowFailure = false } = {}) {
  const result = spawnSync('git', [
    '-c', `core.hooksPath=${devNull}`,
    '-c', 'credential.helper=',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'http.followRedirects=false',
    ...args,
  ], { cwd, input, encoding: null, shell: false, env: gitEnvironment(), maxBuffer, timeout });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`Git failed: ${result.error?.message || result.stderr?.toString('utf8').trim() || result.status}`);
  }
  return result;
}

export function gitText(args, options) {
  return runGit(args, options).stdout.toString('utf8').trim();
}
