import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { validateTemplates, REUSABLE_FILES } from "../src/validate.js";

const ROOT = process.cwd();
const TEXT = new Set([".yml", ".yaml", ".md", ".mjs", ".json"]);

function readTree(directory = ROOT, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "fonts", "demo"].includes(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) readTree(full, files);
    else if (TEXT.has(entry.name.slice(entry.name.indexOf(".")))) {
      files[relative(ROOT, full).split("\\").join("/")] = readFileSync(full, "utf8");
    }
  }
  return files;
}

const realFiles = readTree();
const clone = () => ({ ...readTree() });

test("the repository passes its own workflow checks", () => {
  const result = validateTemplates(realFiles);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.stats.workflows, 5);
  assert.equal(result.stats.examples, 4);
  assert.ok(result.stats.pinnedActions >= 20);
  assert.equal(result.stats.reusableRefs, 4);
});

test("every reusable workflow declares workflow_call and documented inputs", () => {
  for (const file of REUSABLE_FILES) {
    const source = realFiles[`.github/workflows/${file}`];
    assert.ok(source, file);
    assert.match(source, /workflow_call:/);
    assert.match(source, /description:/);
  }
});

test("unpinned actions are rejected", () => {
  const files = clone();
  files[".github/workflows/reusable-node-ci.yml"] = files[".github/workflows/reusable-node-ci.yml"]
    .replace("actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af", "actions/setup-node@v4");
  const result = validateTemplates(files);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /not pinned to a 40-character commit SHA/.test(error.message)));
});

test("top-level write permissions are rejected", () => {
  const files = clone();
  files[".github/workflows/reusable-python-ci.yml"] = files[".github/workflows/reusable-python-ci.yml"]
    .replace("permissions:\n  contents: read", "permissions:\n  contents: write");
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /"contents: write" is not allowed/.test(error.message)));

  const writeAll = clone();
  writeAll[".github/workflows/reusable-node-ci.yml"] = writeAll[".github/workflows/reusable-node-ci.yml"]
    .replace("permissions:\n  contents: read", "permissions: write-all");
  assert.ok(validateTemplates(writeAll).errors.some((error) => /write-all/.test(error.message)));
});

test("write scopes are allowed only in the workflow that needs them", () => {
  const files = clone();
  files[".github/workflows/reusable-node-ci.yml"] = files[".github/workflows/reusable-node-ci.yml"]
    .replace("    timeout-minutes: 15", "    timeout-minutes: 15\n    permissions:\n      packages: write");
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /"packages: write" is not allowed/.test(error.message)));
});

test("pull_request_target and untrusted run interpolation are rejected", () => {
  const target = clone();
  target[".github/workflows/reusable-node-ci.yml"] = target[".github/workflows/reusable-node-ci.yml"]
    .replace("  workflow_call:", "  pull_request_target:");
  assert.ok(validateTemplates(target).errors.some((error) => /pull_request_target/.test(error.message)));

  const injection = clone();
  injection[".github/workflows/reusable-node-ci.yml"] = injection[".github/workflows/reusable-node-ci.yml"]
    .replace("run: ${{ inputs.package-manager }} test", "run: echo ${{ github.event.pull_request.title }}");
  assert.ok(validateTemplates(injection).errors.some((error) => /untrusted event data/.test(error.message)));
});

test("an input without a description or type is rejected", () => {
  const files = clone();
  files[".github/workflows/reusable-node-ci.yml"] = files[".github/workflows/reusable-node-ci.yml"]
    .replace("        description: Directory that contains package.json.\n", "")
    .replace("        type: number\n        required: false", "        required: false");
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /input "working-directory" has no description/.test(error.message)));
  assert.ok(result.errors.some((error) => /input "coverage-threshold" has invalid type/.test(error.message)));
});

test("a missing reusable workflow file is reported", () => {
  const files = clone();
  delete files[".github/workflows/reusable-pages.yml"];
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /reusable-pages.yml/.test(error.path)));
  assert.ok(result.errors.some((error) => /unknown reusable workflow/.test(error.message)));
});

test("examples must call a reusable workflow", () => {
  const files = clone();
  files["examples/node-service/.github/workflows/ci.yml"] = files["examples/node-service/.github/workflows/ci.yml"]
    .replace("uses: arvion-technology/ci-templates/.github/workflows/reusable-node-ci.yml@v1", "runs-on: ubuntu-latest");
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /example does not call a reusable workflow/.test(error.message)));
});

test("the docker release keeps its safety nets", () => {
  const files = clone();
  files[".github/workflows/reusable-docker-release.yml"] = files[".github/workflows/reusable-docker-release.yml"]
    .replace("packages: write", "packages: read");
  const result = validateTemplates(files);
  assert.ok(result.errors.some((error) => /packages: write/.test(error.message)));
});
