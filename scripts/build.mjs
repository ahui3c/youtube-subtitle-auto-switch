import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "src"), { recursive: true });
await mkdir(path.join(dist, "vendor"), { recursive: true });
await cp(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true });

const files = [
  "manifest.json",
  "THIRD_PARTY_NOTICES.md",
  "src/background.js",
  "src/content.css",
  "src/content.js",
  "src/core.js",
  "src/page-bridge.js",
  "src/preview-shim.js",
  "src/popup.css",
  "src/popup.html",
  "src/popup.js"
];

for (const file of files) {
  const target = path.join(dist, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, file), target);
}

const openccCandidates = [
  "node_modules/opencc-js/dist/umd/full.js",
  "node_modules/opencc-js/dist/umd/full.min.js"
];
let copiedOpenCC = false;
for (const candidate of openccCandidates) {
  try {
    await cp(path.join(root, candidate), path.join(dist, "vendor/opencc.js"));
    copiedOpenCC = true;
    break;
  } catch {}
}
if (!copiedOpenCC) throw new Error("找不到 OpenCC-JS。請先安裝相依套件。");

await mkdir(path.join(dist, "vendor/licenses"), { recursive: true });
await cp(path.join(root, "node_modules/opencc-js/LICENSE"), path.join(dist, "vendor/licenses/opencc-js-LICENSE"));
await cp(
  path.join(root, "node_modules/opencc-js/THIRD_PARTY_LICENSES.md"),
  path.join(dist, "vendor/licenses/opencc-js-THIRD_PARTY_LICENSES.md")
);

const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
await writeFile(path.join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built extension: ${dist}`);
