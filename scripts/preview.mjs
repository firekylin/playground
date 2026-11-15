// Local convenience only. Vercel serves dist/ directly and never runs this file.
import themeProxy from '../api/theme.js';
import oauthServices from '../api/oauth-services.js';
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { outputRoot, projectRoot } from "./source.mjs";

const config = JSON.parse(
  await readFile(path.join(projectRoot, "vercel.json"), "utf8"),
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".bin": "application/octet-stream",
};
const port = Number(process.env.PORT || 4178);
createServer(async (req, res) => {
  for (const header of config.headers[0].headers)
    res.setHeader(header.key, header.value);
  res.setHeader("Cache-Control", "no-store");
  if (new URL(req.url, 'http://localhost').pathname === '/api/theme') {
    await themeProxy(req, res);
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname === '/api/oauth-services') {
    await oauthServices(req, res);
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let file = path.resolve(outputRoot, "." + pathname);
    if (file !== outputRoot && !file.startsWith(outputRoot + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found. Run npm run build first.");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Open http://localhost:${port}`),
);
