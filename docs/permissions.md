# Permissions

The default `GITHUB_TOKEN` in a new repository is broad. Every workflow here
starts from the narrowest useful set and escalates only inside the job that
needs it.

## Policy

1. `permissions: contents: read` at the workflow level for everything that only
   reads code.
2. Write scopes are declared on the individual job, never at the top level.
3. No `write-all`, and no `pull_request_target` trigger.
4. A reusable workflow declares its own job permissions; the caller cannot
   grant more than it has, so a caller with `contents: read` cannot accidentally
   enable `packages: write` for a workflow that does not ask for it.
5. `id-token: write` is used for short-lived OIDC credentials (cosign, Pages),
   never for long-lived cloud keys stored as secrets.

## Matrix

| Workflow | contents | packages | id-token | security-events | pull-requests | pages |
| --- | --- | --- | --- | --- | --- | --- |
| node-ci | read | — | — | — | — | — |
| python-ci | read | — | — | — | — | — |
| docker-release | read | write | write | write | — | — |
| security-scan | read | — | — | write | write | — |
| pages | read (top) | — | write (job) | — | — | write (job) |

`security-scan` needs `pull-requests: write` only for the dependency-review job
to post its summary. The CodeQL job does not get it.

## What to review on a pull request

- A new `permissions:` key that adds `write`, especially at the top level.
- A change from `pull_request` to `pull_request_target`. This is almost always
  wrong and is exactly how a workflow becomes a credential-theft primitive.
- A step that passes `secrets.*` into a `run:` block. Prefer passing values
  through `env:` on the step, and remember masks do not protect transformed
  values.
- A job that calls a reusable workflow without pinning the reference.

## Fork pull requests

On `pull_request` from a fork the token is read-only and secrets are empty. The
Node and Python workflows therefore work unchanged, while `docker-release` is
not called from pull requests at all — it runs on tags, from the main
repository, where the registry secret exists.
