// Real-browser acceptance checks for the F3-F9 pass (F2 follow-up included),
// driven against the actual compiled app -- not source inspection, not the
// node:test unit suite. Every provider response is mocked (see mock.mjs);
// Chrome itself additionally blocks the real provider domains at the network
// layer (see cdp.mjs) as a fail-closed backstop. Zero provider requests.
//
// Finding F9: committed to the repository so this pass's real-browser
// evidence is reproducible, not a one-off scratchpad artefact. Requires a
// local Chrome (see CHROME_PATH in cdp.mjs) and the dev server already
// running at BASE_URL.
//
// Usage:
//   node tests/browser/verify.mjs [--width 1366] [--height 768] [--out DIR]
//
// This is a real-browser integration check, not a node:test file -- it is
// deliberately NOT picked up by `npm test` (see tests/*.test.ts glob in
// package.json), and is run on demand instead.

import { launch, evaluate, sleep, screenshot, pressKey, clickAt } from "./cdp.mjs";
import { MOCK, SEND, TYPE, CLICK_SEND, STAGE_FILE, PNG_BYTES, assertMocked } from "./mock.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const WIDTH = Number(args.width || 1366);
const HEIGHT = Number(args.height || 768);
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT = args.out || new URL(".", import.meta.url).pathname.replace(/^\//, "");

let pass = 0;
let fail = 0;
const results = [];
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${WIDTH}x${HEIGHT}]  ${name}${detail ? "  " + detail : ""}`);
};

/**
 * `seed`, when given, is written to localStorage by an injected script that
 * runs at document-start, before the app's own React code ever mounts --
 * NOT by evaluating after the app is already running and navigating again.
 * The first version of this helper did the latter, and it raced the
 * already-running app's own `pagehide` handler: navigating away fires
 * `pagehide` on the OLD document, which flushes ITS (still-empty) in-memory
 * conversation list, overwriting the just-seeded bytes a moment before the
 * new document ever reads them. Seeding before the app boots at all removes
 * the race instead of trying to out-time it.
 */
async function open(availability, seed) {
  const page = await launch({ width: WIDTH, height: HEIGHT });
  let source = MOCK;
  if (availability) source += `window.__mock.availability = ${JSON.stringify(availability)};`;
  if (seed) {
    const raw = typeof seed === "string" ? seed : JSON.stringify(seed);
    source += `window.localStorage.setItem("model-switcher:conversations", ${JSON.stringify(raw)});`;
  }
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);
  return page;
}

/**
 * Responsive UI refinement: the provider selector is now a single dropdown
 * trigger (was two always-visible chips), so selecting a provider is a
 * two-step interaction -- open the trigger, then click the option inside
 * the listbox it reveals -- rather than one direct click on a chip. Every
 * call site that used to do `[role="radio"]... .find(...).click()` for a
 * provider now goes through this instead. `label` matches the option's
 * user-facing text exactly ("Gemini" or "OpenAI", never the old "GPT").
 *
 * The evaluated function is `async` and awaits a real paint frame between
 * the trigger click and looking for the option it reveals -- an early
 * version did both synchronously in one tick and intermittently found no
 * option at all: React's commit from the trigger's own `onClick` (which
 * calls `setState` to open the listbox) is not guaranteed to have flushed
 * to the DOM yet on the very next synchronous line of injected script.
 * `requestAnimationFrame` reliably runs after that commit has painted.
 */
async function selectProvider(page, label) {
  return evaluate(
    page,
    (labelText) =>
      new Promise((resolve) => {
        const trigger = document.querySelector('[aria-haspopup="listbox"]');
        if (!trigger) {
          resolve(false);
          return;
        }
        trigger.click();
        requestAnimationFrame(() => {
          const opt = [...document.querySelectorAll('[role="option"]')].find(
            (o) => o.querySelector(".truncate")?.textContent?.trim() === labelText,
          );
          if (!opt) {
            resolve(false);
            return;
          }
          opt.click();
          resolve(true);
        });
      }),
    label,
  );
}

function seededState(messages) {
  return {
    version: 1,
    conversations: [
      {
        id: "seed-c1",
        title: "Seeded conversation",
        providerId: "gemini",
        createdAt: Date.now() - 1000,
        updatedAt: Date.now(),
        messages,
      },
    ],
    activeId: "seed-c1",
  };
}

const composerState = () =>
  evaluate(page_, () => {
    const ta = document.querySelector("textarea");
    const notice = document.querySelector('footer [role="alert"]');
    const sendBtn = document.querySelector('[aria-label="Send message"]');
    return {
      value: ta ? ta.value : null,
      notice: notice ? notice.textContent.trim() : null,
      sendDisabled: sendBtn ? sendBtn.disabled : null,
    };
  });

const bannerText = () =>
  evaluate(page_, () => {
    const alert = document.querySelector('[role="alert"]:not(footer [role="alert"])');
    return alert ? alert.textContent.trim() : null;
  });

const typingLabel = () =>
  evaluate(page_, () => {
    const el = document.querySelector(".typing-row [role='status']");
    return el ? el.textContent.trim() : null;
  });

const lastCodeText = () =>
  evaluate(page_, () => {
    const code = document.querySelector(".assistant-content pre code, .assistant-content code");
    return code ? code.textContent : null;
  });

let page_;

/* ===================================================================== *
 * F3 -- input and conversation limits
 * ===================================================================== */
{
  const page = await open();
  page_ = page;

  // 1. An oversized draft is refused before any request, and stays editable.
  const oversized = "x".repeat(16_001);
  await page.send("Runtime.evaluate", { expression: TYPE(oversized), awaitPromise: true });
  await page.send("Runtime.evaluate", { expression: CLICK_SEND, awaitPromise: true });
  await sleep(200);
  let s = await composerState();
  log(
    s.value.length === 16_001 && /16,001|16001/.test(s.notice || "") === false && /over the/i.test(s.notice || ""),
    "F3.1 oversized draft refused, message names the overage",
    JSON.stringify(s.notice),
  );
  log(s.value === oversized, "F3.2 oversized draft remains in the composer, untouched");
  const requestsAfterOversized = await evaluate(page, () => window.__mock.requests);
  log(requestsAfterOversized === 0, "F3.3 no request was sent for the oversized draft");

  // 2. A short, unrelated follow-up still sends and succeeds normally.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("a short follow-up"), awaitPromise: true });
  await sleep(600);
  const afterShort = await composerState();
  const requestsAfterShort = await evaluate(page, () => window.__mock.requests);
  log(afterShort.value === "" && requestsAfterShort === 1, "F3.4 a short follow-up after a refusal sends normally");
  await screenshot(page, `${OUT}/f3-oversized-refused.png`);
  await page.close();
}

{
  // 3. Reaching the conversation cap shows the real limit and a working path
  // forward, instead of the generic BAD_REQUEST "rephrase" copy.
  const messages = [];
  for (let i = 0; i < 50; i++) {
    messages.push({
      id: `seed-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      state: "complete",
      ...(i % 2 === 1 ? { outcome: "complete", provider: "gemini" } : {}),
    });
  }
  const page = await open(undefined, seededState(messages));
  page_ = page;
  const s = await composerState();
  log(/50-message limit/i.test(s.notice || ""), "F3.5 the actual 50-message cap is named, not generic copy", JSON.stringify(s.notice));
  log(s.sendDisabled === true, "F3.6 sending is disabled once the conversation is full");
  const newConvBtn = await evaluate(page, () =>
    Boolean([...document.querySelectorAll("footer button")].find((b) => /start new conversation/i.test(b.textContent || ""))),
  );
  log(newConvBtn, "F3.7 a working 'Start new conversation' control is offered");
  await screenshot(page, `${OUT}/f3-conversation-full.png`);
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await page.close();
}

/* ===================================================================== *
 * U1 -- an oversized historical message blocks the conversation honestly,
 * instead of being silently shortened on the wire (independent follow-up
 * review; see docs/requirements-audit.md).
 * ===================================================================== */
{
  const uniqueFact = "REMEMBER-THIS-UNIQUE-FACT-7f3a9c";
  const oversizedReply = "x".repeat(16_500 - uniqueFact.length) + uniqueFact;
  const messages = [
    { id: "seed-u1", role: "user", content: "give me a long answer", state: "complete" },
    {
      id: "seed-a1",
      role: "assistant",
      content: oversizedReply,
      state: "complete",
      outcome: "complete",
      provider: "gemini",
    },
  ];
  const page = await open(undefined, seededState(messages));
  page_ = page;
  const s = await composerState();
  log(
    /message over the/i.test(s.notice || "") && /16,000|16000/.test(s.notice || ""),
    "U1.1 the composer names the actual per-message limit for an oversized historical message, not the conversation-cap copy",
    JSON.stringify(s.notice),
  );
  log(s.sendDisabled === true, "U1.2 sending is disabled while history carries the oversized message");
  const newConvBtn = await evaluate(page, () =>
    Boolean([...document.querySelectorAll("footer button")].find((b) => /start new conversation/i.test(b.textContent || ""))),
  );
  log(newConvBtn, "U1.3 a working 'Start new conversation' control is offered here too");

  // Attempt to force a send anyway (bypassing the disabled button) to prove
  // the block is enforced in send() itself, not merely in the button's own
  // disabled attribute.
  await page.send("Runtime.evaluate", { expression: TYPE("a short follow-up"), awaitPromise: true });
  const forced = await evaluate(page, () => {
    const btn = document.querySelector('[aria-label="Send message"]');
    if (btn) btn.disabled = false; // simulate a disabled attribute somehow not applying
    const ta = document.querySelector("textarea");
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return true;
  });
  await sleep(200);
  const requests = await evaluate(page, () => window.__mock.requests);
  log(
    forced && requests === 0,
    "U1.4 send() itself refuses even if the Send button's disabled attribute is bypassed -- the block is not merely cosmetic",
    `requests=${requests}`,
  );
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await screenshot(page, `${OUT}/u1-oversized-history.png`);
  await page.close();
}

/* ===================================================================== *
 * U2 -- a BAD_REQUEST failure no longer deletes the user's own question,
 * and Retry targets the turn that actually failed, not an earlier one
 * (independent follow-up review).
 * ===================================================================== */
{
  const page = await open();
  page_ = page;
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("first question"), awaitPromise: true });
  await sleep(400);

  await evaluate(page, () => {
    window.__mock.failNextWith = { code: "BAD_REQUEST", status: 400 };
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("second question"), awaitPromise: true });
  await sleep(400);

  const afterFailure = await evaluate(page, () => {
    const userTexts = [...document.querySelectorAll(".flex.justify-end.pt-3 p.text-right")].map((p) => p.textContent?.trim());
    return { userTexts, banner: document.querySelector('[role="alert"]:not(footer [role="alert"])')?.textContent?.trim() ?? null };
  });
  log(
    afterFailure.userTexts.includes("first question") && afterFailure.userTexts.includes("second question"),
    "U2.1 both the earlier successful question AND the failed one remain visible in history -- nothing was deleted",
    JSON.stringify(afterFailure.userTexts),
  );
  log(Boolean(afterFailure.banner), "U2.2 the error banner with Retry appears for the failed turn");

  // Retry must resend "second question" -- the one that actually failed --
  // never "first question", which already succeeded.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["recovered"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  const retried = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Retry/.test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(500);
  const lastSent = await evaluate(page, () => window.__mock.sent.at(-1));
  const lastSentQuestion = lastSent?.messages?.at(-1)?.content;
  log(
    retried && lastSentQuestion === "second question",
    "U2.3 Retry resends the question that actually failed ('second question'), never the earlier successful one",
    JSON.stringify(lastSentQuestion),
  );
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await screenshot(page, `${OUT}/u2-bad-request-recovery.png`);
  await page.close();
}

/* ===================================================================== *
 * F5 -- provider attribution survives a selector change
 * ===================================================================== */
{
  const page = await open();
  page_ = page;
  // Start a conversation on Gemini (the default), then fail it.
  await evaluate(page, () => {
    window.__mock.failNextWith = { code: "INVALID_KEY", status: 502 };
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hello"), awaitPromise: true });
  await sleep(500);
  let banner = await bannerText();
  log(/Gemini/.test(banner || "") && !/OpenAI/.test(banner || ""), "F5.1 a Gemini failure names Gemini", JSON.stringify(banner));

  // Switch the selector to OpenAI WITHOUT retrying (conversation already
  // started, but the first turn is only a failed attempt with no assistant
  // text -- the warning dialog only guards a conversation that has actual
  // history to carry across providers; either way, switching must not
  // relabel the existing failure).
  const switched = await selectProvider(page, "OpenAI");
  await sleep(150);
  // If a confirmation dialog appeared (conversation carries context), confirm it.
  await evaluate(page, () => {
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => /Switch model/.test(b.textContent || ""));
    if (confirmBtn) confirmBtn.click();
    return true;
  });
  await sleep(150);
  banner = await bannerText();
  log(switched && /Gemini/.test(banner || "") && !/OpenAI/.test(banner || ""), "F5.2 the banner still names Gemini after switching the selector", JSON.stringify(banner));

  // Retry must still target Gemini.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 250;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["recovered"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  const retried = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Retry/.test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(120); // mid-flight, before the mocked answer resolves
  const label = await typingLabel();
  log(retried && /Gemini/.test(label || ""), "F5.3 the typing indicator during the retry still names Gemini, not the now-selected OpenAI", JSON.stringify(label));
  await sleep(500);
  const lastSent = await evaluate(page, () => window.__mock.sent.at(-1));
  log(lastSent && lastSent.provider === "gemini", "F5.4 Retry's actual request still targeted gemini", JSON.stringify(lastSent && lastSent.provider));
  await screenshot(page, `${OUT}/f5-retry-after-switch.png`);
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await page.close();
}

{
  // Single-configured-key setup screen scenario 1: with only OPENAI_API_KEY
  // configured, the DEFAULT provider (Gemini) is what is unconfigured on a
  // fresh session -- selecting the working OpenAI option (usable, since it
  // IS configured) must clear that setup screen rather than leaving it stuck.
  const page = await open({ gemini: { configured: false, reason: "GEMINI_API_KEY is not set." }, gpt: { configured: true, model: "gpt-mock-model" } });
  page_ = page;
  const beforeClick = await evaluate(page, () => document.querySelector("main")?.textContent || "");
  const chosen = await selectProvider(page, "OpenAI");
  await sleep(200);
  const afterClick = await evaluate(page, () => document.querySelector("main")?.textContent || "");
  log(/Gemini is not configured/.test(beforeClick), "F5.5a the default, unconfigured Gemini shows its own setup screen first", JSON.stringify(beforeClick.slice(0, 60)));
  log(chosen && !/is not configured/.test(afterClick), "F5.5b selecting the configured OpenAI option clears the setup screen entirely");
  await page.close();
}

{
  // Single-configured-key setup screen scenario 2: a RETURNING user whose
  // active conversation was already on OpenAI (from an earlier session,
  // saved to localStorage the ordinary way) reopens the app after OpenAI's
  // key was removed from the server. This is the realistic path to "OpenAI
  // selected first" -- the dropdown itself never allows CHOOSING an
  // unavailable provider (see ChatHeader.tsx's `usable` guard, unchanged by
  // F5), so the only way an unconfigured provider becomes the active one is
  // restored state, exactly like this.
  const gptDraft = { ...seededState([]).conversations[0], providerId: "gpt", messages: [] };
  const page = await open(
    { gpt: { configured: false, reason: "OPENAI_API_KEY is not set." }, gemini: { configured: true, model: "gemini-mock-model" } },
    { version: 1, conversations: [gptDraft], activeId: gptDraft.id },
  );
  page_ = page;
  await sleep(200);
  const setupText = await evaluate(page, () => document.querySelector("main")?.textContent || "");
  log(/OpenAI is not configured/.test(setupText), "F5.6 a restored OpenAI-active conversation names OpenAI, not Gemini, when OpenAI is the one unconfigured", JSON.stringify(setupText.slice(0, 80)));
  log(/OPENAI_API_KEY/.test(setupText) && !/GEMINI_API_KEY/.test(setupText), "F5.7 the setup screen names OPENAI_API_KEY, not GEMINI_API_KEY");
  await screenshot(page, `${OUT}/f5-setup-gpt-only-gemini-configured.png`);
  await page.close();
}

/* ===================================================================== *
 * F6 -- a long fenced code line reveals promptly, not only at stream end
 * ===================================================================== */
{
  const page = await open();
  page_ = page;
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 150;
    window.__mock.tokenGap = 3000; // stays "streaming" for a while after the code arrives
    window.__mock.chunks = [
      "```js\nconst reallyLongVariableName = 1 + 2 + 3 + 4 + 5 + 6 + 7;\n```\n",
      "more prose after the code block",
    ];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("show me code"), awaitPromise: true });
  await sleep(150 + 900); // first chunk arrived; still streaming (tokenGap is long)
  const code = await lastCodeText();
  log(
    Boolean(code && code.includes("reallyLongVariableName") && code.includes("1 + 2 + 3 + 4 + 5 + 6 + 7")),
    "F6.1 a long code line is fully visible while the stream is still open",
    JSON.stringify(code),
  );
  await screenshot(page, `${OUT}/f6-long-code-line.png`);
  await page.close();
}

/* ===================================================================== *
 * F8 -- switch dialog focus trap, Escape, and backdrop click-through
 * ===================================================================== */
{
  const page = await open();
  page_ = page;
  // Establish a conversation with real assistant content so switching warns.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hi"), awaitPromise: true });
  await sleep(400);

  const opened = await selectProvider(page, "OpenAI");
  await sleep(150);
  const initialFocus = await evaluate(page, () => document.activeElement?.textContent?.trim());
  log(opened && /Switch model/.test(initialFocus || ""), "F8.1 opening the dialog focuses Switch model", JSON.stringify(initialFocus));

  await pressKey(page, "Tab");
  await sleep(50);
  const afterTab = await evaluate(page, () => document.activeElement?.textContent?.trim());
  log(/Cancel/.test(afterTab || ""), "F8.2 Tab from the last control wraps to Cancel, not out to the provider trigger", JSON.stringify(afterTab));

  // Finding U5 (independent follow-up review): checking only which element
  // ends up focused cannot distinguish a real Shift+Tab from an ordinary
  // forward Tab that happens to land on the same element -- with exactly two
  // focusable controls in this trap, "next" and "previous" are always the
  // same single alternate element either way. Install a capture listener
  // (added AFTER the dialog's own, so it observes what the dialog's handler
  // already did) that records the actual protocol-level event: whether the
  // browser received shiftKey:true at all, and whether the app's own
  // handler called preventDefault() on it -- proof its shift-branch
  // specifically ran, not just native tab order.
  await evaluate(page, () => {
    window.__capturedTab = null;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab") window.__capturedTab = { shiftKey: e.shiftKey, defaultPrevented: e.defaultPrevented };
    });
    return true;
  });
  await pressKey(page, "Tab", { shift: true });
  await sleep(50);
  const captured = await evaluate(page, () => window.__capturedTab);
  const afterShiftTab = await evaluate(page, () => document.activeElement?.textContent?.trim());
  log(
    Boolean(captured?.shiftKey) && Boolean(captured?.defaultPrevented) && /Switch model/.test(afterShiftTab || ""),
    "F8.3 Shift+Tab from Cancel wraps back to Switch model -- confirmed via the real shiftKey:true event and the trap's own preventDefault(), not just the resulting focus",
    JSON.stringify({ captured, afterShiftTab }),
  );

  // Backdrop click-through: confirm the topmost element over the provider
  // trigger itself (still reading "Gemini" -- the switch is not yet
  // confirmed) is the backdrop, not the trigger, while the dialog is open.
  const shadowed = await evaluate(page, () => {
    const trigger = document.querySelector('[aria-haspopup="listbox"]');
    if (!trigger) return null;
    const r = trigger.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { isTrigger: top === trigger, tag: top?.tagName, ariaHidden: top?.getAttribute("aria-hidden") };
  });
  log(shadowed && shadowed.isTrigger === false, "F8.4 the provider dropdown trigger is shadowed by the modal backdrop while the dialog is open", JSON.stringify(shadowed));

  // Finding U5 (independent follow-up review), part 2: the earlier backdrop
  // was rendered inside the chat panel's own `.optical-glass` element, whose
  // `backdrop-filter` makes it a containing block for `position:fixed`
  // descendants -- the backdrop only ever covered THAT panel, never the
  // sidebar (a sibling, also its own separate `.optical-glass`). Confirm a
  // sidebar control -- outside the chat panel entirely -- is now shadowed
  // too, not just a control inside the same panel as the dialog.
  const sidebarShadowed = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("aside button")].find((b) => b.textContent?.trim() === "New chat");
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { isButton: top === btn, tag: top?.tagName, ariaHidden: top?.getAttribute("aria-hidden") };
  });
  log(
    sidebarShadowed && sidebarShadowed.isButton === false,
    "F8.4b the sidebar's own New chat control (outside the chat panel entirely) is ALSO shadowed by the backdrop, not just controls inside the same panel as the dialog",
    JSON.stringify(sidebarShadowed),
  );

  await pressKey(page, "Escape");
  await sleep(150);
  const afterEscape = await evaluate(page, () => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    focusedIsTrigger: document.activeElement?.getAttribute("aria-haspopup") === "listbox",
  }));
  log(!afterEscape.dialogOpen, "F8.5 Escape closes the dialog");
  log(afterEscape.focusedIsTrigger, "F8.6 focus returns to the initiating trigger after Escape", JSON.stringify(afterEscape));

  await screenshot(page, `${OUT}/f8-switch-dialog.png`);
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat were ever attempted on this page (the JS mock handled all of them)", `count=${page.getApiChatInterceptCount()}`);
  await page.close();
}

/* ===================================================================== *
 * U5, second pass -- the switch dialog's OWN buttons genuinely receive
 * pointer input, not just visually present with a background control
 * shadowed beside them (independent follow-up review's "One focused check").
 * Portaling only the backdrop (the first U5 fix, covered by F8.4/F8.4b
 * above) left the dialog nested inside `section.optical-glass`'s own
 * stacking context -- a real dispatched pointer click on "Switch model"
 * landed on the backdrop instead and silently cancelled. A synthetic DOM
 * `.click()` cannot detect this (it fires the target's handler directly,
 * bypassing hit-testing entirely) -- every check below uses `clickAt()`,
 * which goes through the browser's real hit-testing pipeline via CDP's
 * Input domain. See ChatHeader.tsx's SwitchDialog for the fix (the dialog
 * is now portaled alongside the backdrop, as a true sibling, instead of
 * staying nested).
 * ===================================================================== */
{
  const page = await open();
  page_ = page;
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hi"), awaitPromise: true });
  await sleep(400);

  await selectProvider(page, "OpenAI");
  await sleep(150);

  // U5b.1/U5b.2: elementFromPoint at the center of each dialog button must
  // resolve to the button itself, not the backdrop -- the direct check
  // F8.4/F8.4b never asked (those confirmed BACKGROUND controls were
  // shadowed, never that the dialog's OWN controls were not).
  const hitTest = await evaluate(page, () => {
    function probe(re) {
      const btn = [...document.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() || ""));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { isButton: top === btn || btn.contains(top), tag: top?.tagName };
    }
    return { cancel: probe(/^Cancel$/), switchModel: probe(/Switch model/) };
  });
  log(hitTest.cancel?.isButton === true, "U5b.1 elementFromPoint over Cancel resolves to the button itself, not the backdrop", JSON.stringify(hitTest.cancel));
  log(hitTest.switchModel?.isButton === true, "U5b.2 elementFromPoint over Switch model resolves to the button itself, not the backdrop", JSON.stringify(hitTest.switchModel));

  // U5b.3: a REAL pointer click on Cancel closes the dialog and leaves the
  // provider selection unchanged.
  let rect = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Cancel$/.test(b.textContent?.trim() || ""));
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  let after = await evaluate(page, () => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    // Chatgpt-style trigger: just the provider label + a chevron icon (no
    // text of its own), so the button's whole textContent is the label.
    provider: document.querySelector('[aria-haspopup="listbox"]')?.textContent?.trim(),
  }));
  log(
    !after.dialogOpen && after.provider === "Gemini",
    "U5b.3 a real pointer click on Cancel closes the dialog and leaves the provider unchanged",
    JSON.stringify(after),
  );

  // U5b.4: reopen; a REAL pointer click on Switch model closes the dialog
  // AND performs exactly the one requested switch -- the bug this fixes
  // made this click silently equivalent to Cancel instead.
  await selectProvider(page, "OpenAI");
  await sleep(150);
  rect = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Switch model/.test(b.textContent || ""));
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  after = await evaluate(page, () => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    // Chatgpt-style trigger: just the provider label + a chevron icon (no
    // text of its own), so the button's whole textContent is the label.
    provider: document.querySelector('[aria-haspopup="listbox"]')?.textContent?.trim(),
  }));
  log(
    !after.dialogOpen && after.provider === "OpenAI",
    "U5b.4 a real pointer click on Switch model closes the dialog and switches to OpenAI -- exactly one switch, not a silent cancel",
    JSON.stringify(after),
  );

  // U5b.5: a real pointer click outside the dialog (on a sidebar control)
  // dismisses it without activating that control underneath.
  await selectProvider(page, "Gemini");
  await sleep(150);
  const rowsBefore = await evaluate(page, () => document.querySelectorAll("aside li").length);
  rect = await evaluate(page, () => {
    const btn = [...document.querySelectorAll("aside button")].find((b) => b.textContent?.trim() === "New chat");
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  after = await evaluate(page, () => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    // Chatgpt-style trigger: just the provider label + a chevron icon (no
    // text of its own), so the button's whole textContent is the label.
    provider: document.querySelector('[aria-haspopup="listbox"]')?.textContent?.trim(),
  }));
  const rowsAfter = await evaluate(page, () => document.querySelectorAll("aside li").length);
  log(
    !after.dialogOpen && after.provider === "OpenAI" && rowsAfter === rowsBefore,
    "U5b.5 a real pointer click outside the dialog (on the sidebar's New chat button) dismisses it without switching AND without starting a new conversation",
    JSON.stringify({ after, rowsBefore, rowsAfter }),
  );

  await screenshot(page, `${OUT}/u5b-dialog-hit-testing.png`);
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await page.close();
}

/* ===================================================================== *
 * Responsive UI refinement, placement pass -- provider selection moved into
 * the composer's own bottom toolbar, Appearance moved into a sidebar
 * Settings entry point. P1-P3 cover the one behavior this relocation put at
 * genuine risk (an unsent draft is untouched by MessageComposer's own
 * `value` state, which nothing in the provider-switch path reads or resets
 * -- but that is exactly the kind of thing a refactor can silently break,
 * so it gets its own explicit check rather than being assumed). P4-P6
 * confirm the controls actually left the header, not just gained a second
 * home.
 * ===================================================================== */
{
  const page = await open();
  page_ = page;

  // P1: an unsent draft survives an IMMEDIATE switch (no conversation
  // started yet, so there is no confirmation dialog in the way).
  await page.send("Runtime.evaluate", { expression: TYPE("an unsent draft"), awaitPromise: true });
  await selectProvider(page, "OpenAI");
  await sleep(150);
  let draft = await evaluate(page, () => document.querySelector("textarea")?.value);
  log(draft === "an unsent draft", "P1 an unsent draft survives an immediate provider switch (no confirmation needed)", JSON.stringify(draft));

  // P2/P3: start a conversation (so switching requires confirmation), type a
  // fresh draft, and check it survives both confirming AND cancelling.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("start the conversation"), awaitPromise: true });
  await sleep(400);

  // Provider is OpenAI at this point (P1 switched it, and the conversation
  // above was sent on OpenAI) -- switching to Gemini now, with real
  // conversation history present, requires confirmation.
  await page.send("Runtime.evaluate", { expression: TYPE("draft surviving a confirm"), awaitPromise: true });
  await selectProvider(page, "Gemini");
  await sleep(150);
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Switch model/.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await sleep(150);
  draft = await evaluate(page, () => document.querySelector("textarea")?.value);
  log(draft === "draft surviving a confirm", "P2 an unsent draft survives CONFIRMING a mid-conversation provider switch", JSON.stringify(draft));

  await page.send("Runtime.evaluate", { expression: TYPE("draft surviving a cancel"), awaitPromise: true });
  await selectProvider(page, "OpenAI");
  await sleep(150);
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Cancel$/.test(b.textContent?.trim() || ""));
    if (btn) btn.click();
  });
  await sleep(150);
  draft = await evaluate(page, () => document.querySelector("textarea")?.value);
  log(draft === "draft surviving a cancel", "P3 an unsent draft survives CANCELLING a mid-conversation provider switch", JSON.stringify(draft));

  // P4-P6: the header keeps only the title -- provider selection and
  // Settings genuinely left it, not merely gained a second entry point.
  const headerContents = await evaluate(page, () => {
    const header = document.querySelector("header");
    return {
      hasProviderTrigger: Boolean(header?.querySelector('[aria-haspopup="listbox"]')),
      hasSettingsTrigger: Boolean(header?.querySelector('[aria-haspopup="dialog"]')),
      hasTitle: Boolean(header?.textContent?.trim()),
    };
  });
  log(!headerContents.hasProviderTrigger, "P4 the header no longer contains the provider dropdown trigger");
  log(!headerContents.hasSettingsTrigger, "P5 the header no longer contains a Settings/Appearance trigger");
  log(headerContents.hasTitle, "P6 the header still shows the conversation title");

  const footerHasProvider = await evaluate(page, () => Boolean(document.querySelector('footer [aria-haspopup="listbox"]')));
  log(footerHasProvider, "P7 the provider trigger now lives in the composer's own footer toolbar");

  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await page.close();
}

/* ===================================================================== *
 * Interaction refinement -- New chat, Regenerate, Edit-resend, attachments
 * ===================================================================== */
{
  // I1: repeated "New chat" clicks must not pile up duplicate empty
  // conversations. Empty drafts are never saved/listed at all (see
  // `savedOnly()`), so the only externally-observable proof is behavioral:
  // click it several times, THEN send -- the saved list must grow by
  // exactly one conversation, not by the number of clicks.
  const page = await open();
  page_ = page;

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["first answer"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("first conversation"), awaitPromise: true });
  await sleep(600);
  const savedCountBefore = await evaluate(page, () => document.querySelectorAll('nav[aria-label="Conversation history"] li').length);

  const clickNewChat = () =>
    evaluate(page, () => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "New chat");
      if (!btn) return false;
      btn.click();
      return true;
    });
  await clickNewChat();
  await sleep(150);
  await clickNewChat();
  await sleep(150);
  await clickNewChat();
  await sleep(150);

  await page.send("Runtime.evaluate", { expression: SEND("second conversation"), awaitPromise: true });
  await sleep(600);
  const savedCountAfter = await evaluate(page, () => document.querySelectorAll('nav[aria-label="Conversation history"] li').length);
  log(
    savedCountAfter === savedCountBefore + 1,
    "I1 repeated New chat clicks do not pile up duplicate empty conversations (saved list grows by exactly one)",
    JSON.stringify({ savedCountBefore, savedCountAfter }),
  );
  await page.close();
}

{
  // I2-I5: Regenerate on a settled answer targets the ORIGINAL answer's own
  // provider (never the conversation's currently-selected one, seeded
  // deliberately different here), never duplicates the question, and a
  // successful run is recorded as a new, selected version.
  const seed = seededState([
    { id: "u1", role: "user", content: "explain recursion", state: "complete" },
    { id: "a1", role: "assistant", content: "Recursion is when a function calls itself.", state: "complete", outcome: "complete", provider: "gpt" },
  ]);
  const page = await open(undefined, seed); // conversation.providerId is "gemini" (seededState's default); this answer's own provider is "gpt"
  page_ = page;

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["Recursion means a function calling itself, with a base case to stop."];
    window.__mock.doneOutcome = "complete";
    return true;
  });

  const regenOffered = await evaluate(page, () => Boolean(document.querySelector('[aria-label="Regenerate response"]')));
  log(regenOffered, "I2 Regenerate is offered on the latest, settled assistant answer");

  await evaluate(page, () => {
    document.querySelector('[aria-label="Regenerate response"]').click();
    return true;
  });
  await sleep(700);

  const sentReq = await evaluate(page, () => window.__mock.sent.at(-1));
  const userMessages = sentReq.messages.filter((m) => m.role === "user");
  log(
    sentReq.provider === "gpt",
    "I3 Regenerate targets the ORIGINAL answer's provider (gpt), not the conversation's own selected one (gemini)",
    JSON.stringify(sentReq.provider),
  );
  log(
    userMessages.length === 1 && userMessages[0].content === "explain recursion",
    "I4 Regenerate never duplicates the original question",
    JSON.stringify(userMessages),
  );

  const versionSelector = await evaluate(page, () => {
    const group = document.querySelector('[aria-label="Answer version"]');
    return group ? group.textContent.trim() : null;
  });
  log(versionSelector === "2/2", "I5 a successful Regenerate is recorded as version 2/2", String(versionSelector));
  await page.close();
}

{
  // I6-I8: a Regenerate that fails outright must preserve the original
  // answer (not blank it, not leave it half-replaced) and must not record a
  // new version -- the version selector must not even appear.
  const seed = seededState([
    { id: "u1", role: "user", content: "say hi", state: "complete" },
    { id: "a1", role: "assistant", content: "Hello there!", state: "complete", outcome: "complete", provider: "gemini" },
  ]);
  const page = await open(undefined, seed);
  page_ = page;

  await evaluate(page, () => {
    window.__mock.failNextWith = { code: "INVALID_KEY", status: 502 };
    return true;
  });
  await evaluate(page, () => {
    document.querySelector('[aria-label="Regenerate response"]').click();
    return true;
  });
  await sleep(600);

  const content = await evaluate(page, () => {
    const p = document.querySelector(".assistant-content");
    return p ? p.textContent.trim() : null;
  });
  log(Boolean(content) && content.includes("Hello there!"), "I6 a failed Regenerate preserves the original answer", String(content));

  const errorShown = await evaluate(page, () => Boolean(document.querySelector('[role="alert"]:not(footer [role="alert"])')));
  log(errorShown, "I7 a failed Regenerate shows the error banner");

  const versionSelectorAfterFail = await evaluate(page, () => Boolean(document.querySelector('[aria-label="Answer version"]')));
  log(!versionSelectorAfterFail, "I8 a failed Regenerate does not record a new version");
  await page.close();
}

{
  // I9-I10: editing the latest user turn and resending drops both the old
  // question and the old reply, and sends exactly the edited text -- never
  // a second copy of the original question alongside it.
  const seed = seededState([
    { id: "u1", role: "user", content: "what is 2+2", state: "complete" },
    { id: "a1", role: "assistant", content: "4", state: "complete", outcome: "complete", provider: "gemini" },
  ]);
  const page = await open(undefined, seed);
  page_ = page;

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["9"];
    window.__mock.doneOutcome = "complete";
    return true;
  });

  await evaluate(page, () => {
    document.querySelector('[aria-label="Edit message"]').click();
    return true;
  });
  await sleep(150);
  await evaluate(page, () => {
    const ta = document.querySelector('textarea[aria-label="Edit message"]');
    const proto = window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, "what is 4+5");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"));
    btn.click();
    return true;
  });
  await sleep(700);

  const sentReq = await evaluate(page, () => window.__mock.sent.at(-1));
  const userMessages = sentReq.messages.filter((m) => m.role === "user");
  log(
    userMessages.length === 1 && userMessages[0].content === "what is 4+5",
    "I9 Edit-and-resend drops the old question and sends exactly the edited one, never a second copy",
    JSON.stringify(userMessages),
  );

  const assistantTexts = await evaluate(page, () => [...document.querySelectorAll(".assistant-content")].map((el) => el.textContent.trim()));
  log(!assistantTexts.includes("4"), "I10 Edit-and-resend drops the old reply from the transcript", JSON.stringify(assistantTexts));
  await page.close();
}

{
  // I11: a real attachment round-trip -- asserts the actual OUTGOING wire
  // payload (`window.__mock.sent`), not just that a chip rendered in the
  // DOM, so this proves the adapter request structure itself.
  const page = await open();
  page_ = page;

  await page.send("Runtime.evaluate", { expression: STAGE_FILE(PNG_BYTES, "chart.png", "image/png"), awaitPromise: true });
  await sleep(300);
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["I see the chart."];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("what does this chart show?"), awaitPromise: true });
  await sleep(700);

  const sentReq = await evaluate(page, () => window.__mock.sent.at(-1));
  const lastMsg = sentReq.messages.at(-1);
  const atts = lastMsg.attachments ?? [];
  log(
    atts.length === 1 && atts[0].kind === "image" && typeof atts[0].data === "string" && atts[0].data.length > 0,
    "I11 an attached image reaches the outgoing request as real base64 image data, not just a UI chip",
    JSON.stringify({ count: atts.length, kind: atts[0]?.kind, dataLen: atts[0]?.data?.length }),
  );
  await page.close();
}

/* ===================================================================== *
 * Light regression spot-check: F1/F2 remain correct, approved visuals intact
 * ===================================================================== */
{
  const corrupt = "{not json, deliberately";
  const page = await open(undefined, corrupt);
  page_ = page;
  await sleep(900); // past the persist throttle
  const stillCorrupt = await evaluate(page, () => window.localStorage.getItem("model-switcher:conversations"));
  log(stillCorrupt === corrupt, "REGRESSION F1: corrupt storage is still untouched after load and the persist throttle", JSON.stringify(stillCorrupt));

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["partial"];
    window.__mock.doneOutcome = "truncated";
    window.__mock.doneReason = "reached the length limit";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hi"), awaitPromise: true });
  await sleep(500);
  const notice = await evaluate(page, () => {
    const p = document.querySelector(".assistant-content p.glass-text-subtle");
    return p ? p.textContent.trim() : null;
  });
  log(notice === "Response was cut short — reached the length limit.", "REGRESSION F2: truncated outcome still shows the specific notice", JSON.stringify(notice));

  const visuals = await evaluate(page, () => ({
    glassPanel: Boolean(document.querySelector(".optical-glass")),
    orbit: Boolean(document.querySelector(".gold-orbit")),
    providerAccent: getComputedStyle(document.querySelector("[data-provider]")).getPropertyValue("--accent").trim().length > 0,
  }));
  log(visuals.glassPanel, "REGRESSION visuals: the optical glass panel is present");
  log(visuals.orbit, "REGRESSION visuals: the gold orbit element rendered on the fresh user message");
  await screenshot(page, `${OUT}/regression-visuals.png`);
  log(page.getApiChatInterceptCount() === 0, "U3 zero real network requests to /api/chat on this page");
  await page.close();
}

console.log(`\n${pass} passed, ${fail} failed at ${WIDTH}x${HEIGHT}`);
if (fail > 0) process.exitCode = 1;
