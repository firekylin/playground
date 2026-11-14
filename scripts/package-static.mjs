import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, outputRoot } from "./source.mjs";

await fs.cp(path.join(projectRoot, "src"), outputRoot, { recursive: true });
await fs.cp(path.join(projectRoot, "public"), outputRoot, { recursive: true });
await fs.cp(
  path.join(projectRoot, "node_modules/@webcontainer/api/dist"),
  path.join(outputRoot, "sdk"),
  { recursive: true },
);
await fs.mkdir(path.join(outputRoot, "vendor"), { recursive: true });
for (const [source, target] of [
  ["@xterm/xterm/lib/xterm.mjs", "xterm.mjs"],
  ["@xterm/addon-fit/lib/addon-fit.mjs", "fit.mjs"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
]) {
  await fs.copyFile(
    path.join(projectRoot, "node_modules", source),
    path.join(outputRoot, "vendor", target),
  );
}
