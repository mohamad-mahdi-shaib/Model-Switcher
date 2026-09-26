# Numbase Model-Switcher — independent code review

**Reviewed:** 21 September 2026  
**Snapshot identified by the supplied baseline:** `5ee5f23edc99dbaf99757d3a3d4f41db7c53f824`  
**Review mode:** inspection and separate test fixtures; no changes to the supplied application.

## خلاصة لصاحب المشروع

الميزات الأساسية المطلوبة موجودة، والتثبيت والـbuild والـlint والاختبارات الـ85 نجحوا عندي من الـZIP. لكن اكتشفت أخطاء فعلية لم يذكرها تقرير كلود، أهمها احتمال ضياع المحادثات عند امتلاء التخزين، أو الكتابة فوق بيانات تعذّر قراءتها. كذلك الرد المقطوع قد يظهر كمكتمل، ورسالة طويلة جداً قد تمنع متابعة المحادثة.

توصيتي: نصحّح هذه الحالات ونحدّث التقرير قبل التسليم. لا نحتاج إعادة التصميم أو تغيير الزجاج والحركة المقبولة. الـPDF لا يفرض GitHub أو ZIP أو إيميل؛ التسليم برابط GitHub وZIP هو اختيارنا. لم أغيّر أي مفتاح، ولم أرسل أي طلب إلى مزود ذكاء اصطناعي.

## 1. Verdict and evidence boundaries

**Hold this snapshot for a bounded correctness pass before submission.** The main blocker I found is a reproducible history-loss defect, not a missing visual feature. Passing the existing tests does not cover the failing paths described below.

The core design, two-provider architecture, warning before switching, welcome state, normal history restoration, and transmission of earlier context are implemented. This is not a request to rebuild the project. Preserve the approved glass, backgrounds and motion timings.

I read both pages of the supplied company PDF, inspected the source, ran the shipped checks, and exercised actual source modules with separate, offline fixtures. I formed the primary findings before reading the detailed findings section of Claude's review; its summary was already present in the conversation.

| Check performed here | Result and limit |
| --- | --- |
| ZIP integrity | SHA-256 matches the supplied baseline: `addf8a667f5301fba920f5be12582a189cf277e98e1debf4a73d2a21dafd81a8`; 1,867,917 bytes; 77 entries; 63 files. No unsafe paths or symlink entries found. |
| Source preservation | All 63 extracted source files remain byte-identical to the original ZIP. Dependencies and generated build files were placed in a separate runtime copy. |
| Fresh dependency install | `npm ci --ignore-scripts --no-audit --no-fund`: success, 402 packages. No lockfile changes to the source. This specifically verifies an install with dependency lifecycle scripts disabled. |
| Runtime | Linux, Node 24.19.0, npm 11.9.0; not the owner's Windows machine. |
| Existing tests | `npm test`: **85 passed, 0 failed**. |
| Static checks | `npm run lint`: exit 0. `npm run build`: exit 0, including TypeScript checking. |
| Production startup | `next start` served `/` with HTTP 200 and the correct title. `GET /api/chat` correctly reported both providers unconfigured with their default model IDs. No real keys were present. |
| Additional inspection probes | 29 recorded observations in two scripts; these include defect reproductions and positive controls, **not 29 passing acceptance tests**. Actual hooks/components used React's test renderer; actual adapters used intercepted transport. |
| Gemini transport | Exercised the real Gemini adapter **and installed Google SDK** against fake HTTP/SSE output. Verified all seven history roles and text normalization. |
| OpenAI transport | Shipped tests plus additional actual-adapter/route probes, using fake SSE and HTTP failures. |
| Live provider calls | **Zero.** Fixtures used non-credential placeholders; their fetch handlers did not fall through to real networking. Package installation and public documentation lookup are separate from model requests. |
| Fresh visual inspection | **Not performed.** The available cloud browser rejected the local application URL with `ERR_BLOCKED_BY_CLIENT`. React test-renderer checks are not DOM, layout, contrast, animation-smoothness or keyboard-focus measurements. |
| Secret scan | No real-key-shaped matches in the 63 source files; `.env.local` is absent; `.env.example` has empty key placeholders. Environment values are read only in server adapters. |
| Git history and Windows state | **Not available in the ZIP.** I cannot independently verify its claimed HEAD, Git history, Windows `.env.local`, or historical live-request logs. The archive hash does match the supplied baseline. |

The separate `model-switcher-review-evidence.zip` contains the reproduction scripts, their JSON observations, and install/test/build logs. It contains no credentials or application fixes.

## 2. Confirmed findings, ordered by importance

### F1 — High: history can be overwritten after a failed restore

**Locations:** `src/lib/use-conversations.ts:73–85,90–118`; `src/lib/storage.ts:49–58,93–100,146–164`; `ConversationSidebar.tsx:24–29`.

There are two reproducible paths to the same data-loss outcome:

1. **Corrupt or future-version payload.** `loadConversations()` returns `corrupt`; the hook creates a blank draft, marks hydration complete and schedules its ordinary save. `flush()` still calls `saveConversations()`. The corrupt-state check at line 102 preserves only the warning label; it does not prevent the write. After approximately 700 ms the original bytes are replaced by `{"version":1,"conversations":[],"activeId":null}`. The UI continues to say the stored data was left untouched.
2. **Valid history at storage capacity.** Loading is gated on a write probe. If the extra probe key exceeds quota, the code does not read the existing, readable history. It creates a blank draft; replacing the larger existing history with a small empty payload can then succeed. In a quota-limited storage fixture, the real hook restored zero conversations, replaced valid history with the empty payload, and eventually reported `ok`.

**Evidence:** `audit-probes.json`: both `corrupt/future storage after hydration` observations and `valid history at storage capacity`. Tests used the actual React hook, not a duplicate implementation. The existing storage tests check a standalone read and stop before the hook's later write.

**Required correction:** separate read capability from write capability; read existing data even if additional writes are unavailable. Block all automatic writes after an unrecognized/corrupt/failed read until recovery or reset is explicitly selected. Preserve recoverable bytes. Also move the `window.localStorage` property access in `saveConversations()` inside its exception boundary: a throwing getter currently escapes as `SecurityError`.

**Acceptance:** mount the actual hook with corrupt JSON, version 99, and a valid payload at quota. Advance beyond the save throttle and trigger visibility/unmount flushes. Corrupt/unknown bytes must remain identical; valid existing history must be restored even when writes are full. A blocked storage getter must produce a warning without crashing.

### F2 — Medium: incomplete and broken streams have incorrect completion states

**Locations:** `openai.ts:284–324`; `gemini.ts:161–183`; `route.ts:127–152`; `use-conversations.ts:187–197,226–315`; `MessageList.tsx:123,163–165`.

This is broader than the single OpenAI token-cap issue in Claude's report:

- `response.incomplete` returns normally. The route emits `done`, and the client labels a partial answer `complete`.
- If an OpenAI stream ends without any terminal event, the adapter also returns normally. A delta followed by EOF produced the same `delta` + `done` wire output in my fixture.
- The client ignores `done` as a completion condition: a client-side NDJSON stream containing a delta and then EOF becomes `complete` even without `done`.
- A mid-stream error keeps received text but leaves its stored state at `streaming`. My fixture produced `status: error`, `error: NETWORK`, and a partial assistant message still marked `streaming`, with no interrupted notice until a later reload normalizes it.
- The Gemini adapter ignores `finishReason`. An actual-SDK fixture with `MAX_TOKENS` likewise produced `done` without a truncation indication.

**Evidence:** `audit-probes.json` entries for incomplete/EOF/mid-stream errors; `edge-probes.json` entry `Gemini MAX_TOKENS through route`.

**Required correction:** preserve an explicit terminal outcome through adapter → route → client → storage. Normal completion, provider truncation, user Stop, and premature EOF must not be conflated. Keep already received text and disclose that it is partial. Do not auto-retry a partly delivered answer as though nothing had been sent.

**Acceptance:** terminal-complete, token-limited, premature-EOF, explicit mid-stream error and Stop fixtures for both adapters. Only normal completion becomes `complete`; every other applicable path keeps text and an accurate settled partial state, including after reload. Copy continues to use the received content.

OpenAI documents a separate [`response.incomplete` event](https://developers.openai.com/api/reference/resources/responses/streaming-events). Google documents distinct [finish reasons including `MAX_TOKENS`](https://ai.google.dev/api/generate-content#FinishReason). These support preserving the distinction; they do not prove the current account's live behavior.

### F3 — Medium: one oversized message can make a conversation unusable

**Locations:** `MessageComposer.tsx:56–86`; `use-conversations.ts:323–352`; `route.ts:21–22,80–91`; `chat.ts:99`.

The composer has no input-length guard. `send()` saves the prompt into history before the server rejects messages over 16,000 characters. Subsequent sends include the rejected oversized prompt again, so even a new short question fails.

**Reproduced:** send 16,001 characters, then `hello`. Request history lengths were `[16001]` and `[16001,5]`; both returned `BAD_REQUEST`. The generic UI advice to rephrase cannot resolve this because the offending historical message remains.

A related boundary is 50 wire messages: after 25 successful user/assistant turns, the 26th user turn contains 51 messages and is rejected. The client discards the useful `Conversation is too long` detail and shows generic rephrasing advice. Limits are reasonable; undisclosed, unrecoverable limits are the issue.

**Required correction:** share appropriate validation with the composer before appending a rejected prompt, expose a clear length/context-limit message, and offer a non-destructive way to continue in a new chat. Define behavior for an oversized model answer already in history. Do not silently discard required earlier context.

**Acceptance:** an oversized draft remains editable, does not contaminate history, and a later short question works. At the conversation cap, show an accurate limit and a working path to a new chat. The three-earlier-message context test must still pass.

### F4 — Medium: malformed requests can escape the normalized API contract

**Locations:** `route.ts:59–91`; `registry.ts:23–31`.

The request body is cast to a TypeScript type without validating that it is an object. Message entries are dereferenced without checking for `null`. The provider registry is a plain object indexed without an own-property check.

**Reproduced with the actual POST handler:**

| Input | Observed result |
| --- | --- |
| JSON `null` | `TypeError` reading `provider` |
| `{provider:"gpt", messages:[null]}` with a placeholder configured key | `TypeError` reading `role` |
| Provider `__proto__` or `constructor` | An inherited property is treated as an adapter; `provider.availability is not a function` |

These are unhandled failures rather than the promised JSON error contract. No upstream requests were needed. This is an input-validation defect; I did not find or demonstrate arbitrary code execution.

**Required correction:** validate body and each message as non-null objects with allowed fields/values; enforce non-empty user content; use `Map`, a null-prototype registry, or an own-property check. Return a deliberate normalized 400/403 response for invalid input.

**Acceptance:** null, arrays/primitives, null messages, blank prompts, wrong roles, unknown providers and inherited property names all return documented errors and cause zero adapter calls.

### F5 — Medium: errors and retry indicators can name the wrong provider

**Locations:** `use-conversations.ts:51–53,170,364–380,461–483`; `WorkspaceLayout.tsx:141–151`; `MessageList.tsx:225–245,248–265,281–343,448–465`.

Retry correctly pins the original provider internally, but that provider is not exposed to the display. `ErrorRow` and the responding indicator use the currently selected provider instead.

**Reproduced:** a Gemini `INVALID_KEY` failure followed by changing selection to GPT changes the text to **GPT rejected that API key**. Clicking Retry still sends to Gemini. Separately, a GPT throttle with `retryAfterSeconds` renders **Google asks to retry** and the Google usage URL. `SetupState` also hardcodes Gemini and `GEMINI_API_KEY`.

**Required correction:** expose the actual in-flight/error provider alongside state, use it for the banner and retry indicator, and render quota/setup details according to that provider. Keep the existing retry pinning and saved answer identities.

**Acceptance:** fail on each provider, switch selection, retry; request destination, responding label, error text and setup/quota help must agree. A GPT throttle must not direct the user to Google.

### F6 — Medium: code reveal can stall until the upstream stream ends

**Locations:** `reveal.ts:125–159`; `use-reveal.ts:112–139`.

For a fenced code line longer than the word budget, `nextBoundary()` stops after three words and then snaps backward to the preceding newline, which is exactly `from`. Subsequent ticks repeat that decision even though the next complete code line is already buffered.

**Reproduced:** with a complete multi-word JavaScript line buffered while `streaming:true`, the real hook showed only the opening fence at both 380 ms and 1,580 ms, with 93 characters queued. It resumed once streaming changed to false. After completion, the line-snap branch is skipped, so code can then appear in partial lines despite the documented line-at-a-time behavior.

**Required correction:** for fenced code, reveal through the next available complete line instead of repeatedly backing up to the same offset. Wait only if the line really is incomplete. Preserve the approved prose pacing and gold orbit.

**Acceptance:** a complete long code line appears while upstream is still open; later lines preserve order and exact text. Partial lines wait appropriately, and Copy returns the full received block. Do not change the approved 350/900 ms prose pairing to fix this.

### F7 — Low: the OpenAI SSE parser only accepts LF delimiters

**Location:** `openai.ts:141–180`.

A valid CRLF-delimited SSE fixture yielded zero events because parsing searches only for `\n\n`. Multi-line `data:` fields are also parsed separately instead of being combined into one event. The prior live LF stream can work despite this limitation; I am not claiming this caused a real failure on the owner's account.

**Correction and acceptance:** parse event lines with CRLF/LF support, preserve delimiters across chunk boundaries, and combine data fields. Add a CRLF and split-boundary fixture. The [SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream) permits CRLF, LF and CR line endings.

### F8 — Low: switch dialog keyboard behavior is incomplete

**Location:** `ChatHeader.tsx:35–66,69–74,257–264`.

The dialog declares `aria-modal=true`, focuses Confirm, and handles Escape/outside clicks. It contains no Tab cycle, background inertness, or explicit focus restoration on close. The confirmation callback also does not recheck the in-flight state. This is confirmed by source inspection; I could not reproduce keyboard traversal in a browser here.

**Acceptance:** keyboard focus stays within a modal, Cancel/Escape returns to the initiating chip, and confirmation cannot switch an already in-flight request. Preserve the visible dialog design.

### F9 — Documentation and evidence need to match the actual version

**Locations:** `docs/final-inventory.md:69,157–158,293–304`; `README.md:12,136,167–168`; supplied `independent-review.md` §§3.2,3.10,4.2,8.

- The final inventory and independent review still describe an 18 px, scaled/blurred user entrance. Actual approved CSS uses **6 px over 1,200 ms, with opacity and no scale/blur**. This is stale reporting, not a reason to change the motion.
- Claims that corrupt history remains untouched are false in the integrated application (F1).
- The assertion that Gemini cannot truncate because the app supplies no cap is not sound. Its finish reason must be considered (F2).
- README architecture says seven backgrounds; there are **eight**. Mobile is described as deferred, whereas the owner's current decision is **out of scope for this submission**.
- The repository has six test files, but none imports the orchestration hook, reveal hook, API route, or a UI component. Three adapter-contract tests exercise a local toy adapter. Gemini's actual stream method is not exercised by the shipped tests.
- Browser suites and original live-test artifacts are not in the ZIP. The reports are historical claims, not independently replayable evidence of every UI behavior.

**Correction:** add regression tests for F1–F6 using actual modules, commit the useful test harness/fixtures, and update the audit from the final code. Reference safe evidence files or give clear reproduction steps. Remove claims stronger than the evidence.

## 3. PDF requirement matrix

The PDF has no numbered R1–R16 list. These IDs are an audit breakdown for comparison. **Complete** below means implementation supported by the stated evidence, not a guarantee against all bugs. **Partial** means a concrete gap remains. Current visual quality and live service operation are identified separately.

| ID | PDF page/section and relevant wording | Classification | Status and implementation evidence | Remaining gap / concrete acceptance check |
| --- | --- | --- | --- | --- |
| R1 | p.1 §1: “looks and feels like a premium product”; §2: “Creative UI/UX” | Design goal | Complete implementation; current visual review unverified here. `globals.css:196–434,1186–1288`; `backgrounds.ts`; two glass modes/eight backgrounds. User approved the visual direction. | Review at normal zoom on the owner's desktop; all preset/mode combinations must remain readable. Do not redesign during fixes. |
| R2 | p.1 §2: “Think about how messages appear. Do they slide? Do they fade?” | Creative expectation; technique open | Partial refinement. `MessageList.tsx:53–83,111–181`; CSS `user-enter`, `reveal-run`, orbit; ordinary motion exists. | F6 for queued code; preserve approved prose timings. New messages animate; restored history does not replay. |
| R3 | p.1 §2: “How does the ‘typing indicator’ look?” | Creative expectation | Complete ordinary path. `MessageList.tsx:248–268,448–458`; three dots plus provider label. | F5 on a retry after changing selection. Label must match request destination. |
| R4 | p.1 §2: “UI change subtly when I switch between GPT-4 and Gemini” | Model identity expectation | Complete implementation. `WorkspaceLayout.tsx:88`; `MessageList.tsx:147`; CSS `1029–1099`: blue-grey versus green accents and per-answer provider identity. | Confirm subtle current-chip/avatar changes by eye; prior replies retain identity. No full-interface redesign is required. |
| R5 | p.2 §5.1: “more than just alignment. Use icons, distinct shapes, or unique typography.” | Explicit | Complete. User 13.5 px semibold plus timestamp/check; assistant bot icon and distinct sheet/Markdown. `MessageList.tsx:53–83,141–167`. | Compare one user/AI pair: distinguish them without relying only on left/right position. A user bubble is not mandatory. |
| R6 | p.2 §5.1: “A prominent, stylish selector.” | Explicit | Complete implementation. `ChatHeader.tsx:170–245`; Gemini/GPT radios and server-reported model label; component control checks passed. | Inspect model readout at 1366×768 and 1680×1050. I did not remeasure layout here. |
| R7 | p.2 §5.1: “Once a chat starts, lock the model or show a creative warning before switching.” | Explicit, crucial | Complete main behavior. `ChatHeader.tsx:141–154,257–267`; actual component test verified warning, Cancel and Confirm. | F8 keyboard behavior; test Escape, focus return and in-flight refusal. |
| R8 | p.2 §5.1: “Design a beautiful ‘Welcome’ screen.” | Explicit | Complete implementation. `MessageList.tsx:188–223`; three editable starter prompts. Welcome appears in actual component test. | New chat shows welcome; prompt fills composer without sending. Missing-key setup should be provider-correct (F5). |
| R9 | p.2 §5.2: “A sidebar that saves your past chats.” | Explicit | Complete ordinary behavior. `ConversationSidebar.tsx:150–234`; `use-conversations.ts:383–451`; real hook restored and selected histories in tests. | Rename/delete with confirmation, refresh and verify correct active conversation. F1 affects restoration under storage faults. |
| R10 | p.2 §5.2: “These must stay there even if I refresh the page.” | Explicit | **Partial due to F1.** Normal persistence passed: two conversations/eight active messages restored after unmount/remount. | Fix failed-read/quota handling. Validate normal and interrupted chats on real hard refresh, plus byte-preservation fixtures. |
| R11 | p.2 §5.2: “remembers what was said 3 messages ago.” | Explicit | Complete context transport. Fourth user turn sends seven messages; both actual adapters retain earlier turns; Gemini maps assistant to model correctly. | Historical live recall was reported, not repeated here. Fresh live semantics require credentials/quota; reuse safe historical evidence or do a small authorized final smoke check. |
| R12 | p.1 §3: “frontend stays clean while the backend handles the ‘heavy lifting’” | Explicit architecture goal | Complete. Client fetches only `/api/chat`; environment and vendor transport stay in `src/server/providers`. | Import/secret scan before packaging. No client vendor credential or direct model request. |
| R13 | p.2 §4: “Provider Abstraction Layer” | Architectural expectation; using an LLM is suggested | Complete structure. `types.ts:51–66`; registry; two real adapters. | F4 registry own-property guard; genuine adapter tests, not only local mock objects. |
| R14 | p.2 §6 Step 2: “Example: Every response ... should look exactly the same ... Normalization.” | Principle suggested; literal object illustrative | Partial correctness, shared structure present. `chat.ts:36–85`; provider-neutral errors and NDJSON. | F2 and F4: terminal outcomes and invalid input must keep the contract. No need to rename `role/content` to `author/text`. |
| R15 | p.1 §2 / p.2 §4: switching between GPT-4 and Gemini | Multi-provider expectation | Implemented with two real transports; live success historically reported. OpenAI tests and actual-SDK Gemini fixture passed here. | This version uses `gpt-5.6-luna`, not literal GPT-4. Disclose that clearly; do not claim an exact GPT-4 test. Model availability is not revalidated live in this audit. |
| R16 | p.2 §6 Step 3: “Never put your API keys in your code. Use a .env file.” | Explicit security rule | Complete within inspected snapshot. Empty `.env.example`; `.env*` ignored with template exception; key reads server-only. | Do not include keys in ZIP/email/repo. History scan must be performed at the real Git repository because this ZIP has no history. |

The three-earlier-message requirement concerns retained context, **not a limit of three saved chats**.

## 4. Architecture and visible-control inventory

### Architecture verified from source

- `page.tsx` renders the client `WorkspaceLayout`, which owns appearance and provider availability. Background/glass choice is React state and resets on refresh; persistence of these preferences is not a PDF requirement.
- `useConversations` owns conversation lists, active ID, request state, Stop/Retry and persistence scheduling. `storage.ts` serializes schema version 1 to browser localStorage. There is no server database, account or cross-device synchronization requirement in the brief.
- The browser sends `{provider,messages:[{role,content}]}` to `POST /api/chat`. The route validates, dispatches through a registry, retries selected pre-stream transient failures, and writes NDJSON events.
- Gemini uses the installed `@google/genai` SDK. OpenAI uses `fetch` and a custom SSE parser. Both read server-side environment variables. Provider presence is configuration, not proof a key is funded or valid.
- Canonical received text is saved independently of the slower display queue. `useReveal`/`reveal.ts` pace presentation; `markdown.ts` parses a subset to React nodes. Text is not injected as raw HTML.

### Visible controls

| Control | What the source does | Review result |
| --- | --- | --- |
| New conversation | Reuses an existing empty draft or creates one; aborts active request. | Actual hook isolation test passed. |
| History row | Selects saved transcript and aborts a prior active stream. | Actual hook restoration/selection passed. |
| Rename | Inline edit, Enter/blur commit, Escape cancel. | Source-reviewed; shipped title/grouping tests pass. |
| Delete | Inline confirmation, then remove; selects a fallback. | Source-reviewed; verify keyboard details in final browser pass. |
| Gemini/GPT chips | Availability-gated; warning after chat begins; lock while busy. | Actual component warning/Cancel/Confirm passed; F8 remains. |
| Model readout | Text supplied by the availability endpoint; checking/unavailable fallbacks. | Actual component update passed with clearly fake model IDs; default GET verified separately. |
| Change background | Opens appearance popover. | Actual component opens; eight backgrounds and two materials present. |
| Appearance choices/Close/Escape | Update local appearance state; close/refocus behavior in code. | Source-reviewed; no new pixel/contrast claim. |
| Welcome prompts | Fill composer for editing, do not send. | Source-reviewed; welcome rendered in component check. |
| Composer/Send | Enter sends, Shift+Enter newline, composing input protected; clears after accepted send. | Hook duplicate-send guard passed; F3 input guard is missing. |
| Stop | Aborts, retains received content and interruption status. | Actual hook retained `half` with `interrupted` and abort observed. |
| Retry | Reuses last user prompt and original provider. | Destination pinning passed; displayed attribution fails in F5. |
| Copy answer/code | Copies canonical received content through Clipboard API. | Source plus parser tests; fresh OS clipboard interaction not tested here. |
| Show full response | Bypasses presentation queue without changing canonical content. | Source-reviewed; queue state separately exercised. |
| Jump to latest | Scrolls end marker; normal follow depends on messages/status. | Browser acceptance still required, particularly during a long post-stream reveal. |

No Claude chip is offered. Optional CSS tokens for Claude and five unused starter SVGs remain; these are cleanup items, not missing required features.

## 5. Comparison with Claude's independent review

| Claude finding or claim | Independent conclusion |
| --- | --- |
| Keys are the only blocker; no serious code defect | **Disagree.** F1 is a reproduced data-loss bug. Several other code defects also need correction. |
| Truncated OpenAI output reads as complete | **Confirmed and expanded** to premature EOF, client terminal-state handling and Gemini finish reasons. |
| Corrupt history stays byte-intact | **Disproved in the integrated hook.** Standalone read tests miss the later overwrite. |
| Retry stays on original provider | **Confirmed for destination; incomplete for UI.** Error/typing labels can follow a different selection. |
| Dialog lacks focus trapping | **Confirmed by source.** Browser keyboard reproduction not performed here. |
| Three adapter tests exercise a toy adapter | **Confirmed.** They do not verify real Gemini cancellation/streaming. |
| Gemini context mapping has no shipped automated coverage | **Confirmed gap in the repo.** Added external review probe exercised the real adapter + SDK and verified mapping, without consuming quota. |
| The archive has not been installed cleanly | **Closed in this review**, subject to the stated lifecycle-scripts-disabled install. Build, test and production startup succeeded. |
| Normalized field names need separate approval because the PDF did not approve them | **Not a requirement gap.** The PDF explicitly says “Example” in a section of tips. Shared semantics matter; literal names are not mandated. |
| GPT-4 wording versus current GPT model | **Disclose the difference**, as already chosen by the owner. The document names GPT-4 but supplies no exact API ID or approval process. Do not silently substitute models or claim to have tested GPT-4. |
| Live error paths need to be provoked before confidence is possible | **Do not treat this as a submission blocker.** Controlled fixtures against actual production modules are appropriate for quota, invalid-key and outage cases. They do not establish live account health, which is a separate check. No deliberate billing exhaustion is needed. |
| GitHub is not a required delivery method | **Confirmed from both PDF pages.** |

The keys previously pasted in chat remain a known operational exposure, but the owner has explicitly chosen to keep them for now. This review neither changes them nor invents a new approval gate. That exposure is distinct from the inspected ZIP: the ZIP has no credential file or detected real keys. Do not include credentials when emailing or publishing it.

## 6. Submission and remaining work

### What the PDF says about delivery

The only GitHub wording is p.2 §6 Step 3: **“If we see a key on GitHub, it's a security breach!”** This is a security warning, not an instruction to create a repository.

No ZIP, email submission, public deployment, mobile version or deadline is specified. GitHub plus a ZIP sent by email is the owner's chosen delivery method. The reviewer should supply their own environment keys if they want live operation; the ZIP must not contain the owner's `.env.local`.

### Recommended bounded correction sequence

1. **Protect persistence (F1).** Highest priority because it can delete saved chats. Add integration regression tests before editing the behavior.
2. **Fix completion and input boundaries (F2–F4).** Preserve partial text, distinguish terminal outcomes, prevent poisoned history, normalize invalid requests.
3. **Fix provider-aware feedback and code reveal (F5–F6).** Keep all approved visual styling and timing values intact.
4. **Finish small robustness/accessibility items (F7–F8)** while touching those components; do not turn this into a redesign.
5. **Update evidence and delivery docs (F9).** Ship meaningful tests, accurate feature counts/timings and an honest statement of live versus simulated evidence. Then build a new ZIP from the corrected commit and record its hash.

### Final acceptance on the owner's desktop

Use synthetic streams for repeatable checks and preserve the owner's existing chats. At 1366×768 and 1680×1050:

- Create two test chats; rename one; switch, refresh and confirm complete transcripts/selected provider. Test failure/capacity storage in a disposable browser profile only.
- Verify Gemini/GPT model readout, warning, Cancel, Escape, keyboard focus and in-flight lock. Old answers keep their original identity.
- Check approved user entrance/gold orbit; slow prose reveal; a long fenced code line; Show full response; Stop; Copy; follow-to-bottom and manual scrollback.
- Exercise offline fixtures for incomplete/failed/empty responses, invalid requests, quotas and billing. All failures preserve usable history and show the correct provider.
- Confirm both glass modes and all eight backgrounds remain visually unchanged by the correctness fixes. No new aesthetic iteration is required.
- If the adapter changes materially, a very small live smoke test may be useful **only under an explicitly authorized request budget**. This review sends none; existing live evidence should be labeled historical and retained without secrets.

### Delivery checklist after corrections

- README: exact supported Node version, reproducible install/start/test steps, environment template, provider/model explanation, local-history scope and desktop-only scope.
- Requirements audit: every PDF point mapped to current files and actual evidence; no “100% bug-free” or invented completion percentage.
- Tests/evidence: useful fixtures and safe example outputs included; no personal transcripts, provider keys or raw credential-bearing logs.
- ZIP: source, lockfile, assets, tests, docs and empty `.env.example`; exclude actual environment files, dependencies, build output, browser profiles and scratch files.
- GitHub: perform the secret/history scan in the real repository before push. No push, deployment or email was performed during this review.

## 7. Additional limitations, not automatic blockers

- The lack of current browser access prevents a fresh claim about contrast, focus traversal, real scrolling, actual clipboard access and animation smoothness. Existing user approval and historical checks are useful context, not my measurements.
- Auto-follow in `MessageList.tsx:394–397` responds to `messages/status/atBottom`, while a post-stream reveal changes child state. A long queued answer needs a real-browser check that it stays in view after network completion. This is a source-based concern, not a reproduced layout finding here.
- Gemini has no explicit application output cap. This is a cost/latency policy choice, not a missing PDF requirement; do not add a cap silently during an audit. Correct finish-state handling is required either way.
- Markdown supports a deliberate subset, not all CommonMark/GFM. Tables/images/footnotes are not PDF requirements.
- No claim is made about production security for a publicly deployed, anonymous paid-model endpoint. Public hosting was not requested by the PDF or performed here.
- Tests use the actual installed React 19.2.8 and its deprecated test-renderer in a disposable harness. They establish state/prop/render-tree behavior, not layout. A maintained component/browser testing setup is preferable for the project's future regression suite.

**Conclusion:** the project is substantially implemented and the approved design can stay. Fix the reproduced persistence, stream, input and provider-feedback defects, verify the bounded acceptance cases, then generate the final delivery package.
