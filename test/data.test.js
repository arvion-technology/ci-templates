import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { buildData, sourceHash } from "../scripts/build-data.mjs";
import { REUSABLE_FILES } from "../src/validate.js";
import { PROJECT_DATA, SOURCE_HASH } from "../demo/data.js";
import { WORKFLOWS } from "../src/catalog.js";

test("the checked-in demo data is not stale", () => {
  const data = buildData();
  assert.equal(SOURCE_HASH, data.hash, "run `node scripts/build-data.mjs` after editing workflows");
});

test("all reusable workflows are represented", () => {
  assert.equal(PROJECT_DATA.workflows.length, WORKFLOWS.length);
  assert.deepEqual(PROJECT_DATA.workflows.map((workflow) => workflow.file.split("/").pop()).sort(), [...REUSABLE_FILES].sort());
  for (const workflow of PROJECT_DATA.workflows) {
    assert.ok(workflow.name, workflow.id);
    assert.ok(workflow.purpose.length > 30, workflow.id);
    assert.deepEqual(workflow.triggers, ["workflow_call"]);
    assert.ok(workflow.inputs.length > 0, workflow.id);
    assert.ok(workflow.jobs.length > 0, workflow.id);
    assert.ok(workflow.source.includes("jobs:"));
    assert.ok(workflow.lines > 10);
    for (const input of workflow.inputs) assert.ok(input.description, `${workflow.id}.${input.name}`);
    for (const job of workflow.jobs) {
      assert.ok(job.runsOn, `${workflow.id}.${job.id}`);
      assert.ok(job.steps.length > 0);
    }
  }
});

test("every third-party action in the data is pinned", () => {
  for (const workflow of PROJECT_DATA.workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!step.uses || step.uses.startsWith("./")) continue;
        assert.ok(step.action.pinned, `${workflow.id}.${job.id}: ${step.uses}`);
        assert.equal(step.action.pin.length, 40);
      }
    }
  }
});

test("the examples data lists the reusable calls and their inputs", () => {
  assert.equal(PROJECT_DATA.examples.length, 4);
  for (const example of PROJECT_DATA.examples) {
    assert.ok(example.triggers.length > 0);
    assert.ok(example.calls.length > 0, example.id);
    assert.ok(example.source.includes("uses:"), example.id);
    for (const call of example.calls) {
      assert.match(call.uses, /\.github\/workflows\/reusable-.*@v\d+$/);
    }
  }
  const container = PROJECT_DATA.examples.find((example) => example.id === "example-container");
  assert.deepEqual(container.calls[0].secrets.sort(), ["REGISTRY_PASSWORD", "REGISTRY_USERNAME"]);
});

test("docs and permissions are included", () => {
  assert.deepEqual(PROJECT_DATA.docs.map((doc) => doc.file).sort(), ["docs/permissions.md", "docs/pinning.md", "docs/workflows.md"]);
  const docker = PROJECT_DATA.workflows.find((workflow) => workflow.id === "docker-release");
  assert.equal(docker.jobs[0].permissions.packages, "write");
  assert.equal(docker.topPermissions.contents, "read");
});

test("the hash covers every tracked file", () => {
  const first = sourceHash();
  assert.equal(first, sourceHash());
  assert.equal(first.length, 64);
});

test("scripts/validate.mjs exits zero and has a JSON mode", () => {
  const output = execFileSync(process.execPath, ["scripts/validate.mjs"], { encoding: "utf8" });
  assert.match(output, /workflow checks passed/);

  const json = execFileSync(process.execPath, ["scripts/validate.mjs", "--json"], { encoding: "utf8" });
  const report = JSON.parse(json);
  assert.equal(report.ok, true);
  assert.equal(report.result.stats.workflows, 5);
});
