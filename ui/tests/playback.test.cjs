const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/playback.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: exportsForTest },
);
const { clampPlaybackTime } = exportsForTest;

test("next-frame and fast-forward stop at the loaded video's end", () => {
  assert.equal(clampPlaybackTime(12 + 1 / 25, 12), 12);
  assert.equal(clampPlaybackTime(13, 12), 12);
  assert.equal(clampPlaybackTime(3.556, 12), 3.556);
});

test("rewind and invalid targets cannot produce negative or nonfinite time", () => {
  for (const target of [-1, NaN, Infinity, -Infinity]) {
    assert.equal(clampPlaybackTime(target, 12), 0);
  }
  assert.equal(clampPlaybackTime(1, 0), 0);
});

test("unknown media duration does not erase a pending seek", () => {
  for (const duration of [undefined, NaN, Infinity, -1]) {
    assert.equal(clampPlaybackTime(3.556, duration), 3.556);
  }
});
