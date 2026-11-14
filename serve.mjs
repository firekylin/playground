import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html'],
  '/logo-animated.svg': ['logo-animated.svg', 'image/svg+xml'],
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/dependency-links.json': ['dependency-links.json', 'application/json'],
  '/snapshots.json': ['snapshots.json', 'application/json'],
  '/firekylin-files.json': ['firekylin-files.json', 'application/json'],
  '/i18n.mjs': ['i18n.mjs', 'text/javascript'],
  '/app.js': ['app.js', 'text/javascript'],
  '/blueprint.mjs': ['blueprint.mjs', 'text/javascript'],
  '/library.mjs': ['library.mjs', 'text/javascript'],
  '/devtools.mjs': ['devtools.mjs', 'text/javascript'],
  '/vendor/xterm.mjs': ['node_modules/@xterm/xterm/lib/xterm.mjs', 'text/javascript'],
  '/vendor/fit.mjs': ['node_modules/@xterm/addon-fit/lib/addon-fit.mjs', 'text/javascript'],
  '/vendor/xterm.css': ['node_modules/@xterm/xterm/css/xterm.css', 'text/css'],
  '/style.css': ['style.css', 'text/css'],
  '/webcontainer.js': ['node_modules/@webcontainer/api/dist/index.js', 'text/javascript']
};
createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  const sdkPath = requestPath.startsWith('/sdk/') ? requestPath.slice(5) : '';
  const file = sdkPath && /^[a-zA-Z0-9_/-]+\.js$/.test(sdkPath)
    ? ['node_modules/@webcontainer/api/dist/' + sdkPath, 'text/javascript']
    : /^\/snapshots\/\d+\.bin$/.test(requestPath)
      ? [requestPath.slice(1), 'application/octet-stream']
      : files[requestPath];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    res.setHeader('Content-Type', file[1] + '; charset=utf-8');
    res.end(data);
  } catch (error) {
    res.writeHead(500).end(error.message);
  }
}).listen(4178, '127.0.0.1', () => {
  console.log('Open http://localhost:4178');
});
