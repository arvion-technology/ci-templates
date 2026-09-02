// CI Templates demo application.
//
// PROJECT_DATA is generated from the real workflow files. The explorer renders
// the exact YAML, the parsed inputs/jobs and a permissions matrix.
import { PROJECT_DATA, SOURCE_HASH } from "./data.js";

const { el, $, $$, fmt } = A;

const state = {
  view: "workflow",
  workflowId: "node-ci",
  exampleId: "example-node",
  tab: "overview",
};

const currentWorkflow = () => PROJECT_DATA.workflows.find((workflow) => workflow.id === state.workflowId) || PROJECT_DATA.workflows[0];
const currentExample = () => PROJECT_DATA.examples.find((example) => example.id === state.exampleId) || PROJECT_DATA.examples[0];

const escapeHtml = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const YAML_TOKEN = /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\b(?:true|false|null)\b|\b\d+\b|^[ ]*[A-Za-z0-9_.-]+(?=:))/g;

function highlightYamlLine(line) {
  if (line.trimStart().startsWith("#")) return `<span class="tok-com">${escapeHtml(line)}</span>`;
  let html = "";
  let last = 0;
  for (const match of line.matchAll(YAML_TOKEN)) {
    html += escapeHtml(line.slice(last, match.index));
    const token = match[0];
    const kind = token.startsWith("#") ? "tok-com"
      : /^["']/.test(token) ? "tok-str"
        : /^[\d]/.test(token) || ["true", "false", "null"].includes(token) ? "tok-num" : "tok-key";
    html += `<span class="${kind}">${escapeHtml(token)}</span>`;
    last = match.index + token.length;
  }
  return html + escapeHtml(line.slice(last));
}

function yamlView(source) {
  const lines = source.split("\n");
  return el("div", { class: "yaml-view" }, ...lines.map((line, index) =>
    el("div", { class: "code-line" },
      el("span", { class: "ln", text: String(index + 1) }),
      el("span", { class: "lc", html: highlightYamlLine(line) }))));
}

/* -------------------------------------------------------------- sidebars */

function renderWorkflowList() {
  $("#workflow-count").textContent = String(PROJECT_DATA.workflows.length);
  $("#workflow-list").replaceChildren(...PROJECT_DATA.workflows.map((workflow) =>
    el("button", {
      class: "picker-item" + (state.view === "workflow" && workflow.id === state.workflowId ? " active" : ""),
      onclick: () => selectWorkflow(workflow.id),
    },
    el("span", {},
      el("span", { class: "picker-name", text: workflow.name }),
      el("span", { class: "picker-key", text: workflow.file.replace(".github/workflows/", "") })),
    el("span", { class: "picker-count", text: `${workflow.jobs.length}j` }))));
}

function renderExampleList() {
  $("#example-list").replaceChildren(...PROJECT_DATA.examples.map((example) =>
    el("button", {
      class: "picker-item" + (state.view === "example" && example.id === state.exampleId ? " active" : ""),
      onclick: () => selectExample(example.id),
    },
    el("span", {},
      el("span", { class: "picker-name", text: example.name }),
      el("span", { class: "picker-key", text: example.file.split("/").pop() })),
    el("span", { class: "picker-count", text: `${example.calls.length}c` }))));
}

function renderDocs() {
  $("#doc-list").replaceChildren(...PROJECT_DATA.docs.map((doc) =>
    el("a", {
      class: "doc-link",
      href: `https://github.com/arvion-technology/ci-templates/blob/main/${doc.file}`,
      target: "_blank",
      rel: "noopener",
    },
    el("span", { text: doc.title }),
    el("span", { class: "doc-file", text: doc.file.replace("docs/", "") }))));
}

/* ----------------------------------------------------------------- detail */

function renderTabs() {
  const tabs = state.view === "workflow"
    ? [["overview", "Overview"], ["yaml", "YAML"], ["permissions", "Permissions"]]
    : [["overview", "Overview"], ["yaml", "YAML"]];
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  $("#detail-tabs").replaceChildren(...tabs.map(([id, label]) =>
    el("button", {
      class: "tab" + (state.tab === id ? " active" : ""),
      onclick: () => { state.tab = id; renderDetail(); },
    }, label)));
}

function statCard(label, value, sub) {
  return el("div", { class: "card" },
    el("div", { class: "stat" },
      el("div", { class: "stat-label", text: label }),
      el("div", { class: "stat-value", text: value }),
      el("div", { class: "small muted", text: sub })));
}

function permissionBadges(permissions) {
  const entries = Object.entries(permissions || {});
  if (!entries.length) return [el("span", { class: "badge", text: "no writes" })];
  return entries.map(([scope, access]) =>
    el("span", { class: "badge " + (access === "write" ? "gold" : ""), text: `${scope}: ${access}` }));
}

function workflowOverview(workflow) {
  const actionRefs = workflow.jobs.reduce((sum, job) => sum + job.actionCount, 0);
  const pinned = workflow.jobs.reduce((sum, job) => sum + job.steps.filter((step) => step.action && step.action.pinned).length, 0);
  const inputs = workflow.inputs.length
    ? el("div", { class: "table-scroll" }, A.dataTable({
      columns: [
        { key: "name", label: "Input", render: (row) => el("span", { class: "mono", text: row.name }) },
        { key: "type", label: "Type", render: (row) => el("span", { class: "badge", text: row.type }) },
        { key: "required", label: "Required", render: (row) => (row.required ? el("span", { class: "badge gold", text: "yes" }) : el("span", { class: "small muted", text: "no" })) },
        { key: "default", label: "Default", render: (row) => el("span", { class: "mono muted", text: row.default === null ? "—" : row.default }) },
        { key: "description", label: "Description", render: (row) => el("span", { class: "small", text: row.description }) },
      ],
      rows: workflow.inputs,
    }))
    : el("div", { class: "empty" }, el("strong", { text: "No inputs" }), "This workflow takes no configuration.");

  return el("div", {},
    el("p", { class: "purpose", text: workflow.purpose }),
    el("div", { class: "overview-grid" },
      statCard("Jobs", String(workflow.jobs.length), "sequential or parallel"),
      statCard("Action refs", `${pinned}/${actionRefs}`, "pinned to a commit SHA"),
      statCard("Steps", String(workflow.jobs.reduce((sum, job) => sum + job.steps.length, 0)), "including run steps"),
      statCard("Lines", String(workflow.lines), "of real YAML")),
    el("div", { class: "section-title" }, el("h3", { text: "Inputs" }), el("span", { class: "spacer" }), el("span", { class: "small muted", text: "workflow_call contract" })),
    inputs,
    el("div", { class: "section-title" }, el("h3", { text: "Jobs" }), el("span", { class: "spacer" }), el("span", { class: "small muted", text: "permissions are scoped per job" })),
    el("div", { class: "job-list" }, ...workflow.jobs.map((job) =>
      el("div", { class: "job-row" },
        el("div", {},
          el("div", { class: "job-name", text: job.name }),
          el("div", { class: "job-meta", text: `${job.runsOn}${job.timeout ? ` · timeout ${job.timeout}m` : ""} · ${job.steps.length} steps · ${job.actionCount} actions${job.needs.length ? ` · needs ${job.needs.join(", ")}` : ""}` })),
        el("div", { class: "job-perms" }, ...permissionBadges(job.permissions))))));
}

function workflowPermissions(workflow) {
  const scopes = new Set(Object.keys(workflow.topPermissions || {}));
  for (const job of workflow.jobs) for (const scope of Object.keys(job.permissions || {})) scopes.add(scope);
  const jobs = workflow.jobs;
  const table = el("table", { class: "permissions-table" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Scope" }),
      el("th", { text: "Workflow" }),
      ...jobs.map((job) => el("th", { text: job.name })))),
    el("tbody", {}, ...[...scopes].sort().map((scope) =>
      el("tr", {},
        el("td", { text: scope }),
        el("td", {}, permissionCell(workflow.topPermissions?.[scope])),
        ...jobs.map((job) => el("td", {}, permissionCell(job.permissions?.[scope])))))));
  return el("div", {},
    el("p", { class: "purpose" }, "The workflow token starts read-only. Write access appears only on the job that needs it; a blank cell means the scope is not requested."),
    el("div", { class: "table-scroll" }, el("div", { class: "table-wrap" }, table)),
    el("div", { class: "section-title" }, el("h3", { text: "Reusable workflow callers" })),
    el("p", { class: "small muted" }, "A caller cannot grant more than its own token holds. The examples call these workflows with contents: read at the top level and nothing else.",
      el("span", { class: "spacer" }),
      el("span", { class: "badge mono", text: `data ${SOURCE_HASH.slice(0, 10)}` })));
}

function permissionCell(value) {
  if (!value) return el("span", { class: "small muted", text: "—" });
  return el("span", { class: "badge " + (value === "write" ? "gold" : "green"), text: value });
}

function exampleOverview(example) {
  return el("div", {},
    el("p", { class: "purpose", text: example.purpose }),
    el("div", { class: "overview-grid" },
      statCard("Trigger", example.triggers.join(", "), "event names"),
      statCard("Calls", String(example.calls.length), "reusable workflows"),
      statCard("Permissions", Object.entries(example.permissions || {}).map(([scope, access]) => `${scope}: ${access}`).join(" ") || "none", "caller token"),
      statCard("Lines", String(example.lines), "of real YAML")),
    el("div", { class: "section-title" }, el("h3", { text: "Calls" }), el("span", { class: "spacer" }), el("span", { class: "small muted", text: "copy this file into a project" })),
    el("div", { class: "calls" }, ...example.calls.map((call) =>
      el("div", { class: "call-row" },
        el("div", { class: "job-meta", text: `job: ${call.job}` }),
        el("div", { class: "call-uses", text: call.uses }),
        el("div", { class: "call-inputs" },
          ...Object.entries(call.inputs).map(([name, value]) => el("span", { text: `${name}: ${String(value).slice(0, 40)}` })),
          ...call.secrets.map((secret) => el("span", { text: `secret ${secret}` })))))));
}

function renderDetail() {
  const workflow = currentWorkflow();
  const example = currentExample();
  if (state.view === "workflow") {
    $("#detail-title").textContent = workflow.name;
    $("#detail-sub").textContent = workflow.file;
  } else {
    $("#detail-title").textContent = example.name;
    $("#detail-sub").textContent = example.file;
  }
  renderTabs();

  let body;
  if (state.view === "workflow") {
    if (state.tab === "yaml") {
      body = el("div", {},
        el("div", { class: "code-header" },
          el("span", { class: "small muted", text: workflow.file }),
          el("span", { class: "spacer" }),
          el("span", { class: "badge green", text: "on: workflow_call" })),
        yamlView(workflow.source));
    } else if (state.tab === "permissions") body = workflowPermissions(workflow);
    else body = workflowOverview(workflow);
  } else if (state.tab === "yaml") {
    body = el("div", {},
      el("div", { class: "code-header" },
        el("span", { class: "small muted", text: example.file }),
        el("span", { class: "spacer" }),
        el("span", { class: "badge", text: example.triggers.join(", ") })),
      yamlView(example.source));
  } else body = exampleOverview(example);

  $("#detail-body").replaceChildren(body);
}

/* --------------------------------------------------------------- actions */

function selectWorkflow(id) {
  state.view = "workflow";
  state.workflowId = id;
  state.tab = "overview";
  renderWorkflowList();
  renderExampleList();
  renderDetail();
  history.replaceState(null, "", `#${id}`);
}

function selectExample(id) {
  state.view = "example";
  state.exampleId = id;
  state.tab = "overview";
  renderWorkflowList();
  renderExampleList();
  renderDetail();
  history.replaceState(null, "", `#${id}`);
}

/* ------------------------------------------------------------------ boot */

function applyHash() {
  const hash = location.hash.replace("#", "");
  if (!hash) return;
  const [base, suffix] = (() => {
    for (const ending of ["-permissions", "-yaml"]) {
      if (hash.endsWith(ending)) return [hash.slice(0, -ending.length), ending.slice(1)];
    }
    return [hash, null];
  })();
  const workflow = PROJECT_DATA.workflows.find((entry) => entry.id === base);
  if (workflow) {
    state.view = "workflow";
    state.workflowId = base;
    if (suffix) state.tab = suffix;
    return;
  }
  const example = PROJECT_DATA.examples.find((entry) => entry.id === base);
  if (example) {
    state.view = "example";
    state.exampleId = base;
    if (suffix === "yaml") state.tab = "yaml";
  }
}

function init() {
  applyHash();
  const actions = PROJECT_DATA.workflows.flatMap((workflow) => workflow.jobs.flatMap((job) => job.steps.filter((step) => step.uses).map((step) => step.action)));
  const pinned = actions.filter((action) => action.pinned).length;
  $("#pinned-badge").textContent = `${pinned} actions SHA-pinned`;
  $("#hash-badge").textContent = `data ${SOURCE_HASH.slice(0, 10)}`;
  $("#workflow-badge").textContent = `${PROJECT_DATA.workflows.length} reusable workflows`;
  $("#example-badge").textContent = `${PROJECT_DATA.examples.length} examples`;
  renderWorkflowList();
  renderExampleList();
  renderDocs();
  renderDetail();
}

init();
