import test from "node:test";
import assert from "node:assert/strict";

import { parseYaml } from "../src/yaml.js";

test("parses a workflow trigger map and jobs", () => {
  const document = parseYaml(`name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - run: npm test
`);
  assert.equal(document.name, "CI");
  assert.deepEqual(Object.keys(document.on), ["push", "pull_request"]);
  assert.deepEqual(document.permissions, { contents: "read" });
  assert.equal(document.jobs.test["runs-on"], "ubuntu-latest");
  assert.equal(document.jobs.test.steps.length, 2);
  assert.equal(document.jobs.test.steps[1].run, "npm test");
});

test("parses workflow_call inputs and truthy defaults", () => {
  const document = parseYaml(`on:
  workflow_call:
    inputs:
      node-versions:
        description: JSON array.
        type: string
        required: false
        default: '["20", "22"]'
      push:
        description: Push the image.
        type: boolean
        default: true
`);
  const call = document.on.workflow_call;
  assert.equal(call.inputs["node-versions"].default, '["20", "22"]');
  assert.equal(call.inputs.push.default, true);
  assert.equal(call.inputs["node-versions"].required, false);
});

test("keeps block scalars as multi-line strings", () => {
  const document = parseYaml(`jobs:
  build:
    steps:
      - name: Assemble
        run: |
          mkdir -p public
          cp -R docs/. public/
`);
  const run = document.jobs.build.steps[0].run;
  assert.match(run, /mkdir -p public/);
  assert.match(run, /cp -R docs\/\. public\//);
});

test("flow collections and comments behave", () => {
  const document = parseYaml(`jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]   # supported versions
    steps:
      - run: echo "not a # comment"
`);
  assert.deepEqual(document.jobs.test.strategy.matrix.node, [20, 22]);
  assert.equal(document.jobs.test.steps[0].run, 'echo "not a # comment"');
});

test("rejects tab indentation", () => {
  assert.throws(() => parseYaml("jobs:\n\ttest: 1\n"), /tab indentation/);
});
