# Submission checklist — Numbase Model-Switcher

**Written:** 2026-09-21. **Updated:** 2026-09-22, after the F3–F9 fix pass, then again after the U1–U6 follow-up correction and the U5 second-pass correction.
**Status as of this update:** **every confirmed code defect — F1–F8, U1–U6, and the U5 second-pass correction — is now fixed** (188/188 tests, lint clean, build clean; see `docs/requirements-audit.md` and `docs/final-inventory.md` for the full record). Several items this checklist originally tracked as pending have since been **settled by the owner**, not by a code change: both API keys are being **kept, not rotated** (verified excluded from every deliverable by the secret scan run against each packaged ZIP); the model and normalization-shape substitutions are **accepted**, no further sign-off pending; final delivery is a **ZIP**, not a GitHub push — no remote has been or will be created as part of this. §§5, 8 below are kept for history (they accurately described an earlier, still-undecided state) rather than as a remaining plan. **Nothing has been committed to Git at any point** — every ZIP built so far, including the current one, packages the working tree directly (`git ls-files` plus specific untracked files), not `git archive HEAD`, since the fixes are still uncommitted; see `review-baseline-updated.txt` alongside each archive for its exact contents, size and SHA-256. **Note:** the ZIPs built so far are *review* packages — they include this project's own internal audit trail (`docs/requirements-audit.md`, `final-inventory.md`, `remaining-work-plan.md`, `model-switcher-codex-review.md`, `project-technical-guide.md`, this checklist) for independent verification. That is not the same thing as a final company-facing package, which would leave that internal `docs/` audit trail out — a separate packaging decision for the owner to make if and when wanted.

---

## 1. What the PDF actually says about delivery

Both pages of `references/Project 1_ Model-Switcher AI Interface .pdf` were read in full for this checklist. Quoting exhaustively:

| Question | Answer | Exact wording, if any |
| --- | --- | --- |
| Does the PDF require GitHub? | **No.** | The only occurrence of "GitHub" anywhere in the document is p.2 §6 Step 3: *"Never put your API keys in your code. Use a `.env` file. **If we see a key on GitHub, it's a security breach!**"* This is a security warning conditioned on a repository existing, not an instruction to create one. |
| Does the PDF require a ZIP? | **No.** | The word does not appear anywhere in the document. |
| Does the PDF require email submission? | **No.** | The word does not appear anywhere in the document. |
| Does the PDF require public deployment / hosting? | **No.** | No such wording exists on either page. |
| Does the PDF state a deadline? | **No.** | No date or deadline appears anywhere. |
| Does the PDF specify an exact model version? | **No**, but it names "GPT-4" twice. | p.1 §2: *"when I switch between **GPT-4 and Gemini**"*; p.2 §4: *"whether it's using Gemini or **GPT-4**."* Neither instance is phrased as a strict version requirement, and the document gives no API model-id string, but the wording should be disclosed against whatever model actually ships (see `final-inventory.md` R15 and `requirements-audit.md` §6). |

**Conclusion: GitHub, a ZIP, and/or email are the owner's own chosen delivery method, not something the PDF requires.** This checklist supports that chosen method without claiming the PDF mandated it. Nothing in this project should be publicly deployed unless the owner separately decides to do that — the PDF does not ask for it, and this checklist does not either.

---

## 2. Source files and local assets required in the ZIP / repository

Verified present in the tracked working tree at commit `5ee5f23` (the last archived baseline) and expected to remain present at whatever commit Milestones 1–7 land on:

- [x] Full application source: `src/app`, `src/components`, `src/lib`, `src/server`.
- [x] `public/backgrounds/` including the bundled, locally-served `luxury-salon.jpg` (never hotlinked).
- [x] `package.json` **and** `package-lock.json` (reproducible install).
- [x] Build/config files: `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`.
- [x] `tests/` — now eleven `*.test.ts` files (`chat`, `conversations`, `gemini`, `limits` (new), `markdown`, `openai`, `provider`, `reveal`, `route`, `storage`, `use-conversations`) plus `register.mjs`/`resolver.mjs`.
- [x] `tests/browser/` (new, Finding F9) — the committed real-browser acceptance harness: `cdp.mjs`, `mock.mjs`, `verify.mjs`, `README.md`. Not part of `npm test`; run on demand.
- [x] `README.md`.
- [x] `.env.example` with **empty** key placeholders and real, non-secret model defaults only.
- [x] `docs/final-inventory.md`.
- [x] `docs/requirements-audit.md`.
- [x] `docs/project-technical-guide.md` — **internal material** (see the note on `docs/` scope below); excluded from the later company-facing package unless requested.
- [x] `docs/model-switcher-codex-review.md` (this pass adds it to the tracked tree).
- [x] `docs/remaining-work-plan.md` and `docs/submission-checklist.md` (this pass adds them).
- [x] `docs/design-decisions.md`.
- [x] `.gitignore`, `AGENTS.md`, `CLAUDE.md`.
- [ ] **Decide:** `references/DESIGN.md`, `references/code.html`, `references/screen.png` are currently *tracked* (~1.4 MB total) and would ship by default. Confirm whether they belong in the deliverable or should be removed before the final archive.
- [ ] **Decide:** five unused Next.js starter SVGs (`public/{file,globe,next,vercel,window}.svg`, referenced nowhere in `src/`) — harmless but not asked for; consider removing for a cleaner deliverable (see `remaining-work-plan.md` item, low priority).

**Asset credits** already present in `README.md`: the Luxury Salon photograph is credited with its CC0 1.0 Unsplash/Wikimedia Commons source and licence.

**Internal vs. company-facing material.** `docs/project-technical-guide.md`, `docs/requirements-audit.md`, `docs/final-inventory.md`, `docs/remaining-work-plan.md`, `docs/model-switcher-codex-review.md` and this checklist are internal engineering/audit material — written for the project owner, not for the company the interface is ultimately delivered to. They stay in this repository (useful history, and nothing in them is secret), but should be **excluded from whatever package actually goes to the company** unless the owner specifically wants them included. Only `README.md` and the application source are written with an external reader in mind.

---

## 3. README, .env.example, lockfile, tests, credits

- [x] `README.md` documents: setup steps, both provider env vars, the actual configured OpenAI model and its difference from the PDF's "GPT-4" wording, architecture overview, and asset credits.
- [x] **Done.** README's "7 backgrounds" line is corrected to 8, and "mobile is deferred" now reads "mobile is out of scope for this submission" — both fixed this pass.
- [x] `.env.example` present with empty key placeholders (`GEMINI_API_KEY=`, `OPENAI_API_KEY=`) and non-secret model defaults.
- [x] `package-lock.json` committed and tracked.
- [x] Test suite present and runnable with `npm test` — **180 passing** (85 at the original audit; +15 F1, +47 F2, +33 this pass — see `remaining-work-plan.md` §5).
- [x] No personal transcripts, provider keys, or raw credential-bearing logs anywhere in the tracked tree (verified by pattern scan; see §5 below).

---

## 4. Exclusions — verified and to re-verify at final packaging

| Item | Status as of this writing |
| --- | --- |
| `.env.local` (the real keys) | **Confirmed excluded.** `.gitignore` has `.env*` with `!.env.example`; `git check-ignore` confirms ignored; `git ls-files` confirms untracked. Re-verify unchanged at final packaging. |
| Other secret-shaped files | **Confirmed absent** from all 63 tracked files this pass (pattern scan for `sk-…`, `AIza…`, `ghp_…`, and any assigned `*_KEY=`/`SECRET=`/`TOKEN=` value). |
| `node_modules/` | Excluded via `.gitignore`; `git archive` naturally excludes anything untracked. |
| `.next/` (build output) | Excluded via `.gitignore`. |
| `.git/` itself | Not included by `git archive` by construction. |
| Logs (`npm-debug.log*` etc.) | Excluded via `.gitignore`; the dev-server log used for live-evidence review lives outside the repository entirely and was never tracked. |
| Personal browser data | Never present in the repository; all UI verification for both audits and this review used throwaway Chrome profiles specifically so the owner's real saved conversations were never read or touched. |
| Temporary test artefacts | The entire CDP/fixture verification harness (both prior audits' and this review's) lives in a session scratchpad outside the repository, deliberately never committed. |

**Re-run before the final archive is built** (after Milestones 1–7 land): the exact same tracked-file pattern scan, full git-history blob scan, and client-bundle scan performed for the prior `model-switcher-review.zip` (documented in `docs/final-inventory.md` §5 evidence and repeated independently by the codex review). Report findings by file path and issue type only — never print or copy a secret value into any review artefact.

---

## 5. Existing Git remote and GitHub handoff

**As of this writing: no Git remote is configured** (`git remote -v` returns nothing). Nothing has ever been pushed anywhere. Branch is `main`, working tree is clean apart from the three untracked reference files in `references/` (the two design photos and the company PDF, which are explicitly **not** to be added to Git per the owner's instruction — the owner will provide the PDF to the recipient separately).

**This section described a possible GitHub delivery path; it is no longer the plan.** The owner has since confirmed final delivery is a ZIP, sent directly — no GitHub remote is to be created and nothing is to be pushed. Kept below for history:

1. ✅ **Done.** Complete Milestones 1–7 in `remaining-work-plan.md` and their tests.
2. ~~Rotate both API keys.~~ **Settled:** the owner has decided to keep the current keys; excluded from every deliverable, verified by the secret scan run against each packaged ZIP.
3. ✅ **Done, repeatedly.** The full secret scan is re-run against every packaged ZIP, including the current one — see `review-baseline-updated.txt`.
4–6. **Not applicable** — no GitHub remote, no push, per the owner's settled delivery choice above.

---

## 6. No deployment requirement

Confirmed in §1: the PDF does not ask for a publicly hosted, live URL anywhere. No deployment (Vercel, or otherwise) should be performed as part of this submission unless the owner explicitly requests it separately, outside what the PDF itself specifies. This project has not been deployed anywhere as of this writing, and this checklist does not include deployment steps.

---

## 7. Explicit scope statements

**Mobile is out of scope for this submission.** This is the owner's explicit decision, distinct from anything the PDF says — the PDF, read in full on both pages for this checklist, does not mention mobile, responsive layout, or any non-desktop device anywhere. Nothing in this project's remaining work should add mobile support as part of reaching submission readiness.

**GitHub, ZIP, and email are the owner's chosen delivery mechanisms, not PDF requirements.** See §1 for the full quoted basis. This checklist supports whichever of these the owner ultimately uses without claiming the PDF mandated any of them.

---

## 8. Final pre-delivery sequence

All milestones (F1–F8, U1–U6, and the U5 second-pass correction) are complete, and this sequence has since been carried out in full, repeatedly, once per fix pass — see `review-baseline-updated.txt` alongside the current archive for the latest run's exact figures.

1. ✅ `npm run lint` — clean.
2. ✅ `npm test` — **188/188** passing, including all regression tests from `remaining-work-plan.md` §5 and its addenda.
3. ✅ `npm run build` — clean.
4. ✅ Real-browser acceptance pass at 1366×768 and 1680×1050, mocked/offline only, plus a dedicated network-isolation negative test and a dedicated dual-glass-mode dialog hit-testing regression — 46/46 per viewport, 4/4, 16/16.
5. ✅ Secret scan: tracked files plus every untracked file the archive includes, re-run against each freshly built/extracted archive — zero real-key-shaped findings.
6. ~~Rotate both API keys.~~ **Settled:** kept, not rotated, per the owner's decision; excluded from every deliverable.
7. ✅ **Done, but not via `git archive HEAD`** — the fixes are still uncommitted, so `git archive HEAD` would omit them. Each archive is built from `git ls-files` (the current working-tree content) plus the specific untracked files intended for inclusion, using Python's `zipfile` (not PowerShell's `Compress-Archive`, which writes non-portable backslash entry names — Finding U6).
8. ✅ SHA-256 and size recorded in `review-baseline-updated.txt` for each build.
9. ✅ Confirmed, each time, by extracting the freshly built archive and checking it against §4's exclusions and §2–3's inclusions.
10. ~~Create the GitHub remote, push, and re-scan.~~ **Not applicable** — final delivery is a ZIP, per the owner's settled decision (see §5 above).
