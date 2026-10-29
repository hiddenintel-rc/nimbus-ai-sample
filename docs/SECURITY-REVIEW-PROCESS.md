# Security review — how to run one here

This is the **method**, not the findings. Findings go in `docs/SECURITY_REVIEW.md`, which is a
separate file and must be unreadable to git before you write a word of it (step 0).

Run this as its own session, in this directory, with nothing else in flight.

## Step 0 — protect the findings file first

This project **is** a git repository. Add to `.gitignore` before anything else:

```
# local security review notes (unresolved findings, real paths): keep off GitHub
/docs/SECURITY_REVIEW*.md
```


This is not optional and it is not last. In the 2026-10-22 pass, three projects'
review notes were sitting untracked-but-unignored, one `git add -A` from being
committed. Write the rule, confirm it with `git check-ignore -v docs/SECURITY_REVIEW.md`, and
only then start writing findings.

## Step 1 — state the scope, including what you did not look at

Open with the date, what you examined, and **"No fixes were applied"** if that is
true. Then keep a `## Not Reviewed / Out of Scope` section and actually fill it.
A review that doesn't say what it skipped reads as if it covered everything.

## Step 2 — the checks for this project

**This repository is PUBLIC on GitHub.** That dominates everything else here.

- **Treat history as published.** Any secret that was *ever* committed is public
  and needs **rotating**, not deleting — removing it from HEAD changes nothing.
  Check the whole history, not the working tree: `git log --all -p -- .env*` and a
  secret scan across all commits, not just `HEAD`.
- **`.env.local` exists in the tree.** Confirm it is ignored *and* was never
  committed. Those are two different questions.
- **Dependencies**: `npm audit`. As of 2026-10-22 it reports 5 high, all one
  `braces` cascade through `eslint-config-next`, all devDependencies, with no
  patched `braces` published — accepted, not missed. Don't run `npm audit fix
  --force`; it downgrades `eslint-config-next` and loses lint rules for the Next
  version in use. Re-check whether `braces` >3.0.3 has shipped.
- **The lockfile is public too.** Anyone can run an audit against it, so the
  honest framing is that message hygiene does not hide dependency state.
- **Server Actions** (`lib/auth-actions.ts`) — authentication surface reachable
  without a UI. Check input validation and that errors don't leak internals.
- **`next.config.ts`** — image `remotePatterns` (an open pattern is an SSRF and a
  decoder-RCE surface), response headers, CSP.
- **Container**: `Dockerfile` and `docker-compose.yml` — base image pinning,
  non-root user, which ports are published and on which interface.
- **Docs are public as well — but check *which* ones.** Only `README.md`,
  `docs/ARCHITECTURE.md` and this file are tracked; confirm with `git ls-files
  '*.md'` instead of trusting a listing of the working tree. Those three get the
  hostname, real-email and topology pass. `DEMO-GUIDE.md` (and any HTML
  version of it), `AGENTS.md`, `CLAUDE.md`, `LOCAL-NOTES.md` and
  `nimbus-mark-prompt.txt` are held back by `.git/info/exclude`, not
  `.gitignore` — and that file is per-clone and never pushed, so it guards this
  working copy only: a fresh clone, another machine, or one `git add -f` has no
  such protection. Re-check it with `git status --short --ignored` each pass,
  since a rename silently escapes its pattern. Local files shared outside git
  still need the same pass, even though git never publishes them.

## Step 3 — write findings with evidence, not verdicts

Group as `## Critical` / `## High` / `## Medium` / `## Low / Informational`. Every
finding carries **where** (file:line, image tag, file mode, version), **impact**
(what an attacker actually gets), and **fix**. A finding without a file and line
is a hunch.

Include positive findings too. "Checked X, it's correct" is what stops the next
pass re-deriving it.

## Rules learned the hard way

These each come from a real mistake made during the 2026-09-15 to 2026-10-22
passes. They cost real time; please don't re-learn them.

1. **A grep hit is not a call path.** A spoofable-looking helper was reported as a
   live rate-limit bypass; tracing the caller showed the limiter actually keyed on
   a verified identity and the helper was a dev-only fallback. Follow the call
   chain before you write the finding.
2. **Check the deployed artifact, not the source tree.** A patch was verified in
   source and in a test image while the running container stayed vulnerable for
   weeks. Then, one layer down: cached base images predated the fix, so rebuilding
   would have produced images that *looked* patched. Check the artifact, and check
   what it was built from.
3. **Re-verify; never trust a prior review.** The 2026-09-15 notes turned out wrong
   in both directions — listing things long fixed, and missing fixes nobody had
   recorded. Treat any status section, including the one you write, as a snapshot.
4. **Say what you did not verify.** Explicitly. "Not re-verified in this pass" is a
   useful sentence; silence reads as a clean bill of health.
5. **Confirm the check actually gates.** Prove a control fails closed — feed it bad
   input and assert a non-zero exit, don't just confirm the code is present.
6. **Mind exit codes through pipes.** `cmd | sed` returns sed's status, so `|| echo
   "failed"` after a pipe will not fire. This produced a wrong "test passed" line
   more than once.
7. **Never enumerate unresolved findings in a commit message, PR body or tracked
   file.** Naming a *patched* CVE is fine. Listing what is still open, and why no
   fix exists, is a roadmap for anyone skimming the repo.
8. **Scan what is staged, before committing.** `git diff --cached` for secrets, real
   paths and PII. This caught a live `/home/...` path in a docs file that every
   other check had passed.

## Step 4 — when you're done

- Leave `docs/SECURITY_REVIEW.md` gitignored. It is the only record of *why* a fix exists.
- Fix what is cheap and safe in the same session; log the rest with a severity and
  a reason for deferring. "Accepted, because X" is a valid outcome.
- If a finding is unfixable upstream, record that it was checked and why it stands.
