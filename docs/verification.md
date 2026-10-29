# Documentation verification

Checked on 2026-10-29 against the local dfup source; this is a documentation-only
change. No application code, API behavior, tests, schema files or lockfiles were
edited. `.env.example` only gains the optional variable already read by the live
verification script.

## Acceptance checklist

| Requirement | Result |
| --- | --- |
| All real API routes, no invented operations | 10 route.ts files, 11 method/path operations documented in README and docs/api.md; handler/README/reference coverage checked programmatically. |
| All environment reads and example parity | Seven process.env variables from src/scripts/config; all seven have README rows and .env.example entries. Public vs server/script secrets are distinguished. |
| Commands exercised or limits stated | Clone, directory change, install, safe example-file copy, dev, build, production start, tests, lint and tsc were exercised. See command ledger below. |
| Mermaid parses | 15 blocks parsed with Mermaid 11: seven in README, all eight diagrams/flows in architecture.md, including the additional reload flow. The download diagram is linked from README to keep it at 450 lines. |
| Relative links and images resolve | 70 active local Markdown links/images/anchors checked after the final edits. The four missing screenshot paths are fenced TODO templates, deliberately not broken rendered image links. |
| No secrets copied | New docs/example use placeholders, synthetic test IDs and a fixture checksum. A local-config-value comparison found no copied configured values; no real credential/token is logged in these docs. |
| Constants match code | 4,194,304 bytes, five workers, three total attempts, 180,000 ms Axios timeout, and 1/2-second backoffs verified against upload.ts. Init/status have no equivalent explicit timeout. |
| Scope, missing captures and provenance reported | Listed below. No license or upstream attribution was invented. |

## Command ledger

| Command shown in README | Observed result |
| --- | --- |
| git clone --depth 1 https://github.com/saksham17-tech/dfup.git vault | Passed in a temporary directory; remote clone HEAD was 319f760. This does not assert the default branch is identical to the local checkout documented here. |
| cd vault | Passed inside that temporary clone parent. |
| npm install | Passed in the task checkout, lockfile unchanged. npm reported three audit findings (two high, one critical) and an install-script approval notice for sharp. No audit fix/dependency changes were made. |
| Copy-Item .env.example .env.local | Passed in an isolated temporary directory with a copied example; the actual configured .env.local was not overwritten. |
| npm run dev | Passed, ready on default localhost:3000; real landing/dashboard/login pages served. Stopped after capture. |
| npm run build | Passed after dev was stopped. An initial overlap with the dev check removed generated files and failed; the standalone retry passed. Documented that dev/build must not share .next concurrently. |
| npm start | Passed against the successful build, ready on default localhost:3000; stopped after verification. |
| npm test | Passed: 67 tests across four files. Expected fixture errors are intentionally logged by failure-path tests. |
| npm run lint | Passed: custom TypeScript AST rules over 45 source files; not ESLint. |
| npx tsc --noEmit | Passed. |

Runtime used: Node 24.22.1 and npm 11.19.1. Temporary Mermaid/jsdom tools were
installed outside the repo, not added to package.json or package-lock.json.
Representative status/completion JSON in docs/api.md was obtained by executing
the real handlers with isolated database/Storage fixtures. Destructive API examples,
SQL editor operations and the authenticated live verifier were not run on live
uploads; they are labelled templates/prerequisite-dependent, not successful live
checks. Fresh-project provisioning and Google/email provider configuration were
not verified externally.

For the opt-in live verifier, the command is
`node scripts/verify-court-live.cjs --run-live`. It requires a configured server at
`http://127.0.0.1:3001`, verified schema/Storage, and UPLOAD_TEST_ACCESS_TOKEN
exported into the shell. It creates and removes its own synthetic upload. This
command was **not run**: no authenticated live-test session was available.

## Continuation checks

The continuation first ran `git status --short` and `git diff --stat`: only
README.md, .env.example and docs/** were modified/new. Process and listener
inspection confirmed zero matching Next/repo Node processes and zero listeners
on ports 3000/3001; no development/build overlap remained.

The .env.example diff is exactly three added lines for the optional live-test
token and its handling comments. The final architecture download note is
`Check total bytes and omit Range support`; its diagram parses successfully.
Architecture is a new untracked file, so Git has no tracked previous revision
for a standalone one-line delta.

Real command checks after the final documentation edits:

- Recursively enumerated route.ts files and exported methods; all 11 operations
  occur in both API tables. Neither table contains an invented operation.
- Searched `process.env` and `NEXT_PUBLIC_` in src, scripts and next.config.mjs;
  all seven environment reads have README rows and .env.example entries.
- Ran a filesystem/heading validator on active relative links and image paths in
  README and all new Markdown references, including media/README.md: 70 passed.
- Searched TODO/FIXME/TBD: outstanding work concerns only the four authenticated
  screenshots below; example credentials and request templates are labelled.
- Re-ran Mermaid 11 parsing: all 15 blocks passed after the architecture edit.
- Extracted README commands and matched them to the completed command ledger
  above. Finished install/build/test checks were not repeated on continuation.
- Rechecked upload constants, compared documentation against configured local
  values without printing them (zero copied values), and ran `git diff --check`.
- Confirmed no changes under src, tests, scripts, supabase, package.json or the
  lockfile. No reference SQL was added as an executable migration.

## Screenshots

Captured [landing.png](media/landing.png) from the unmodified local app. The
/dashboard?view=upload visit redirected to login, so these four captures still need
an authenticated session and synthetic test data:

1. `docs/media/upload-in-progress.png`: court, up to five hovering/ringed balls,
   actual saved/scoring work and compact upload status.
2. `docs/media/upload-paused.png`: paused same upload, Resume/Cancel, no unsaved hovers.
3. `docs/media/my-files.png`: completed synthetic file, list and quota.
4. `docs/media/bin.png`: that synthetic file in Bin with Restore/delete controls.

[Media checklist and Markdown templates](media/README.md) document exact captures.
No generated, mock or historical-review image was substituted.

## Unresolved repository/setup facts

- The supplied SQL adds columns/indexes only; it does not create files/file_chunks.
  Original base column types, defaults, keys, enum/check constraints and RLS policies
  are absent. A fresh Supabase setup cannot be reproduced from these SQL files
  alone. The [database reference](database.md) now includes proposed base-table SQL,
  clearly marked reference only, inferred and untested against live Supabase.
  It distinguishes these proposed types/constraints from verified SQL declarations.
- Init/reuse/cancel have user checks and cleanup has an operator secret. Most other
  API routes have no auth/owner check and middleware is pass-through. The docs do
  not describe client-side dashboard redirection as server-side protection.
- UI strings promise five-day Bin purging, but no scheduler/function is installed.
  The checked-in SQL comment says optional purge; documentation states the actual
  limitation. Application wording was not changed under the docs-only constraint.
- Bucket visibility, project limits, auth provider settings, hosting limits and
  multi-user deployment security were not verified from a live account. A private
  bucket is a compatible setup choice, not something provisioned/enforced by code.
- No LICENSE file or package license field exists. Git history does not prove a
  template/upstream licensing grant. Early history's NexusDrive/Kafka/gRPC/MinIO
  claims do not describe the current source.
- origin is https://github.com/saksham17-tech/dfup.git. The landing View source
  points at https://github.com/xsanchitgupta/distributed_file_upload_system instead.
  This mismatch is reported and the link is preserved; upstream provenance remains
  for the maintainer to confirm.

## Files changed or created

- [README.md](../README.md): complete, source-grounded overview and navigation.
- [.env.example](../.env.example): optional UPLOAD_TEST_ACCESS_TOKEN placeholder/comment.
- [architecture.md](architecture.md): all eight Mermaid flows and explanations.
- [api.md](api.md): all 11 methods, auth/errors, templates, fixture JSON and cleanup.
- [database.md](database.md): actual SQL additions and required-schema evidence.
- [media/README.md](media/README.md), [media/landing.png](media/landing.png): capture provenance and TODOs.
- This verification report.
