import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {projectRoot} from './source.mjs';
for (const directory of ['src', 'runtime', 'scripts', 'test']) {
    for (const name of await readdir(path.join(projectRoot, directory))) {
        if (!/\.(mjs|cjs|js)$/.test(name)) continue;
        const result = spawnSync(process.execPath, ['--check', path.join(projectRoot, directory, name)], {stdio: 'inherit'});
        if (result.status !== 0) process.exit(result.status || 1);
    }
}
