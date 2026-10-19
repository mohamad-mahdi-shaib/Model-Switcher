# Project 3 — Multimodal AI Platform: progress

Status labels: **VERIFIED** (evidence recorded below), **PARTIAL**,
**BLOCKED**, **NOT IMPLEMENTED**.

Baseline commit at start of Project 3: `a5763db` on `main`, working tree clean.
All Project 3 work is currently **uncommitted** in the working tree.

---

## The one blocker

**`OPENROUTER_API_KEY` is not configured** — not in `.env.local` (which holds
`GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`) and not in the Vercel
project (which holds `GEMINI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_MODEL`).

Everything that depends on OpenRouter is **implemented and unit-tested but not
live-verified**: the two OpenRouter vision models, image generation, and the
model-selected tool call. No mock stands in for any of it, and nothing that
has not actually run against a provider is labelled VERIFIED.

**Action needed:** create a key at <https://openrouter.ai/keys>, add credit,
then add `OPENROUTER_API_KEY` to `.env.local` and to the Vercel project.

---

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

## Phases 2-5 — Implementation (complete, pending live verification)

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
| `tests/openrouter.test.ts` | 14 tests: serialisation, capability gating, error mapping, catalogue integrity |
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
| Two distinct OpenRouter vision models | **BLOCKED** | implemented + catalogue-verified ids; no key to run them |
| OCR / image questions / comparison | **PARTIAL** | transport supports it (3 attachments, multi-image parts); no live run recorded |
| Text-to-image | **BLOCKED** | implemented; needs a key |
| Reference-image generation | **BLOCKED** | implemented; needs a key |
| Editing / variations / regenerate | **BLOCKED** | implemented, incl. real source-image round trip; needs a key |
| Download | **PARTIAL** | implemented via fetch→Blob→object URL (works for data: and cross-origin); no generated image yet to download live |
| Model-selected tool calling | **BLOCKED** | implemented with AI SDK `tool()` + loop guard; needs a key |
| Context preserved across model switches | **VERIFIED** | pre-existing behaviour + new unit tests for serialisation order |
| Unsupported capability handled explicitly | **VERIFIED** | `toModelMessages` tests + composer warning |
| Storage | **PARTIAL** | Blob integration written; no `BLOB_READ_WRITE_TOKEN`, so the inline path is what runs |
| Keys server-side only | **VERIFIED** | no `process.env` outside `src/server`; no key names in `.next/static` |

---

## Test results log

| Command | Result |
| --- | --- |
| `npm test` (baseline) | 199/199 |
| `npm test` (now) | **227/227** (+28 new) |
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
