# Real-browser acceptance checks

Finding F9 (evidence must be reproducible, not a scratchpad artefact):
these scripts drive the actual compiled app in a real, headless, disposable
Chrome instance over the DevTools Protocol -- no Playwright/Puppeteer
dependency, no visible browser window, no touch to the machine's real
profile or history.

This is **not** part of `npm test`. It is a separate, on-demand check for
what the `node:test` unit suite explicitly cannot cover: an actually
mounted React tree, real DOM focus behaviour, and real CSS. See
`docs/project-technical-guide.md` for why that distinction matters and
which acceptance criteria specifically need it.

## What is mocked, and what is not

`mock.mjs` replaces `window.fetch` for `/api/chat` only, before any app
code runs. Every other request (fonts, etc.) passes through unmodified.
`verify.mjs` asserts the mock is installed before every send.

**The actual fail-closed guarantee (Finding U3, an independent follow-up
review corrected an earlier, inaccurate version of this paragraph):**
`cdp.mjs` intercepts every request matching `/api/chat*` at the CDP `Fetch`
layer -- outside the page's own JS entirely -- and fails it outright,
regardless of whether the JS-level mock above is installed or working. This
is what actually matters here: this app's browser side never talks to a
provider domain directly at all, it POSTs to its own same-origin
`/api/chat`, and the Next.js *server* is what would then contact a real
provider. Blocking the Gemini/OpenAI domains at the browser's own network
layer (`cdp.mjs` still also does this, via `Network.setBlockedURLs`, as an
extra backstop) cannot catch that server-side hop -- only intercepting
`/api/chat` itself, before it ever leaves the browser process, can. See
`cdp.mjs`'s own comment on `API_CHAT_PATTERN` for the full explanation, and
`verify-network-isolation.mjs` (below) for the dedicated proof.

**Zero requests ever reach a real provider from this harness.**

## Proving it: the network-isolation negative test

`verify-network-isolation.mjs` is a dedicated, standalone check that
deliberately does **not** install `mock.mjs` at all -- the point is to prove
the `Fetch`-layer interception above works even when nothing in the page's
own JS is mocking anything. It confirms both the app's own automatic
availability probe and a raw, directly-attempted `POST /api/chat` are caught
and failed before they can reach the real dev server, with no real
credentials needed or used to prove it:

```bash
node tests/browser/verify-network-isolation.mjs
```

## Running it

Requires a local Chrome install (`CHROME_PATH` env var to override the
default path) and the dev server already running:

```bash
npm run dev &
node tests/browser/verify.mjs --width 1366 --height 768
node tests/browser/verify.mjs --width 1680 --height 1050
```

Screenshots are written next to the script by default (`--out DIR` to
change that); they are evidence artefacts for a review pass, not part of
the repository's tracked history.

## Coverage

- F3: an oversized draft is refused before any request and stays editable;
  a short follow-up still sends; the 50-message conversation cap shows the
  real limit and a working "start new conversation" path.
- U1: a conversation carrying an oversized *historical* message (never a
  fresh draft) is honestly blocked from sending further at all, with the
  same notice/button treatment, and the block holds even if the Send
  button's own `disabled` attribute is bypassed.
- U2: a BAD_REQUEST failure never deletes the user's own question, and
  Retry always targets the turn that actually failed, never an earlier one.
- F5: a failure's provider attribution (banner, typing indicator, Retry's
  actual request) survives a selector change made afterwards; both
  single-configured-key setup-screen scenarios.
- F6: a fenced code line far longer than the prose word budget appears
  promptly while the stream is still open, not only once it ends.
- F8: the switch-confirmation dialog traps Tab/Shift+Tab (the reverse case
  is confirmed via the actual protocol-level `shiftKey:true` event and the
  trap's own `preventDefault()`, not just which element ends up focused --
  Finding U5 found the original check could pass for the wrong reason),
  Escape closes it and returns focus to the chip that opened it, and both a
  background provider chip AND the sidebar's own controls (a separate glass
  panel the backdrop did not originally reach -- also Finding U5) are
  shadowed by the modal backdrop while it is open.
- A light regression spot-check of F1 (corrupt storage stays untouched) and
  F2 (a truncated answer still shows its specific notice), plus a presence
  check of the approved glass panel and gold orbit.

F4 and F7 are validation/parsing findings with no distinct UI surface --
they are exercised by `tests/route.test.ts` and `tests/openai.test.ts`
against the real route/adapter instead, which is a strictly stronger check
for that layer than a browser click could be.
