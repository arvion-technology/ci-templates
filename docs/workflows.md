# Workflows

Five reusable workflows, callable from any repository with `on: workflow_call`.
Examples of a caller live in `examples/`; each is a complete workflow you can
copy into a project and adjust.

| Workflow | Inputs | Writes | What it does |
| --- | --- | --- | --- |
| [`reusable-node-ci.yml`](../.github/workflows/reusable-node-ci.yml) | `node-versions`, `working-directory`, `package-manager`, `coverage-threshold` | none | `npm ci`, tests, optional coverage gate across a Node matrix |
| [`reusable-python-ci.yml`](../.github/workflows/reusable-python-ci.yml) | `python-versions`, `working-directory`, `run-lint` | none | Ruff and pytest with coverage across a Python matrix |
| [`reusable-docker-release.yml`](../.github/workflows/reusable-docker-release.yml) | `image-name`, `push`, `platforms`, `build-args`, `trivy-severity` | `packages`, `id-token`, `security-events` | Build with provenance and SBOM, Trivy scan, SARIF upload, cosign signature |
| [`reusable-security-scan.yml`](../.github/workflows/reusable-security-scan.yml) | `languages` | `security-events`, `pull-requests` | CodeQL with security-and-quality queries; dependency review on PRs |
| [`reusable-pages.yml`](../.github/workflows/reusable-pages.yml) | `artifact-name`, `environment-name` | `pages`, `id-token` | Deploy a Pages artifact produced by the caller |

## Calling them

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  node:
    uses: arvion-technology/ci-templates/.github/workflows/reusable-node-ci.yml@v1
    with:
      node-versions: '["20", "22"]'
      coverage-threshold: 80
```

The reusable workflow owns its job permissions. The calling workflow grants
`contents: read` and nothing else; the called workflow cannot exceed the caller's
token, so the release workflow will fail rather than silently lose its package
permission if the caller tightens too far.

## Choosing between them

- A library or service with a test suite: `node-ci` or `python-ci`.
- A container image: `docker-release`, called from a tag workflow. Add
  `node-ci`/`python-ci` as a separate job in the same workflow so a red test
  blocks the push.
- Every repository: `security-scan` on pull requests and main.
- Documentation: build the artifact in the caller, then `pages`.

## Inputs that are JSON

`node-versions`, `python-versions` and `languages` are JSON arrays encoded as
strings because `workflow_call` inputs cannot be arrays. They are parsed with
`fromJSON(...)` in the matrix. An invalid value fails at workflow parse time with
a message pointing at the matrix, not halfway through a job.
