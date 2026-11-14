import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sourceRoot as root } from './source.mjs';
import { fileURLToPath } from 'node:url';
import { snapshot } from '@webcontainer/snapshot';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'firekylin-dependencies-'));
const installed = new Map();
function resolvePackage(name, from) {
  let dir = from;
  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Missing dependency: ' + name + ' from ' + from);
    dir = parent;
  }
}
function link(name, source, destination) {
  const target = install(source);
  const output = path.join(destination, 'node_modules', name);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (!fs.existsSync(output)) fs.symlinkSync(path.relative(path.dirname(output), target), output);
}
function install(source) {
  if (installed.has(source)) return installed.get(source);
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  const destination = path.join(stage, '.store', String(installed.size));
  installed.set(source, destination);
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (item) => {
      const relative = path.relative(source, item);
      return (
        !['node_modules', 'test', 'tests', 'docs', '.github'].includes(relative.split(path.sep)[0]) &&
        !/\.(map|ts|tsx)$/.test(relative)
      );
    }
  });
  // think-gc imports debug without declaring it; preserve the installed resolution.
  if (pkg.name === 'think-gc') {
    link('debug', resolvePackage('debug', source), destination);
  }
  if (pkg.name === '@mathjax/mathjax-newcm-font') {
    link('@mathjax/src', resolvePackage('@mathjax/src', source), destination);
  }
  for (const name of Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies
  })) {
    if ((name === 'typescript' || name.startsWith('@types/')) && !pkg.dependencies?.[name]) continue;
    let dependency;
    try {
      dependency = resolvePackage(name, source);
    } catch (error) {
      if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name]) throw error;
      continue;
    }
    link(name, dependency, destination);
  }
  return destination;
}
const tree = JSON.parse(fs.readFileSync(path.join(here, 'firekylin-files.json')));
const pkg = JSON.parse(tree['package.json'].file.contents);
for (const name of Object.keys(pkg.dependencies)) {
  link(name, resolvePackage(name, name.startsWith('@electric-sql/') ? here : root), stage);
}
const links = {};
function collectLinks(directory, tree) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      tree[entry.name] = { file: { symlink: fs.readlinkSync(filename) } };
      fs.unlinkSync(filename);
    } else if (entry.isDirectory()) {
      const children = {};
      collectLinks(filename, children);
      if (Object.keys(children).length) tree[entry.name] = { directory: children };
    }
  }
}
collectLinks(stage, links);
fs.writeFileSync(path.join(here, 'dependency-links.json'), JSON.stringify(links));
const snapshotDir = path.join(here, 'snapshots');
fs.mkdirSync(snapshotDir, { recursive: true });
const manifest = [];
for (const name of fs.readdirSync(path.join(stage, '.store'))) {
  fs.writeFileSync(path.join(snapshotDir, name + '.bin'), await snapshot(path.join(stage, '.store', name)));
  manifest.push(name);
}
fs.writeFileSync(path.join(here, 'snapshots.json'), JSON.stringify(manifest));
console.log(`Prepared ${installed.size} installed packages`);
fs.rmSync(stage, { recursive: true, force: true });
