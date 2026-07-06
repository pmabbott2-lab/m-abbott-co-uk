// Builds all Mortgage Hub print assets (flyers, then manual).
// Run: npm run build:marketing

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(script) {
  const cacheDir = resolve(__dirname, "../.puppeteer-cache");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(__dirname, script)], {
      stdio: "inherit",
      env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

await run("build-flyers.mjs");
await run("build-manual.mjs");
