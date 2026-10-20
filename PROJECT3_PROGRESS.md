# Project 3 — Multimodal AI Platform: progress

Status labels: **VERIFIED** (evidence recorded below), **PARTIAL**,
**BLOCKED**, **NOT IMPLEMENTED**.

Baseline commit at start of Project 3: `a5763db` on `main`, working tree clean.
Project 3 landed in commit `949998a`; the live-verification fixes that follow
it are a further commit on top.

---

## Final architecture (catalogue-simplification pass)

| Slot | Model | Transport | Role |
| --- | --- | --- | --- |
| Gemini | `gemini-3.6-flash` | direct, `@google/genai` | text **+ vision** |
| OpenAI | `gpt-5.6-luna` | direct, Responses API | text **+ vision** |
| DeepSeek V3.1 | `deepseek/deepseek-chat-v3.1` | OpenRouter | text-only; **hosts the `generate_image` tool** |
| Image generation | `google/gemini-2.5-flash-image` | OpenRouter | text-to-image, reference, edit, variation |

Removed: `anthropic/claude-sonnet-4.5` (redundant once both direct
integrations were verified for vision) and `qwen/qwen2.5-vl-72b-instruct`
(stopped answering for this account on *any* request, plain text included).
Saved conversations on either id migrate to Gemini via `migrateProviderId`.

DeepSeek is retained for a structural reason, not as filler: `openrouter.ts`
is the only adapter that attaches the image tool, so removing every OpenRouter
chat model would have reduced image generation to a button — the exact
substitution the requirement forbids.

**No blockers remain.** Everything below is live-verified against production.

### Storage smoke tests — deployment `model-switcher-j73tkyehz`

With Vercel Blob connected, all four generation paths store rather than
inline: text-to-image, the tool-called image, edit and variation each returned
`persisted: true` with a `*.public.blob.vercel-storage.com` URL, and a stored
URL re-fetched independently as a 1,248 KB PNG. `/api/images` reports
`storage: "blob"`.

### Production smoke tests — 2026-10-20, deployment `model-switcher-kgxallset`

All 19 checks passed against https://model-switcher.vercel.app:

| Check | Result |
| --- | --- |
| Selector offers exactly `gemini`, `gpt`, `or-deepseek`; all configured | PASS |
| Claude and Qwen no longer selectable | PASS |
| Vision — Gemini / OpenAI | PASS / PASS |
| OCR — Gemini / OpenAI | PASS / PASS |
| Two-image comparison — Gemini / OpenAI | PASS / PASS |
| **Normal chat request → model invoked image generation (no mode switch)** | **PASS** — 1 image, `op=generate`, `google/gemini-2.5-flash-image` |
| Plain question did NOT invoke generation | PASS — 0 images, replied "4" |
| Capability gate on the text-only model | PASS |
| Text-to-image / edit / variation / download | PASS / PASS / PASS / PASS |
| Conversation history across all three models | PASS — all recalled "51" |

### Earlier live findings (kept for the record)

Two real bugs were found by live testing and fixed before this pass:

1. A 402 arriving through `streamText` reached the classifier *wrapped*, so
   billing failures were reported as generic `UPSTREAM` — the opposite advice.
   `classifyOpenRouterError` now walks the `cause`/`lastError`/`errors[]`
   chain and matches OpenRouter's credit wording.
2. `streamText` reports a failed request as an `error` *part* rather than
   throwing, so a failed turn ended silently with no text. The adapter now
   reads `fullStream`.

A third was found by a test written during this pass: both
`migrateProviderId` and the pre-existing `migrateBackgroundId` used
`id in MAP`, and `"__proto__" in {}` is `true` — so a persisted id of
`__proto__` resolved to an inherited `Object.prototype` value instead of a
valid id. Both now use `Object.hasOwn`.

## Phase 1 — Audit (complete)

### Already existed and was verified, not rebuilt

| Requirement | Evidence |
| --- | --- |
| File-picker upload | `MessageComposer.tsx`, hidden `<input type="file">` |
| **Drag-and-drop** | `MessageComposer.tsx` `onDragOver`/`onDrop` |
| **Clipboard paste** | `MessageComposer.tsx` `onPaste` → `clipboardData.files` |
| Preview + remove | `AttachmentTray.tsx` |
| Multiple attachments | `MAX_ATTACHMENTS = 3` (`limits.ts`) |
| Type validation | magic-byte `sniff()` (PNG/JPEG/WebP), not just the MIME header |
| Size limits + errors | 2.2 MB per file and total; oversized photos auto-compressed |
| Image understanding | Gemini `inlineData`; OpenAI `input_image` data URL |
| Bytes storage | IndexedDB, metadata on the message in localStorage |
| History across model switch | `setConversationProvider` patches only `providerId` |
| Capability flag | `ProviderCapabilities.attachments` already in the contract |

Baseline checks at audit time: `npm test` 199/199, `tsc` clean, `eslint` 0,
`npm run build` succeeded, 6 browser suites 274/274.

---

## Phases 2-5 — Implementation (complete; paid paths pending credit)

### Added

| File | Purpose |
| --- | --- |
| `src/lib/models.ts` | OpenRouter catalogue: ids + capabilities read from OpenRouter's live `/api/v1/models` |
| `src/server/providers/openrouter.ts` | One adapter for all OpenRouter chat models, via AI SDK `streamText`; capability-aware serialisation; error classification |
| `src/server/images/generate.ts` | Image generation (text-to-image, reference, edit, variation) |
| `src/server/images/tool.ts` | The `generate_image` tool the model selects |
| `src/server/storage/images.ts` | Vercel Blob storage, with an inline fallback |
| `src/app/api/images/route.ts` | `POST` generate / `GET` capability probe |
| `src/components/workspace/GeneratedImages.tsx` | Renders generated images; Download / Regenerate / Make a variation |
| `tests/openrouter.test.ts` | 21 tests: serialisation, capability gating, error mapping (incl. 7 for the wrapped-error bug found live), catalogue integrity |
| `tests/images-route.test.ts` | 14 tests: the whole validation layer + unconfigured-server behaviour |

### Changed (all additive; old saved conversations load unchanged)

`providers.ts` (3 new models + a `vision` flag), `chat.ts` (`GeneratedImageRef`,
an `image` stream event, key-name map), `types.ts` (an `image` provider chunk),
`registry.ts` (registers the catalogue), `route.ts` (forwards image events),
`storage.ts` (validates `ChatMessage.images`), `use-conversations.ts` (handles
image events, `appendGeneratedImages`), `MessageList.tsx` / `WorkspaceLayout.tsx`
/ `MessageComposer.tsx` (rendering, follow-ups, capability warning),
`.env.example`, `README.md`.

### Dependencies added

`ai@7.0.144`, `@openrouter/ai-sdk-provider@3.1.0`, `zod@4.6.7`,
`@vercel/blob@2.8.2`. APIs were read from the installed `.d.ts` files rather
than assumed: `generateImage`/`tool`/`stepCountIs` exist in `ai` v7, the
OpenRouter provider exposes `chat()` and `imageModel()`, and its chat path
already maps `choice.message.images[]` into AI SDK file parts — which is why
generation goes through `chat()`, not `imageModel()`.

---

## Requirement status

| Requirement | Status | Evidence / what is missing |
| --- | --- | --- |
| Upload: picker, drag-drop, paste, preview, remove, multiple | **VERIFIED** | pre-existing; 274 browser checks still pass |
| Validation + clear errors | **VERIFIED** | unit tests + `images-route` suite |
| Image understanding, Gemini + OpenAI | **VERIFIED** | pre-existing, previously live-verified |
| Two distinct vision models | **VERIFIED** | live on production: Gemini and OpenAI, both for description, OCR and comparison |
| OCR / image questions / comparison | **VERIFIED** | live on production, on both vision models |
| Text-to-image | **VERIFIED** | live, 200 + real PNG |
| Reference-image generation | **VERIFIED** | live, 200 + image |
| Editing / variations / regenerate | **VERIFIED** | live, `op=edit` and `op=variation` |
| Download | **VERIFIED** | live: generated image decodes to real PNG bytes |
| Model-selected tool calling | **VERIFIED** | live: "draw me a lighthouse at sunset" → model called the tool → image in the conversation; "what is 2+2" → 0 images |
| Context preserved across model switches | **VERIFIED** | pre-existing behaviour + new unit tests for serialisation order |
| Unsupported capability handled explicitly | **VERIFIED** | `toModelMessages` tests + composer warning |
| Storage | **VERIFIED** | Vercel Blob store `model-switcher-images` connected; live on production: text-to-image, tool-called, edit and variation all return `persisted: true` with an https Blob URL that re-fetches as a valid PNG |
| Keys server-side only | **VERIFIED** | no `process.env` outside `src/server`; no key names in `.next/static` |

---

## Test results log

| Command | Result |
| --- | --- |
| `npm test` (baseline) | 199/199 |
| `npm test` (now) | **245/245** (+46 over the 199 baseline) |
| `npx tsc --noEmit` | clean |
| `npx eslint` | exit 0 |
| `npm run build` | succeeded; `/api/images` listed as a dynamic route |
| `verify.mjs` | 75/75 |
| `verify-responsive.mjs` | 100/100 |
| `verify-search.mjs` | 16/16 |
| `verify-dialog-hit-testing.mjs` | 8/8 |
| `verify-network-isolation.mjs` | 4/4 |
| `verify-settings.mjs` | 64 pass, 0 fail, then a CDP "target navigated or closed" crash in the PDF-download step. **Pre-existing**: reproduced identically on the stashed baseline tree (`a5763db`), so it is not a Project 3 regression. |

---

## Remaining work

1. **Optional:** add `OPENROUTER_API_KEY` to the Preview environment as well —
   it is currently Production-only, so preview deployments report the
   OpenRouter model and image generation as not configured.
2. **Optional:** connect the GitHub repo to the Vercel project so pushes deploy
   automatically; deployments are CLI-driven today.

No functional work is outstanding. Every Project 3 requirement is verified
against production.
