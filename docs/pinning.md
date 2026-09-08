# Pinning

Third-party actions are referenced by commit SHA, not by tag:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
```

A tag is mutable. `v4` can be moved to a new commit by the action's maintainer,
by a compromised account, or by a supply-chain attacker who publishes a
malicious release between your reviews. A SHA cannot move.

## Exceptions

- Local actions (`./path`) are part of the repository and move with it.
- Reusable workflow references such as
  `arvion-technology/ci-templates/.github/workflows/reusable-node-ci.yml@v1`
  use a major tag in the examples so consumers can receive compatible fixes.
  Pin the reference to a SHA if your organisation requires review before every
  update; the validator accepts both.

## Updating

1. Read the release notes and the diff between the old and new SHA.
2. Replace the SHA in every workflow that uses it.
3. Let CI run the full matrix. A checkout or upload-artifact update can break
   path handling without touching your code.
4. Record the version in the commit message, for example
   `ci: bump actions/checkout to v4.2.2 (11bd719)`.

## Enforcement

`node scripts/validate.mjs` walks every `uses:` reference and fails when a
third-party action is not a 40-character commit SHA. `npm test` covers the
validator itself, so a workflow that pins by tag cannot merge quietly.

## Additions that need a second look

- `docker://` actions pull a mutable image tag; pin the digest if you use one.
- Composite actions from a subdirectory (`owner/repo/path@sha`) are allowed by
  the validator as long as the SHA is present; review what the subdirectory
  actually runs.
- `actions/github-script` executes inline JavaScript with the workflow token.
  Prefer a small committed script with explicit inputs when the logic is more
  than a few lines.
