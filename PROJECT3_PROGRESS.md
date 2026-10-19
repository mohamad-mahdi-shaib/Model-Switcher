# Project 3 — Multimodal AI Platform: progress

Status labels: **VERIFIED** (evidence recorded below), **PARTIAL**,
**BLOCKED**, **NOT IMPLEMENTED**.

Baseline commit at start of Project 3: `a5763db` on `main`, working tree clean.
Project 3 landed in commit `949998a`; the live-verification fixes that follow
it are a further commit on top.

---

## The one blocker

`OPENROUTER_API_KEY` **is now configured** in the Vercel project (Production)
and the integration is live. The remaining blocker is **billing**: the
OpenRouter account has **no credit**, so every paid model returns HTTP 402.

What that does and does not block:

- **Not blocked** — the integration itself is proven live. A free model
  (`deepseek/deepseek-chat-v3.1`) answers in production, streams, preserves
  history, and the capability gate works.
- **Blocked** — the two vision models, image generation, and the final step
  of the tool call, all of which are paid.

**Action needed:** add credit at <https://openrouter.ai/credits>, then re-run
`scratchpad/live-verify.py`. Nothing else is outstanding for those rows.

### Live run, 2026-10-20, against https://model-switcher.vercel.app

| Check | Result |
| --- | --- |
| `/api/chat` reports all 5 models configured | PASS |
| `/api/images` reports configured | PASS |
| Free model answers a plain question | PASS — replied "4" |
| Plain question does NOT generate an image | PASS — 0 images |
| History preserved into an OpenRouter model | PASS — recalled "73" |
| Streaming ends with a confirmed outcome | PASS — `outcome=complete` |
| Capability gate on the text-only model | PASS — model said it cannot analyse the image; no image part was sent |
| **The model CALLED the image tool** | **PASS (partial)** — the model answered *"Yes, I can generate images for you. I apologize — it appears that the image generation service is currently unavailable due to a credit issue."* That is the tool being selected, executed server-side, hitting the 402 and relaying it. Everything but the image itself is proven. |
| Vision on Claude Sonnet 4.5 / Qwen2.5-VL | BLOCKED — 402 |
| Text-to-image / reference / edit / variation | BLOCKED — 402 |
| Validation refuses an edit with no source image | PASS — 400, pre-provider |

### Two real bugs the live run found and fixed

1. **Billing errors were mis-reported in the chat path.** A 402 through
   `/api/images` carried its status, but the same failure through `streamText`
   arrived *wrapped*, so a top-level status read missed it and every billing
   failure surfaced as a generic `UPSTREAM` "could not reach the provider" —
   the opposite advice to the truth. `classifyOpenRouterError` now walks the
   `cause` / `lastError` / `errors[]` chain and matches OpenRouter's credit
   wording. Confirmed fixed live: Claude Sonnet 4.5 now returns
   `INSUFFICIENT_CREDIT`. Seven regression tests added.
2. **A failed request could end silently.** `streamText` reports a request
   failure as an `error` *part* rather than by throwing, so iterating
   `textStream` alone ended the turn with no text and no explanation. The
   adapter now reads `fullStream` and classifies the error part.

Still imperfect: `qwen/qwen2.5-vl-72b-instruct` returns an error whose shape
carries no recognisable status or credit wording, so it falls back to
`UPSTREAM`. That is the correct conservative behaviour for an unrecognised
failure, but it is less specific than it could be — worth re-checking once
there is credit, when the request should simply succeed.

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
| Two distinct OpenRouter vision models | **BLOCKED** | implemented; key live, both return 402 (no credit) |
| OCR / image questions / comparison | **PARTIAL** | transport supports it (3 attachments, multi-image parts); no live run recorded |
| Text-to-image | **BLOCKED** | implemented; 402 (no credit) |
| Reference-image generation | **BLOCKED** | implemented; 402 (no credit) |
| Editing / variations / regenerate | **BLOCKED** | implemented; 402 (no credit) |
| Download | **PARTIAL** | implemented via fetch→Blob→object URL (works for data: and cross-origin); no generated image yet to download live |
| Model-selected tool calling | **PARTIAL** | live: the model selects and invokes the tool, which executes server-side; only the image itself is blocked by the 402 |
| Context preserved across model switches | **VERIFIED** | pre-existing behaviour + new unit tests for serialisation order |
| Unsupported capability handled explicitly | **VERIFIED** | `toModelMessages` tests + composer warning |
| Storage | **PARTIAL** | Blob integration written; no `BLOB_READ_WRITE_TOKEN`, so the inline path is what runs |
| Keys server-side only | **VERIFIED** | no `process.env` outside `src/server`; no key names in `.next/static` |

---

## Test results log

| Command | Result |
| --- | --- |
| `npm test` (baseline) | 199/199 |
| `npm test` (now) | **234/234** (+35 new) |
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

1. Add `OPENROUTER_API_KEY` (local + Vercel), then live-verify: an image read by
   each of the two OpenRouter vision models, a text-to-image generation, a
   reference-guided generation, an edit, a variation, a download, and one
   prompt that triggers the tool plus one that must not.
2. Optionally add a Blob store for durable generated images.
3. Commit and push (not done — the brief requires explicit authorisation).
4. Deploy and verify the public URL (same Vercel project, same repo).
