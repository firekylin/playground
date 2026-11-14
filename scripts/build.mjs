import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, sourceRoot, outputRoot } from './source.mjs';

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
await fs.mkdir(sourceRoot, { recursive: true });
run('git', ['init', '--quiet'], sourceRoot);
run('git', ['fetch', '--depth=1', 'https://github.com/firekylin/firekylin.git', 'master'], sourceRoot);
run('git', ['checkout', '--detach', 'FETCH_HEAD'], sourceRoot);
// All downloaded sources and dependencies stay in the ignored build cache.
const pnpm = path.join(projectRoot, 'node_modules/pnpm/bin/pnpm.mjs');
run(process.execPath, [pnpm, 'install', '--frozen-lockfile', '--ignore-scripts'], sourceRoot);
run(process.execPath, [pnpm, 'exec', 'vite', 'build'], sourceRoot);
await fs.rm(outputRoot, {recursive: true, force: true});
await fs.mkdir(outputRoot, {recursive: true});
run(process.execPath, ['scripts/prepare.mjs']);
run(process.execPath, ['scripts/prepare-dependencies.mjs']);
run(process.execPath, ['scripts/package-static.mjs']);
console.log('Static deployment ready in dist/. Run npm run preview to inspect locally.');
