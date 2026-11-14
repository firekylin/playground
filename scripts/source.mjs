import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceRoot = path.join(projectRoot, '.cache', 'firekylin');
export const outputRoot = path.join(projectRoot, 'dist');
export const runtimeRoot = path.join(projectRoot, 'runtime');
