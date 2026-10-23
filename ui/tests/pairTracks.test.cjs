const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const mod = { exports: {} };
new Function("exports", "require", "module", ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/pairTracks.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText)(mod.exports, require, mod);
const { buildPairTracks, pairSegments, mergePairSegments } = mod.exports;

test("one row per animal-action pair regardless of repeated source animal slots", () => {
  const labels = [
    { animal: "Flamingo", action: "Walking", key: "a" },
    { animal: "Flamingo", action: "Drinking", key: "b" },
    { animal: "Flamingo", action: "Walking", key: "a" },
    { animal: "Duck", action: "Walking", key: "c" },
  ];
  const rows = buildPairTracks(labels, ["Flamingo", "Flamingo", "Duck"]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => [r.animal, r.action, r.sourceTrackIndex]), [
    ["Flamingo", "Walking", 0], ["Flamingo", "Drinking", 0], ["Duck", "Walking", 2],
  ]);
});

test("all occurrences of a pair share a row and legacy-only annotations stay visible", () => {
  const segments = [
    { id: "a", animal: "Flamingo", action: "Walking", start: 0, end: 2, track_index: 0 },
    { id: "b", animal: "Flamingo", action: "Walking", start: 5, end: 7, track_index: 1 },
    { id: "c", animal: "Flamingo", action: "Drinking", start: 1, end: 3, track_index: 1 },
  ];
  assert.deepEqual(pairSegments(segments, "Flamingo", "Walking").map(s => s.id), ["a", "b"]);
  assert.equal(buildPairTracks([], ["Flamingo", "Flamingo"], segments).length, 2);
});

test("duration input unions legacy pair overlaps without merging distinct behaviors or mutating records", () => {
  const source = [
    { id: "a", animal: "Flamingo", action: "Walking", start: 0, end: 2, track_index: 0 },
    { id: "b", animal: "Flamingo", action: "Walking", start: 1, end: 3, track_index: 1 },
    { id: "c", animal: "Flamingo", action: "Walking", start: 5, end: 7, track_index: 1 },
    { id: "d", animal: "Flamingo", action: "Drinking", start: 1, end: 3, track_index: 0 },
  ];
  const merged = mergePairSegments(source);
  assert.deepEqual(merged.map(s => [s.action, s.start, s.end]), [["Walking", 0, 3], ["Walking", 5, 7], ["Drinking", 1, 3]]);
  assert.equal(source[0].end, 2);
});

test("insights count pair presence and simultaneous behaviors even when storage indices coincide", () => {
  const analytics = { exports: {} };
  new Function("exports", "require", "module", ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/components/evaluation/insightsAnalytics.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText)(analytics.exports, () => mod.exports, analytics);
  const card = {
    video_id: "synthetic", video_name: "synthetic.mp4", video_relpath: "synthetic.mp4", fps: 25,
    estDuration: 10, list_animal: ["Flamingo", "Flamingo"],
    list_animal_action: [["Flamingo", "Walking"], ["Flamingo", "Drinking"]],
    status: "completed", label_count: 2, done_count: 2,
    segments: [
      { id: "a", animal: "Flamingo", action: "Walking", start: 0, end: 4, track_index: 0 },
      { id: "b", animal: "Flamingo", action: "Walking", start: 2, end: 6, track_index: 1 },
      { id: "c", animal: "Flamingo", action: "Drinking", start: 2, end: 4, track_index: 0 },
    ],
  };
  const result = analytics.exports.computeInsightsSnapshot([card]);
  assert.equal(result.totalSegments, 2);
  assert.equal(result.totalDurationSec, 8);
  assert.equal(result.foregroundRatio, 60);
  // Existing metric denominator is active foreground time: 2 / 6 seconds.
  assert.ok(Math.abs(result.overlapRatio - 100 / 3) < 1e-9);
  assert.equal(card.segments[0].end, 4);
});
