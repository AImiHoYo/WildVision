const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const catalog = require("../src/data/labelCatalog.json");
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/labelHints.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
).outputText, {
  exports: exportsForTest,
  require: (name) => {
    assert.equal(name, "../data/labelCatalog.json");
    return catalog;
  },
});
const { lookupLabel, parseLabelHints, labelHint, labelHints } = exportsForTest;

test("species and behavior lookup retains exact keys and never guesses a species", () => {
  assert.equal(lookupLabel("animal", "Gallinago Gallinago Bird").zh, "扇尾沙锥");
  assert.equal(lookupLabel("animal", "Duck").zh, "鸭（泛称）");
  assert.equal(lookupLabel("animal", "Duck Young"), undefined);
  assert.equal(lookupLabel("action", "Duck"), undefined);
  for (const key of ["toString", "constructor", "__proto__"])
    assert.equal(lookupLabel("animal", key), undefined);
});

test("source categories with distinct behavioral meanings stay distinct", () => {
  assert.notEqual(lookupLabel("action", "Attending").zh, lookupLabel("action", "Sensing").zh);
  assert.notEqual(lookupLabel("action", "Escaping").zh, lookupLabel("action", "Fleeing").zh);
  assert.equal(lookupLabel("action", "attending"), undefined);
});

test("long names, quotes and punctuation survive tooltip serialization", () => {
  const label = 'Animal "quoted" & <name> with a very long suffix';
  assert.equal(parseLabelHints(labelHint("animal", label)["data-label-hint"])[0].label, label);
  const entries = [{ kind: "action", label: "Walking" }, { kind: "animal", label }];
  assert.equal(JSON.stringify(parseLabelHints(labelHints(entries)["data-label-hint"])), JSON.stringify(entries));
  for (const raw of ['not json', '{}', '[null, false, {"kind":"bad","label":"x"}]'])
    assert.equal(parseLabelHints(raw).length, 0);
});

test("the catalog distinguishes missing translations and corrupted source labels", () => {
  assert.equal(Object.keys(catalog.actions).length, 140);
  assert.equal(Object.keys(catalog.animals).length, 899);
  assert.ok(Object.values(catalog.actions).every(e => e.zh && e.status === "translated"));
  assert.equal(catalog.animals["Atheris Nitschei Viper"].zh, "大湖树蝰");
  assert.ok(catalog.sources[catalog.animals["Atheris Nitschei Viper"].source].url);
  assert.equal(catalog.animals["Blackbird"].status, "needs_review");
  assert.equal(catalog.animals["��ommon Eider"].status, "needs_review");
  assert.equal(catalog.animals["��ommon Eider"].zh, "");
});

test("every displayed animal translation has a source; developmental forms keep their qualifiers", () => {
  for (const [label, entry] of Object.entries(catalog.animals)) {
    if (entry.status !== "translated") continue;
    assert.ok(entry.zh, label);
    assert.ok(catalog.sources[entry.source], label);
    if (label.endsWith(" Young")) assert.match(entry.zh, /幼/);
    if (label.endsWith(" Larva") || label.endsWith(" Caterpillar")) assert.match(entry.zh, /幼虫/);
  }
  assert.match(catalog.animals["Aphis Fabae Alates"].zh, /有翅/);
  assert.match(catalog.animals["Flamingo"].zh, /泛称/);
  assert.equal(catalog.animals["Flamingo"].scientificName, undefined);
});
