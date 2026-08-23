import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("OpenCC 不會在預設 YouTube 分頁預先載入", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const isolatedScript = manifest.content_scripts.find((entry) => entry.world !== "MAIN");
  assert.equal(isolatedScript.js.includes("vendor/opencc.js"), false);
  assert.equal(manifest.permissions.includes("scripting"), true);
});
