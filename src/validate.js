// Validation for the workflow templates.
//
// GitHub will parse YAML and run the jobs, but it does not enforce this
// repository's rules: callable workflows must expose documented inputs, write
// permissions must be scoped to the one job that needs them, third-party
// actions must be pinned to a commit, and user-controlled expressions must not
// reach a shell. Those are checked here.
import { parseYaml } from "./yaml.js";
import { WORKFLOWS, EXAMPLES } from "./catalog.js";

export const REUSABLE_FILES = WORKFLOWS.map((workflow) => workflow.file);
const SHA = /^[0-9a-f]{40}$/;
const READ_ONLY_SCOPES = new Set(["actions", "checks", "contents", "metadata", "pull-requests", "security-events", "statuses"]);
const WRITE_SCOPES = new Set(["actions", "attestations", "checks", "contents", "deployments", "discussions", "id-token", "issues", "packages", "pages", "pull-requests", "security-events", "statuses"]);

/** Allowed job-level writes per workflow; everything else must be read-only. */
export const ALLOWED_WRITES = {
  "reusable-docker-release.yml": new Set(["packages", "id-token", "security-events"]),
  "reusable-security-scan.yml": new Set(["security-events", "pull-requests"]),
  "reusable-pages.yml": new Set(["pages", "id-token"]),
};

const asTriggers = (on) => {
  if (!on) return [];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === "string") return [on];
  return Object.keys(on);
};

function checkPermissions(scope, where, file, errors) {
  if (!scope) return;
  if (scope === "write-all") {
    errors.push({ path: file, message: `${where}: "write-all" permissions are not allowed` });
    return;
  }
  if (typeof scope !== "object") {
    errors.push({ path: file, message: `${where}: permissions must be a mapping of scopes` });
    return;
  }
  for (const [name, access] of Object.entries(scope)) {
    if (name === "write-all" || access === "write-all") {
      errors.push({ path: file, message: `${where}: "write-all" permissions are not allowed` });
      continue;
    }
    if (!READ_ONLY_SCOPES.has(name) && !WRITE_SCOPES.has(name)) {
      errors.push({ path: file, message: `${where}: unknown permission scope "${name}"` });
      continue;
    }
    if (access !== "read" && access !== "write" && access !== "none") {
      errors.push({ path: file, message: `${where}: permission "${name}" must be read, write or none` });
    }
    if (access === "write") {
      const allowed = ALLOWED_WRITES[file.split("/").pop()] || new Set();
      if (!allowed.has(name)) {
        errors.push({ path: file, message: `${where}: "${name}: write" is not allowed in this workflow` });
      }
    }
  }
}

function stepActions(job) {
  return (Array.isArray(job.steps) ? job.steps : []).filter((step) => step && typeof step.uses === "string").map((step) => step.uses);
}

function checkActionPins(file, uses, errors) {
  if (uses.startsWith("./")) return true;
  if (uses.includes(".github/workflows/reusable-")) {
    const reference = uses.split("@")[1] || "";
    if (SHA.test(reference) || /^v\d+(\.\d+)*$/.test(reference)) return true;
    errors.push({ path: file, message: `reusable workflow "${uses}" must be referenced by tag (v1) or commit SHA` });
    return false;
  }
  const [repository, reference] = uses.split("@");
  if (!repository || !reference || !SHA.test(reference)) {
    errors.push({ path: file, message: `action "${uses}" is not pinned to a 40-character commit SHA` });
    return false;
  }
  return true;
}

function checkUntrustedExpressions(file, job, errors) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const step of steps) {
    if (typeof step.run !== "string") continue;
    const run = step.run;
    for (const pattern of [/\$\{\{\s*github\.event\./, /\$\{\{\s*github\.head_ref/, /\$\{\{\s*github\.ref_name/]) {
      if (pattern.test(run)) {
        errors.push({ path: file, message: `run step interpolates untrusted event data; pass it through env instead` });
      }
    }
  }
}

function validateWorkflowStructure(file, document, errors, warnings, files) {
  if (!document || typeof document !== "object") {
    errors.push({ path: file, message: "workflow did not parse to an object" });
    return;
  }
  if (typeof document.name !== "string" || !document.name) errors.push({ path: file, message: "workflow needs a name" });
  const triggers = asTriggers(document.on);
  if (!triggers.length) errors.push({ path: file, message: "workflow has no triggers" });
  if (triggers.includes("pull_request_target")) errors.push({ path: file, message: "pull_request_target is not allowed: it runs with a write token on untrusted code" });

  checkPermissions(document.permissions, "workflow permissions", file, errors);
  if (!document.permissions) warnings.push({ path: file, message: "no top-level permissions block; the default token is broader than needed" });

  const reusable = /(^|\/)reusable-/.test(file);
  if (reusable) {
    const call = document.on?.workflow_call;
    if (!call) errors.push({ path: file, message: "reusable workflow must declare on.workflow_call" });
    const inputs = call?.inputs || {};
    for (const [name, input] of Object.entries(inputs)) {
      if (!input || typeof input !== "object") { errors.push({ path: file, message: `input "${name}" must be an object` }); continue; }
      if (!input.description) errors.push({ path: file, message: `input "${name}" has no description` });
      if (!["string", "number", "boolean"].includes(input.type)) errors.push({ path: file, message: `input "${name}" has invalid type` });
    }
    const secrets = call?.secrets || {};
    for (const [name, secret] of Object.entries(secrets)) {
      if (!secret || typeof secret !== "object") errors.push({ path: file, message: `secret "${name}" must be an object` });
    }
  }

  const jobs = document.jobs || {};
  if (!Object.keys(jobs).length) errors.push({ path: file, message: "workflow has no jobs" });
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== "object") { errors.push({ path: file, message: `job "${jobId}" must be an object` }); continue; }
    if (job.uses) {
      // A job that calls a reusable workflow has no runs-on or steps of its own.
      if (typeof job.uses !== "string") {
        errors.push({ path: file, message: `job "${jobId}" has a malformed uses reference` });
      } else {
        checkActionPins(file, job.uses, errors);
        const target = job.uses.split("@")[0];
        const name = target.split("/.github/workflows/")[1];
        if (!REUSABLE_FILES.includes(name) || !files[`.github/workflows/${name}`]) {
          errors.push({ path: file, message: `job "${jobId}" references unknown reusable workflow ${name}` });
        }
      }
      checkPermissions(job.permissions, `job "${jobId}" permissions`, file, errors);
      continue;
    }
    if (!job["runs-on"]) errors.push({ path: file, message: `job "${jobId}" has no runs-on` });
    if (!job["timeout-minutes"]) warnings.push({ path: file, message: `job "${jobId}" has no timeout-minutes` });
    checkPermissions(job.permissions, `job "${jobId}" permissions`, file, errors);
    checkUntrustedExpressions(file, job, errors);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    if (!steps.length) errors.push({ path: file, message: `job "${jobId}" has no steps` });
    for (const step of steps) {
      if (!step || typeof step !== "object") { errors.push({ path: file, message: `job "${jobId}" has a malformed step` }); continue; }
      if (!step.uses && !step.run) errors.push({ path: file, message: `job "${jobId}" has a step with neither uses nor run` });
      if (typeof step.uses === "string") {
        checkActionPins(file, step.uses, errors);
        if (step.uses.startsWith("actions/checkout") && !(step.with && step.with["persist-credentials"] === false)) {
          warnings.push({ path: file, message: `job "${jobId}": checkout should set persist-credentials: false` });
        }
      }
    }
  }
}

/** Validate `files` keyed by repository-relative path. */
export function validateTemplates(files) {
  const errors = [];
  const warnings = [];
  const stats = { workflows: 0, examples: 0, jobs: 0, steps: 0, actions: 0, pinnedActions: 0, reusableRefs: 0, checks: 0 };

  const required = [
    "README.md",
    "docs/workflows.md",
    "docs/permissions.md",
    "docs/pinning.md",
    "scripts/validate.mjs",
    ...REUSABLE_FILES.map((file) => `.github/workflows/${file}`),
    ...EXAMPLES.map((example) => `examples/${example.dir}/${example.file}`),
  ];
  for (const path of required) {
    stats.checks += 1;
    if (!files[path]) errors.push({ path, message: "required file is missing" });
  }

  const workflowPaths = Object.keys(files).filter((path) => path.endsWith(".yml") && (path.startsWith(".github/workflows/") || path.includes("/.github/workflows/")));
  for (const path of workflowPaths) {
    stats.checks += 1;
    let document;
    try {
      document = parseYaml(files[path]);
    } catch (error) {
      errors.push({ path, message: `YAML: ${error.message}` });
      continue;
    }
    validateWorkflowStructure(path, document, errors, warnings, files);

    const jobs = document.jobs || {};
    for (const job of Object.values(jobs)) {
      stats.jobs += 1;
      for (const uses of [...stepActions(job), ...(job.uses ? [job.uses] : [])]) {
        stats.actions += 1;
        if (/@[0-9a-f]{40}$/.test(uses) || uses.startsWith("./")) stats.pinnedActions += 1;
        if (uses.includes(".github/workflows/reusable-")) stats.reusableRefs = (stats.reusableRefs || 0) + 1;
      }
      stats.steps += Array.isArray(job.steps) ? job.steps.length : 0;
    }

    if (path.startsWith(".github/workflows/") && /\/reusable-/.test(path)) stats.workflows += 1;
    else if (path.startsWith("examples/")) stats.examples += 1;
  }

  const ci = files[".github/workflows/ci.yml"] || "";
  if (!ci.includes("node scripts/validate.mjs")) errors.push({ path: ".github/workflows/ci.yml", message: "CI does not run scripts/validate.mjs" });
  if (!ci.includes("npm test")) errors.push({ path: ".github/workflows/ci.yml", message: "CI does not run the test suite" });

  const docker = files[".github/workflows/reusable-docker-release.yml"] || "";
  for (const expected of ["packages: write", "id-token: write", "trivy-action", "sigstore/cosign-installer"]) {
    stats.checks += 1;
    if (!docker.includes(expected)) {
      errors.push({ path: ".github/workflows/reusable-docker-release.yml", message: `missing required release safeguard "${expected}"` });
    }
  }

  for (const example of EXAMPLES) {
    const source = files[`examples/${example.dir}/${example.file}`] || "";
    if (!source.includes(".github/workflows/reusable-")) {
      errors.push({ path: `examples/${example.dir}/${example.file}`, message: "example does not call a reusable workflow" });
    }
  }

  // The two required secrets must stay explicit; blanket inheritance hides the contract.
  if (!/REGISTRY_USERNAME/.test(docker) || !/REGISTRY_PASSWORD/.test(docker)) {
    errors.push({ path: ".github/workflows/reusable-docker-release.yml", message: "registry secrets must be declared explicitly" });
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

export function formatValidation(result) {
  const lines = [];
  lines.push(`checked ${result.stats.workflows} reusable workflows, ${result.stats.examples} examples, ${result.stats.jobs} jobs`);
  lines.push(`${result.stats.pinnedActions} action references pinned to a SHA, ${result.stats.reusableRefs} reusable workflow references`);
  for (const warning of result.warnings) lines.push(`warn  ${warning.path}: ${warning.message}`);
  for (const error of result.errors) lines.push(`error ${error.path}: ${error.message}`);
  lines.push(result.ok ? "workflow checks passed" : `${result.errors.length} workflow problem(s)`);
  return lines.join("\n") + "\n";
}
