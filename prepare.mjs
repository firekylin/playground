import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceRoot as root } from './source.mjs';

const tree = {};
async function add(relative) {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const directory = {};
  for (const entry of entries) {
    if (entry.name === 'db.js' && relative === 'src/config') continue;
    if (entry.isDirectory()) {
      directory[entry.name] = { directory: await walk(path.join(absolute, entry.name)) };
    } else if (entry.isFile()) {
      directory[entry.name] = { file: { contents: [...(await readFile(path.join(absolute, entry.name)))] } };
    }
  }
  return directory;
}
async function walk(absolute) {
  return add(path.relative(root, absolute));
}
for (const name of ['src', 'lib', 'view', 'skills']) tree[name] = { directory: await add(name) };
tree.bin = {
  directory: {
    'firekylin.js': { file: { contents: await readFile(path.join(root, 'bin/firekylin.js'), 'utf8') } }
  }
};
tree.www = { directory: { static: { directory: {} }, theme: { directory: {} } } };
for (const name of ['dist', 'img', 'css', 'font', 'module']) {
  tree.www.directory.static.directory[name] = { directory: await add('www/static/' + name) };
}
tree.www.directory.theme.directory.firekylin = { directory: await add('www/theme/firekylin') };
for (const name of ['firekylin.pgsql', 'package.json', 'LICENSE']) {
  tree[name] = { file: { contents: await readFile(path.join(root, name), 'utf8') } };
}
// Package selection only: never rewrite Firekylin business source.
const pkg = JSON.parse(tree['package.json'].file.contents);
delete pkg.dependencies.sharp;
delete pkg.dependencies['think-model-sqlite'];
pkg.dependencies['@electric-sql/pglite'] = '0.5.16';
pkg.dependencies['@electric-sql/pglite-socket'] = '0.2.19';
for (const name of Object.keys(pkg.dependencies)) {
  if (
    name.startsWith('@codemirror/') ||
    name.startsWith('@uiw/') ||
    name === '@better-captcha/react' ||
    name === 'codemirror-lang-eta'
  ) {
    delete pkg.dependencies[name];
  }
}
delete pkg.devDependencies;
delete pkg.scripts;
delete pkg.packageManager;
tree['package.json'].file.contents = JSON.stringify(pkg, null, 2);
tree['start-playground.cjs'] = {
  file: { contents: await readFile(new URL('start-playground.cjs', import.meta.url), 'utf8') }
};
for (const name of ['blueprint.mjs', 'blueprint-runner.cjs', 'db-tool.cjs']) {
  tree[name] = { file: { contents: await readFile(new URL(name, import.meta.url), 'utf8') } };
}
await writeFile(new URL('firekylin-files.json', import.meta.url), JSON.stringify(tree));
console.log('Packaged pinned Firekylin source and built admin assets');
