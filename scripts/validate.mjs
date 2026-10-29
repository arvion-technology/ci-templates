#!/usr/bin/env node
// Validate every workflow in the repository.
//
// Structural checks always run. `actionlint` is used as an additional layer
// when it is installed, because it catches expression and shell issues that a
// generic YAML reader cannot.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateTemplates, formatValidation } from "../src/validate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = new Set([".yml", ".yaml", ".md", ".mjs", ".json"]);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", ".terraform", "fonts", "demo"].includes(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (TEXT.has(entry.name.slice(entry.name.indexOf(".")))) {
      const path = relative(ROOT, full).split("\\").join("/");
      if (!path.startsWith("docs/screenshot")) files.push({ path, content: readFileSync(full, "utf8") });
    }
  }
  return files;
}

const entries = walk(ROOT);
const files = Object.fromEntries(entries.map((entry) => [entry.path, entry.content]));
const result = validateTemplates(files);

const actionlint = spawnSync("actionlint", ["-version"], { stdio: "ignore" }).status === 0;
const lint = { available: actionlint, ok: true, output: "" };
if (actionlint) {
  const run = spawnSync("actionlint", ["-no-color"], { cwd: ROOT, encoding: "utf8" });
  lint.ok = run.status === 0;
  lint.output = ((run.stdout || "") + (run.stderr || "")).trim();
}

const ok = result.ok && lint.ok;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok, result, actionlint: lint }, null, 2));
} else {
  console.log("GitHub Actions templates");
  console.log(`actionlint: ${actionlint ? (lint.ok ? "passed" : "failed") : "not installed, skipped"}`);
  process.stdout.write(formatValidation(result));
  if (actionlint && !lint.ok) console.log(lint.output);
  if (!ok) console.log("\nworkflow validation failed");
}

process.exit(ok ? 0 : 1);
