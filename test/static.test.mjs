import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { outputRoot, projectRoot } from "../scripts/source.mjs";

test("static deployment contains browser assets and all runtime snapshots", async () => {
  const config = JSON.parse(
    await readFile(path.join(projectRoot, "vercel.json")),
  );
  assert.equal(config.outputDirectory, "dist");
  const headers = Object.fromEntries(
    config.headers[0].headers.map(({ key, value }) => [key, value]),
  );
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
  const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map(
    (match) => match[1],
  );
  for (const asset of [
    ...assets,
    "/sdk/index.js",
    "/vendor/xterm.mjs",
    "/vendor/fit.mjs",
  ]) {
    assert.ok((await stat(path.join(outputRoot, asset))).isFile(), asset);
  }
  const manifest = JSON.parse(
    await readFile(path.join(outputRoot, "snapshots.json")),
  );
  assert.ok(manifest.length > 0);
  for (const name of manifest) {
    assert.ok(
      (await stat(path.join(outputRoot, "snapshots", `${name}.bin`))).size > 0,
    );
  }
  const tree = JSON.parse(
    await readFile(path.join(outputRoot, "firekylin-files.json")),
  );
  assert.ok(tree["start-playground.cjs"]);
  assert.ok(tree["seed-site.cjs"]);
  assert.ok(tree["db-tool.cjs"]);
  assert.equal(tree["blueprint-runner.cjs"], undefined);
  assert.equal(tree["blueprint.json"], undefined);
  for (const filename of [
    "serve.mjs",
    "blueprint.mjs",
    "package.json",
    ".env",
  ]) {
    await assert.rejects(stat(path.join(outputRoot, filename)), {
      code: "ENOENT",
    });
  }
});
