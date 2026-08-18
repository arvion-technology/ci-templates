// Human descriptions for the workflows, kept next to the validator so the demo
// and the docs describe the same thing.

export const WORKFLOWS = [
  {
    file: "reusable-node-ci.yml",
    id: "node-ci",
    name: "Node CI",
    purpose: "Install, test and enforce a coverage floor on a Node project across a matrix of Node versions.",
    consumers: "Node services, libraries and static sites with a build step.",
  },
  {
    file: "reusable-python-ci.yml",
    id: "python-ci",
    name: "Python CI",
    purpose: "Ruff plus pytest with coverage across a matrix of Python versions.",
    consumers: "FastAPI services, data pipelines and CLI tools.",
  },
  {
    file: "reusable-docker-release.yml",
    id: "docker-release",
    name: "Docker release",
    purpose: "Build a multi-platform image, scan it with Trivy, sign it with cosign and upload the SARIF report.",
    consumers: "Any service that ships a container image.",
  },
  {
    file: "reusable-security-scan.yml",
    id: "security-scan",
    name: "Security scan",
    purpose: "CodeQL analysis with security-and-quality queries, plus dependency review on pull requests.",
    consumers: "Every repository, called from its pull-request workflow.",
  },
  {
    file: "reusable-pages.yml",
    id: "pages",
    name: "Pages deploy",
    purpose: "Deploy an artifact produced by the caller to GitHub Pages with the minimum Pages permissions.",
    consumers: "Documentation and demo sites.",
  },
];

export const EXAMPLES = [
  {
    dir: "node-service",
    file: ".github/workflows/ci.yml",
    id: "example-node",
    name: "Node service",
    purpose: "Calls the Node CI reusable workflow with a coverage floor.",
  },
  {
    dir: "python-service",
    file: ".github/workflows/ci.yml",
    id: "example-python",
    name: "Python service",
    purpose: "Calls the Python CI reusable workflow with lint enabled.",
  },
  {
    dir: "container-release",
    file: ".github/workflows/release.yml",
    id: "example-container",
    name: "Container release",
    purpose: "Builds, scans and signs an image on a version tag.",
  },
  {
    dir: "pages-site",
    file: ".github/workflows/deploy.yml",
    id: "example-pages",
    name: "Pages site",
    purpose: "Builds an artifact, then hands it to the Pages deploy workflow.",
  },
];

export const workflowById = (id) => WORKFLOWS.find((workflow) => workflow.id === id) || WORKFLOWS[0];
export const exampleById = (id) => EXAMPLES.find((example) => example.id === id) || EXAMPLES[0];
