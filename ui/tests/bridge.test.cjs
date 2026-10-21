const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/bridge.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;

function bridge(initial, afterTick = () => {}) {
  let elapsed = 0;
  const listeners = new Map();
  const window = {
    pywebview: initial,
    addEventListener: (name, callback) => listeners.set(name, callback),
    setTimeout: (callback, delay) => {
      elapsed += delay;
      afterTick(window, elapsed);
      queueMicrotask(callback);
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    window,
    performance: { now: () => elapsed },
  });
  return { ...exports, window, listeners, elapsed: () => elapsed };
}

test("waits for get_state when the API object exists before its methods", async () => {
  let calls = 0;
  const state = { ok: true, labels: [], segments: [] };
  const b = bridge({ api: {} }, (window, elapsed) => {
    if (elapsed >= 180)
      window.pywebview.api.get_state = () => {
        calls++;
        return state;
      };
  });
  assert.equal(await b.call("get_state"), state);
  assert.equal(calls, 1);
  assert.equal(b.elapsed(), 180);
});

test("also handles a late API object and invokes the method once with original arguments", async () => {
  let args;
  const b = bridge(undefined, (window, elapsed) => {
    if (elapsed >= 120)
      window.pywebview = {
        api: {
          mark_end: (...values) => {
            args = values;
            return { ok: true };
          },
        },
      };
  });
  assert.equal((await b.call("mark_end", 1.2, 0, "Eating")).ok, true);
  assert.deepEqual(args, [1.2, 0, "Eating"]);
});

test("re-reads the API if its object is replaced during initialization", async () => {
  const b = bridge({ api: {} }, (window, elapsed) => {
    if (elapsed >= 120)
      window.pywebview.api = { get_state: () => ({ ok: true }) };
  });
  assert.equal((await b.call("get_state")).ok, true);
});

test("already available methods do not wait", async () => {
  const b = bridge({ api: { get_state: () => ({ ok: true }) } });
  assert.equal((await b.call("get_state")).ok, true);
  assert.equal(b.elapsed(), 0);
});

test("missing methods have a bounded timeout and retain the existing error response", async () => {
  const b = bridge({ api: {} });
  const result = await b.call("missing");
  assert.equal(result.ok, false);
  assert.match(result.message, /missing/);
  assert.ok(b.elapsed() >= 10000 && b.elapsed() < 10100);
});

test("backend errors propagate without retrying an invoked operation", async () => {
  const error = new Error("disk failure");
  let calls = 0;
  const b = bridge({
    api: {
      save_current_card: () => {
        calls++;
        throw error;
      },
    },
  });
  await assert.rejects(
    b.call("save_current_card"),
    (caught) => caught === error,
  );
  assert.equal(calls, 1);
});
