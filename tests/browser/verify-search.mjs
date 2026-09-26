// Interaction refinement -- dedicated real-browser coverage for local
// conversation search (`src/lib/search.ts`, wired into
// `ConversationSidebar.tsx`'s `SidebarBody`). Covers: English and Arabic
// query matching (title and message text), highlighted snippets, the
// empty-results state, Escape/Clear, keyboard navigation, and that
// selecting a message result switches conversation, scrolls to and briefly
// flashes the right message, and clears the query. No provider is ever
// mocked as REACHED here (this is a purely local feature -- see the
// dedicated assertion at the end that zero requests were made), and Chrome
// itself additionally blocks provider domains and intercepts /api/chat at
// the network layer as a fail-closed backstop (see cdp.mjs).
//
// Usage: node tests/browser/verify-search.mjs
// Requires a local Chrome and the dev server already running at BASE_URL.
// Not part of `npm test`; run on demand like this project's other
// real-browser checks.

import { launch, evaluate, sleep, screenshot } from "./cdp.mjs";
import { MOCK, assertMocked } from "./mock.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT = new URL(".", import.meta.url).pathname.replace(/^\//, "");

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const now = Date.now();
const SEED = {
  version: 1,
  conversations: [
    {
      id: "trip",
      title: "Trip planning notes",
      providerId: "gemini",
      createdAt: now - 30_000,
      updatedAt: now - 30_000,
      messages: [
        { id: "trip-u1", role: "user", content: "Can you help me plan the itinerary for Lisbon?", state: "complete" },
        { id: "trip-a1", role: "assistant", content: "Sure -- let's start with hotel booking and a rough day-by-day route.", state: "complete", outcome: "complete", provider: "gemini" },
      ],
    },
    {
      id: "arabic",
      title: "محادثة عربية",
      providerId: "gpt",
      createdAt: now - 20_000,
      updatedAt: now - 20_000,
      messages: [
        { id: "ar-u1", role: "user", content: "مرحبا، كيف حالك؟", state: "complete" },
        { id: "ar-a1", role: "assistant", content: "أنا بخير، شكرا لسؤالك! كيف يمكنني مساعدتك اليوم؟", state: "complete", outcome: "complete", provider: "gpt" },
      ],
    },
    {
      id: "unrelated",
      title: "Weekend recipe ideas",
      providerId: "gemini",
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
      messages: [
        { id: "rec-u1", role: "user", content: "Give me a simple pasta recipe.", state: "complete" },
        { id: "rec-a1", role: "assistant", content: "Here's a quick aglio e olio.", state: "complete", outcome: "complete", provider: "gemini" },
      ],
    },
  ],
  activeId: "unrelated",
};

async function open() {
  const page = await launch({ width: 1366, height: 768 });
  const source = MOCK + `window.localStorage.setItem("model-switcher:conversations", ${JSON.stringify(JSON.stringify(SEED))});`;
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1200);
  await assertMocked(page, evaluate);
  return page;
}

const setQuery = (page, text) =>
  evaluate(
    page,
    (value) => {
      const input = document.querySelector('[aria-label="Search chats"]');
      input.focus(); // a real user typing into the field always has it focused; keyboard-nav/Escape below rely on this
      const proto = window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    text,
  );

const searchState = (page) =>
  evaluate(page, () => {
    const input = document.querySelector('[aria-label="Search chats"]');
    const listbox = document.querySelector('ul[role="listbox"]');
    const emptyNote = [...document.querySelectorAll("p")].find((p) => /No matches for/.test(p.textContent || ""));
    const options = listbox
      ? [...listbox.querySelectorAll('[role="option"]')].map((o) => ({
          text: o.textContent.trim(),
          selected: o.getAttribute("aria-selected") === "true",
          id: o.id,
        }))
      : [];
    return {
      value: input ? input.value : null,
      activedescendant: input ? input.getAttribute("aria-activedescendant") : null,
      hasEmptyNote: Boolean(emptyNote),
      optionCount: options.length,
      options,
    };
  });

async function main() {
  const page = await open();

  // 1. An English query matches a MESSAGE (not the title) in "Trip planning
  // notes", with a highlighted snippet, and correctly excludes the other
  // two seeded conversations.
  await setQuery(page, "itinerary");
  await sleep(150);
  let state = await searchState(page);
  log(
    state.optionCount === 1 && /itinerary/i.test(state.options[0]?.text || ""),
    "search matches message text (English) and shows exactly one result with a readable snippet",
    JSON.stringify(state),
  );

  // 2. Case-insensitivity.
  await setQuery(page, "ITINERARY");
  await sleep(150);
  state = await searchState(page);
  log(state.optionCount === 1, "search is case-insensitive", JSON.stringify(state));

  // 3. A title match.
  await setQuery(page, "recipe");
  await sleep(150);
  state = await searchState(page);
  log(
    state.optionCount >= 1 && state.options.some((o) => /recipe/i.test(o.text)),
    "search matches conversation titles too",
    JSON.stringify(state),
  );

  // 4. Arabic query, matching Arabic message text -- no special-casing
  // needed (Arabic has no case distinction), and no requests are made for
  // this (purely local).
  await setQuery(page, "مرحبا");
  await sleep(150);
  state = await searchState(page);
  log(
    state.optionCount === 1 && state.options[0].text.includes("مرحبا"),
    "search matches Arabic message text with a correctly rendered snippet",
    JSON.stringify(state),
  );

  // 5. An Arabic query against the Arabic conversation's TITLE too.
  await setQuery(page, "عربية");
  await sleep(150);
  state = await searchState(page);
  log(state.optionCount === 1, "search matches an Arabic conversation title", JSON.stringify(state));

  // 6. No matches -> explicit empty state, not a blank list.
  await setQuery(page, "zzzznomatchzzzz");
  await sleep(150);
  state = await searchState(page);
  log(state.optionCount === 0 && state.hasEmptyNote, "an unmatched query shows an explicit empty-results state", JSON.stringify(state));

  // 7. Keyboard navigation: ArrowDown moves aria-activedescendant/
  // aria-selected across results; Enter selects the active one.
  await setQuery(page, "e"); // broad match across all three seeded conversations
  await sleep(150);
  state = await searchState(page);
  log(state.optionCount >= 2, "a broad query returns multiple results to navigate", JSON.stringify(state));
  // `pressKey()` (cdp.mjs) only maps Tab/Escape/Enter -- ArrowDown/Escape
  // here go straight through CDP's Input domain instead.
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await sleep(120);
  const afterDown = await searchState(page);
  log(
    afterDown.options[1]?.selected === true && afterDown.activedescendant === afterDown.options[1]?.id,
    "ArrowDown moves the active result and updates aria-activedescendant",
    JSON.stringify(afterDown),
  );

  // 8. Escape on a non-empty query clears it first (rather than doing
  // nothing or closing something else).
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(150);
  state = await searchState(page);
  log(state.value === "", "Escape on a non-empty query clears it", JSON.stringify(state));

  // 9. The Clear button works too, and returns focus to the input.
  await setQuery(page, "itinerary");
  await sleep(150);
  await evaluate(page, () => {
    document.querySelector('[aria-label="Clear search"]').click();
    return true;
  });
  await sleep(150);
  state = await searchState(page);
  const focusedIsInput = await evaluate(page, () => document.activeElement?.getAttribute("aria-label") === "Search chats");
  log(state.value === "" && focusedIsInput, "the Clear button clears the query and returns focus to the search input", JSON.stringify(state));

  // 10. Selecting a MESSAGE result switches conversation, scrolls to and
  // briefly flashes exactly that message, and clears the query -- without
  // ever touching the transcript content itself or making a request.
  await setQuery(page, "itinerary");
  await sleep(150);
  await evaluate(page, () => {
    const opt = document.querySelector('ul[role="listbox"] [role="option"]');
    opt.click();
    return true;
  });
  await sleep(250);
  const afterSelect = await evaluate(page, () => {
    const input = document.querySelector('[aria-label="Search chats"]');
    const flashed = document.querySelector('[data-message-id="trip-u1"].search-flash');
    const msg = document.querySelector('[data-message-id="trip-u1"]');
    return {
      queryCleared: input ? input.value === "" : null,
      flashedNow: Boolean(flashed),
      messagePresent: Boolean(msg),
      messageText: msg ? msg.textContent : null,
    };
  });
  log(afterSelect.queryCleared === true, "selecting a search result clears the query", JSON.stringify(afterSelect));
  log(afterSelect.messagePresent && /itinerary/i.test(afterSelect.messageText || ""), "selecting a message result switches to its conversation", JSON.stringify(afterSelect));
  log(afterSelect.flashedNow, "the matched message is briefly flashed immediately after selection", JSON.stringify(afterSelect));

  // The flash is temporary (~2s) and self-clears, and never replays the
  // message's own entrance animation (a restored/older message has no
  // `user-enter`/`assistant-enter` class to begin with).
  await sleep(2200);
  const afterFlashExpires = await evaluate(page, () => Boolean(document.querySelector('[data-message-id="trip-u1"].search-flash')));
  log(!afterFlashExpires, "the flash clears itself after ~2s", String(afterFlashExpires));
  const neverAnimated = await evaluate(page, () => {
    const el = document.querySelector('[data-message-id="trip-u1"] > div');
    return el ? !el.className.includes("-enter") : true;
  });
  log(neverAnimated, "the search-triggered flash never replays the message's original entrance animation", String(neverAnimated));

  // Zero real network requests for the whole run -- search is purely local.
  log(page.getApiChatInterceptCount() === 0, "zero real network requests to /api/chat for the entire search flow", `count=${page.getApiChatInterceptCount()}`);

  await screenshot(page, `${OUT}/search-results.png`);
  await page.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("SCRIPT ERROR", e);
  process.exitCode = 1;
});
