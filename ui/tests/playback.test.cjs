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
const { applyPlaybackRate, clampPlaybackTime, parsePlaybackRate, PLAYBACK_RATE_PRESETS } = exportsForTest;

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

test("requested preset and custom rates are positive finite values", () => {
  assert.deepEqual(Array.from(PLAYBACK_RATE_PRESETS), [0.25, 0.5, 1, 1.5, 2, 3]);
  for (const rate of [...PLAYBACK_RATE_PRESETS, 1.25, 4]) {
    assert.equal(parsePlaybackRate(String(rate)), rate);
  }
  for (const text of ["", " ", "0", "-1", "NaN", "Infinity", "abc"]) {
    assert.equal(parsePlaybackRate(text), null);
  }
});

test("a rate change synchronizes video and separate audio without changing source times", () => {
  const video = { playbackRate: 1, defaultPlaybackRate: 1, currentTime: 2.5 };
  const audio = { playbackRate: 1, defaultPlaybackRate: 1, currentTime: 2.5 };
  assert.equal(applyPlaybackRate([video, audio], 1.25), true);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(audio.playbackRate, 1.25);
  assert.equal(video.defaultPlaybackRate, 1.25);
  assert.equal(audio.defaultPlaybackRate, 1.25);
  assert.equal(video.currentTime, 2.5);
  assert.equal(audio.currentTime, 2.5);
});

test("an unsupported audio rate restores both media rates and invalid input is a no-op", () => {
  const video = { playbackRate: 1.5, defaultPlaybackRate: 1.5 };
  let audioRate = 1.5;
  const audio = {
    defaultPlaybackRate: 1.5,
    get playbackRate() { return audioRate; },
    set playbackRate(value) {
      if (value === 10) throw new Error("unsupported rate");
      audioRate = value;
    },
  };
  assert.equal(applyPlaybackRate([video, audio], 10), false);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.defaultPlaybackRate, 1.5);
  assert.equal(audio.playbackRate, 1.5);
  for (const rate of [0, -1, Infinity, NaN]) {
    assert.equal(applyPlaybackRate([video, audio], rate), false);
    assert.equal(video.playbackRate, 1.5);
  }
  assert.equal(applyPlaybackRate([null, null], 2), true);
});
