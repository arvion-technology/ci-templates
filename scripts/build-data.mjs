#!/usr/bin/env node
// Generate demo/data.js from the real workflow files.
//
// The explorer renders exact YAML from this data, so the page cannot drift
// from the repository without the test suite noticing: a hash over every
// tracked file is embedded next to the parsed structure.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseYaml } from "../src/yaml.js";
import { WORKFLOWS, EXAMPLES } from "../src/catalog.js";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
const DATA_PATH = join(ROOT, "demo", "data.js");

function trackedFiles() {
  const files = [];
  const push = (relativePath) => files.push({ path: relativePath, content: readFileSync(join(ROOT, relativePath), "utf8") });
  for (const workflow of WORKFLOWS) push(`.github/workflows/${workflow.file}`);
  for (const example of EXAMPLES) push(`examples/${example.dir}/${example.file}`);
  for (const doc of ["workflows", "permissions", "pinning"]) push(`docs/${doc}.md`);
  push("README.md");
  push("src/catalog.js");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function sourceHash(files = trackedFiles()) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path).update("\0").update(file.content).update("\0");
  return hash.digest("hex");
}

const triggersOf = (on) => {
  if (!on) return [];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === "string") return [on];
  return Object.keys(on);
};

function actionReference(uses) {
  if (!uses) return { uses: "", repository: "", pin: "", pinned: false };
  if (uses.startsWith("./")) return { uses, repository: "local", pin: "local", pinned: true };
  const [repository, pin] = uses.split("@");
  return { uses, repository, pin: pin || "", pinned: /^[0-9a-f]{40}$/.test(pin || "") };
}

function workflowData(meta) {
  const relativePath = `.github/workflows/${meta.file}`;
  const source = readFileSync(join(ROOT, relativePath), "utf8");
  const document = parseYaml(source);
  const call = document.on?.workflow_call || {};
  const inputs = Object.entries(call.inputs || {}).map(([name, input]) => ({
    name,
    type: input.type || "string",
    required: input.required === true,
    default: input.default !== undefined ? String(input.default) : null,
    description: input.description || "",
  }));
  const secrets = Object.entries(call.secrets || {}).map(([name, secret]) => ({
    name,
    required: secret.required === true,
    description: secret.description || "",
  }));
  const jobs = Object.entries(document.jobs || {}).map(([id, job]) => {
    const steps = (Array.isArray(job.steps) ? job.steps : []).map((step) => ({
      name: step.name || "",
      uses: step.uses || "",
      run: typeof step.run === "string" ? step.run.split("\n")[0] : "",
      action: step.uses ? actionReference(step.uses) : null,
    }));
    return {
      id,
      name: job.name || id,
      runsOn: String(job["runs-on"] || ""),
      needs: Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [],
      timeout: job["timeout-minutes"] ?? null,
      permissions: job.permissions || {},
      uses: job.uses || null,
      environment: job.environment?.name || job.environment || null,
      steps,
      actionCount: steps.filter((step) => step.uses).length,
      runCount: steps.filter((step) => step.run).length,
    };
  });

  return {
    ...meta,
    file: relativePath,
    triggers: triggersOf(document.on),
    reusable: Boolean(document.on?.workflow_call),
    topPermissions: document.permissions || {},
    inputs,
    secrets,
    jobs,
    source,
    lines: source.split("\n").length,
  };
}

function exampleData(meta) {
  const relativePath = `examples/${meta.dir}/${meta.file}`;
  const source = readFileSync(join(ROOT, relativePath), "utf8");
  const document = parseYaml(source);
  const calls = Object.entries(document.jobs || {})
    .filter(([, job]) => typeof job.uses === "string")
    .map(([id, job]) => ({
      job: job.name || id,
      uses: job.uses,
      inputs: job.with || {},
      secrets: Object.keys(job.secrets || {}),
    }));
  const steps = Object.values(document.jobs || {}).flatMap((job) => (Array.isArray(job.steps) ? job.steps : []));
  return {
    ...meta,
    file: relativePath,
    triggers: triggersOf(document.on),
    permissions: document.permissions || {},
    calls,
    actions: steps.filter((step) => step.uses).map((step) => actionReference(step.uses)),
    source,
    lines: source.split("\n").length,
  };
}

function docsData() {
  return ["workflows", "permissions", "pinning"].map((name) => {
    const file = `docs/${name}.md`;
    const content = readFileSync(join(ROOT, file), "utf8");
    const lines = content.split("\n");
    const title = (content.match(/^#\s+(.+)$/m) || [])[1] || name;
    const start = lines.findIndex((line) => line.trim() && !line.startsWith("#"));
    const paragraph = [];
    for (let index = start; index < lines.length && lines[index].trim(); index++) paragraph.push(lines[index].trim());
    return { file, title, description: paragraph.join(" ") };
  });
}

export function buildData() {
  return {
    hash: sourceHash(),
    workflows: WORKFLOWS.map(workflowData),
    examples: EXAMPLES.map(exampleData),
    docs: docsData(),
  };
}

export function renderDataFile(data) {
  return `// Generated by scripts/build-data.mjs from the real workflows.
// Do not edit by hand; run \`node scripts/build-data.mjs\` after changing a workflow.

export const SOURCE_HASH = ${JSON.stringify(data.hash)};

export const PROJECT_DATA = ${JSON.stringify({
    workflows: data.workflows,
    examples: data.examples,
    docs: data.docs,
  }, null, 2)};
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SELF).href) {
  const data = buildData();
  writeFileSync(DATA_PATH, renderDataFile(data));
  console.log(`wrote demo/data.js from ${data.workflows.length} reusable workflows and ${data.examples.length} examples (hash ${data.hash.slice(0, 12)})`);
}
