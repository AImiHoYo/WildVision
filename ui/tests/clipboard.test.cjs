const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTsModule(relPath, stubModules = {}) {
  const filePath = path.join(__dirname, "..", relPath);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id in stubModules) return stubModules[id];
    if (id === "../types") {
      return {
        isFullState(res) {
          return Boolean(res && res.ok && Array.isArray(res.segments));
        },
      };
    }
    return require(id);
  };
  const fn = new Function("exports", "require", "module", transpiled);
  fn(mod.exports, customRequire, mod);
  return mod.exports;
}

test("resolvePastePlan preserves each segment's original track_index in multi-select and shifts to playhead when moved", () => {
  const { resolvePastePlan } = loadTsModule("src/lib/annotationClipboard.ts", {
    "../bridge": { call: async () => ({ ok: true }) },
  });

  const clip = {
    items: [
      { id: "s1", animal: "Snow Leopard", action: "Walking", start: 1.0, end: 2.5, track_index: 0 },
      { id: "s2", animal: "Ibex", action: "Running", start: 2.0, end: 4.0, track_index: 1 },
    ],
    playhead: 1.0,
    trackIndex: 0,
  };

  const baseParams = {
    clipboard: clip,
    selectedTrackIndex: 1,
    tracks: ["Snow Leopard", "Ibex"],
    labels: [
      { animal: "Snow Leopard", action: "Walking" },
      { animal: "Ibex", action: "Running" },
    ],
    existingSegments: clip.items,
    fps: 25,
  };

  // Playhead moved to 5.0s -> paste anchored at 5.0s, preserving relative offsets (0s and +1.0s) and original tracks (0 and 1)
  const planMoved = resolvePastePlan({
    ...baseParams,
    currentPlayhead: 5.0,
  });
  assert.equal(planMoved.baseStart, 5.0);
  assert.equal(planMoved.specs.length, 2);
  assert.deepEqual(planMoved.specs[0], {
    trackIndex: 0,
    animal: "Snow Leopard",
    action: "Walking",
    offset: 0,
    duration: 1.5,
  });
  assert.deepEqual(planMoved.specs[1], {
    trackIndex: 1,
    animal: "Ibex",
    action: "Running",
    offset: 1.0,
    duration: 2.0,
  });

  // Playhead unmoved (1.0s) -> auto-advances past existing [1.0..2.5] / [2.0..4.0] conflict
  const planAutoAdvance = resolvePastePlan({
    ...baseParams,
    currentPlayhead: 1.0,
  });
  assert.ok(planAutoAdvance.baseStart > 2.5, "should auto-advance past overlapping segments");
});

test("resolvePastePlan pastes single segment onto newly selected track at original timestamp when playhead unmoved", () => {
  const { resolvePastePlan } = loadTsModule("src/lib/annotationClipboard.ts", {
    "../bridge": { call: async () => ({ ok: true }) },
  });

  const clip = {
    items: [
      { id: "s1", animal: "Snow Leopard", action: "Walking", start: 2.0, end: 3.5, track_index: 0 },
    ],
    playhead: 2.0,
    trackIndex: 0,
  };

  const plan = resolvePastePlan({
    clipboard: clip,
    currentPlayhead: 2.0,
    selectedTrackIndex: 1,
    tracks: ["Snow Leopard", "Snow Leopard"],
    labels: [{ animal: "Snow Leopard", action: "Walking" }],
    existingSegments: clip.items,
    fps: 25,
  });
  assert.equal(plan.baseStart, 2.0);
  assert.equal(plan.specs[0].trackIndex, 1);
});
