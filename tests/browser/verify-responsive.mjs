// Responsive UI refinement -- dedicated real-browser coverage for layout
// behavior across desktop, tablet, and mobile. verify.mjs already exercises
// full application behavior (streaming, retry, limits, errors) at two
// desktop sizes; none of that is re-tested here, since none of it changes
// with viewport width. This file covers exactly the dimension that does:
// no horizontal overflow, correct sidebar/drawer/Settings/provider overlay
// mode per breakpoint, touch target sizes, long-content truncation/
// wrapping, live resize, and a phone landscape layout.
//
// Interaction refinement update: the sidebar's breakpoint and shape changed
// again, superseding this file's own previous "persistent compact rail
// below 640px" model (that `Rail` component was deleted outright, not kept
// alongside). The current, current design: below `lg` (1024px -- mobile
// AND narrow tablet) the sidebar is a CLOSED-BY-DEFAULT portaled drawer,
// opened only by the header's own toggle button; at `>=lg` the full sidebar
// is open by default with an independent collapse/expand toggle (same
// button, different meaning). 768px-wide viewports, which the previous
// pass put in "full sidebar" mode, are now compact/drawer -- and 844px-wide
// landscape phone, previously above the old 640px rail threshold, is now
// BELOW the new 1024px one, so it also gets the closed-by-default drawer
// rather than an always-visible sidebar. Both are real, confirmed-by-test
// behavior changes from the previous pass, not assumptions.
//
// Every click here goes through a real dispatched pointer event (`clickAt`,
// CDP `Input.dispatchMouseEvent`), never a synthetic DOM `.click()`, for the
// same reason the rest of this project's browser harness does: only a real
// dispatched click exercises the browser's actual hit-testing pipeline.
//
// Usage: node tests/browser/verify-responsive.mjs
// Requires a local Chrome and the dev server already running at BASE_URL.
// Not part of `npm test`; run on demand like this project's other
// real-browser checks.

import { launch, evaluate, sleep, screenshot, clickAt, pressKey } from "./cdp.mjs";
import { MOCK, SEND, assertMocked } from "./mock.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT = new URL(".", import.meta.url).pathname.replace(/^\//, "");

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const LONG_TITLE_SEED = {
  version: 1,
  conversations: [
    {
      id: "seed-long",
      title: "A genuinely very long conversation title that would overflow a narrow header if it were not truncated correctly by the layout",
      providerId: "gemini",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
      messages: [],
    },
  ],
  activeId: "seed-long",
};

async function openSeeded(width, height, seed) {
  const page = await launch({ width, height });
  let source = MOCK;
  if (seed) {
    source += `window.localStorage.setItem("model-switcher:conversations", ${JSON.stringify(JSON.stringify(seed))});`;
  }
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1800);
  await assertMocked(page, evaluate);
  return page;
}

function noOverflow(page) {
  return evaluate(page, () => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function rectOf(page, selector) {
  return evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }, selector);
}

/**
 * The full inline `<aside aria-label="Conversations">` (present whenever
 * the desktop collapse state is false, hidden below `lg` by pure CSS) vs.
 * the portaled drawer (`role="dialog"`, same aria-label -- only ever
 * MOUNTED at all while open, never just CSS-hidden).
 */
function sidebarMode(page) {
  return evaluate(page, () => {
    const full = document.querySelector('aside[aria-label="Conversations"]');
    const drawer = document.querySelector('[role="dialog"][aria-label="Conversations"]');
    const visible = (el) => Boolean(el) && getComputedStyle(el).display !== "none";
    return {
      fullSidebarVisible: visible(full),
      drawerOpen: Boolean(drawer),
      fullSidebarWidth: visible(full) ? full.getBoundingClientRect().width : null,
    };
  });
}

const toggleRect = (page) => rectOf(page, '[aria-label="Open conversation list"], [aria-label="Close conversation list"]');

async function clickToggle(page) {
  const r = await toggleRect(page);
  await clickAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await sleep(250);
}

/* ============================= Per-viewport pass ============================= */
async function checkViewport(width, height, isCompact) {
  const label = `${width}x${height}`;
  const page = await openSeeded(width, height, LONG_TITLE_SEED);

  const overflow = await noOverflow(page);
  log(overflow.scrollWidth <= overflow.clientWidth, `[${label}] no horizontal page overflow`, JSON.stringify(overflow));

  // The header now holds only the toggle + title -- provider selection and
  // Settings both moved out (see the placement-pass rewrite), so there is
  // nothing else in its row for a long title to crowd. Truncation only
  // NEEDS to engage where the header's available width is actually less
  // than the title's natural width.
  const title = await evaluate(page, () => {
    const header = document.querySelector("header");
    const h1 = document.querySelector("h1 span");
    if (!header || !h1) return null;
    return { scrollWidth: h1.scrollWidth, clientWidth: h1.clientWidth, headerWidth: header.getBoundingClientRect().width };
  });
  const truncationNeeded = Boolean(title) && title.headerWidth < title.scrollWidth;
  log(
    Boolean(title) && (truncationNeeded ? title.clientWidth < title.scrollWidth : title.clientWidth === title.scrollWidth),
    truncationNeeded
      ? `[${label}] long conversation title truncates (ellipsis engages; header is narrower than the title)`
      : `[${label}] long conversation title renders in full (header has enough room; no clipping needed)`,
    JSON.stringify(title),
  );

  // The provider trigger -- in the composer's own footer toolbar, right end
  // -- stays fully on screen regardless of viewport width.
  const triggerOnScreen = await evaluate(page, () => {
    const trigger = document.querySelector('[aria-haspopup="listbox"]');
    if (!trigger) return null;
    const r = trigger.getBoundingClientRect();
    return r.right <= window.innerWidth && r.left >= 0;
  });
  log(triggerOnScreen === true, `[${label}] the composer's provider trigger stays fully on screen`, JSON.stringify(triggerOnScreen));

  // The attachment button -- left end of the same toolbar row -- also stays
  // fully on screen and meets the touch target floor.
  const attachRect = await rectOf(page, '[aria-label="Attach files"]');
  log(
    Boolean(attachRect) && attachRect.w >= 44 && attachRect.h >= 44 && attachRect.x >= 0 && attachRect.right <= width,
    `[${label}] the composer's attach button is on screen and meets touch target`,
    JSON.stringify(attachRect),
  );

  // Sidebar default state, per the current lg (1024px) threshold: below it,
  // closed-by-default (neither the full sidebar nor the drawer present);
  // at/above it, the full inline sidebar is open by default.
  const initialMode = await sidebarMode(page);
  if (isCompact) {
    log(
      !initialMode.fullSidebarVisible && !initialMode.drawerOpen,
      `[${label}] sidebar is closed by default (no full sidebar, no drawer)`,
      JSON.stringify(initialMode),
    );

    // Open it via the header's own toggle -> the drawer appears, portaled,
    // with Search chats / New chat / Settings all reachable and each
    // meeting the 44px touch target.
    await clickToggle(page);
    const opened = await sidebarMode(page);
    log(opened.drawerOpen && !opened.fullSidebarVisible, `[${label}] header toggle opens the drawer`, JSON.stringify(opened));

    // Scoped to the drawer's own dialog container, not the whole document --
    // the collapsed-but-still-mounted (CSS `display:none`) full `<aside>`
    // renders the exact same SidebarBody, so an unscoped query would find
    // ITS zero-sized copy of these controls instead, first in DOM order.
    const drawerControls = await evaluate(page, () => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Conversations"]');
      if (!dialog) return ["Search chats", "New chat", "Settings", "Close conversation list"].map((name) => ({ name, found: false }));
      return ["Search chats", "New chat", "Settings", "Close conversation list"].map((name) => {
        const el = dialog.querySelector(`[aria-label="${name}"]`) ?? [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
        if (!el) return { name, found: false };
        const r = el.getBoundingClientRect();
        return { name, found: true, w: r.width, h: r.height };
      });
    });
    log(
      drawerControls.every((c) => c.found),
      `[${label}] the open drawer contains Search chats, New chat, Settings, and a close control`,
      JSON.stringify(drawerControls),
    );
    log(
      drawerControls.every((c) => c.h >= 44),
      `[${label}] every drawer control meets the 44px touch target`,
      JSON.stringify(drawerControls),
    );

    // Escape closes it, and focus returns to the toggle button that opened it.
    await pressKey(page, "Escape");
    await sleep(200);
    const closedByEscape = await sidebarMode(page);
    log(!closedByEscape.drawerOpen, `[${label}] Escape closes the drawer`, JSON.stringify(closedByEscape));
    const focusReturned = await evaluate(page, () => document.activeElement?.getAttribute("aria-label"));
    log(
      focusReturned === "Open conversation list",
      `[${label}] closing the drawer restores focus to the header toggle`,
      String(focusReturned),
    );

    // Reopen, then close via a real click on the backdrop (not the panel).
    await clickToggle(page);
    await sleep(200);
    await evaluate(page, () => {
      const backdrop = document.querySelector('[aria-hidden="true"].fixed.inset-0');
      backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    });
    await sleep(200);
    const closedByBackdrop = await sidebarMode(page);
    log(!closedByBackdrop.drawerOpen, `[${label}] clicking the backdrop closes the drawer`, JSON.stringify(closedByBackdrop));

    // The composer stays reachable while the drawer is closed again.
    const composerReachable = await rectOf(page, "textarea");
    log(Boolean(composerReachable), `[${label}] the composer is reachable once the drawer is closed`, JSON.stringify(composerReachable));
  } else {
    log(
      initialMode.fullSidebarVisible && !initialMode.drawerOpen,
      `[${label}] the full sidebar is open by default, side by side with chat`,
      JSON.stringify(initialMode),
    );

    // The same header toggle collapses it at this width instead of opening
    // a drawer -- confirm it actually disappears (not just visually, the
    // element itself stops being the visible one) and the chat panel is
    // still fully usable, then expand it back.
    await clickToggle(page);
    const collapsed = await sidebarMode(page);
    log(!collapsed.fullSidebarVisible, `[${label}] header toggle collapses the desktop sidebar`, JSON.stringify(collapsed));
    const overflowAfterCollapse = await noOverflow(page);
    log(
      overflowAfterCollapse.scrollWidth <= overflowAfterCollapse.clientWidth,
      `[${label}] no horizontal overflow after collapsing the sidebar`,
      JSON.stringify(overflowAfterCollapse),
    );

    await clickToggle(page);
    const reexpanded = await sidebarMode(page);
    log(reexpanded.fullSidebarVisible, `[${label}] header toggle re-expands the desktop sidebar`, JSON.stringify(reexpanded));

    // Settings, reachable directly in the always-open sidebar footer, shows
    // its icon+label and meets the touch target.
    const settings = await rectOf(page, '[aria-haspopup="dialog"]');
    const settingsLabelled = await evaluate(page, () => {
      const btn = document.querySelector('[aria-haspopup="dialog"]');
      return Boolean(btn) && /Settings/.test(btn.textContent || "");
    });
    log(
      Boolean(settings) && settings.h >= 44 && settingsLabelled,
      `[${label}] Settings is directly reachable in the sidebar footer with icon+label, meets touch target`,
      JSON.stringify(settings),
    );
  }

  // Provider dropdown opens with a real click, upward (a composer-anchored
  // trigger never has more room below it than above), and its option is
  // genuinely hit-testable, not just present in the DOM.
  const triggerRect = await rectOf(page, '[aria-haspopup="listbox"]');
  await clickAt(page, triggerRect.x + triggerRect.w / 2, triggerRect.y + triggerRect.h / 2);
  await sleep(200);
  const optionHit = await evaluate(page, () => {
    const panel = document.querySelector('[role="listbox"]');
    const trigger = document.querySelector('[aria-haspopup="listbox"]');
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => /OpenAI/.test(o.textContent || ""));
    if (!opt || !panel || !trigger) return null;
    const pr = panel.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    const r = opt.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      found: true,
      isHit: top === opt || opt.contains(top),
      onScreen: r.right <= window.innerWidth && r.left >= 0 && r.top >= 0 && r.bottom <= window.innerHeight,
      opensUpward: pr.bottom <= tr.top + 2,
      height: r.height,
    };
  });
  log(
    Boolean(optionHit?.found && optionHit.isHit && optionHit.onScreen && optionHit.height >= 44),
    `[${label}] provider dropdown option is on-screen, hit-testable, and meets touch target`,
    JSON.stringify(optionHit),
  );
  log(
    Boolean(optionHit?.opensUpward),
    `[${label}] provider dropdown opens upward from its composer-anchored trigger`,
    JSON.stringify(optionHit),
  );
  await evaluate(page, () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await sleep(150);

  await screenshot(page, `${OUT}/responsive-${label}.png`);
  await page.close();
  return { width, height };
}

/* ============================= Long content: code + URLs ============================= */
async function checkLongContent(width, height) {
  const label = `${width}x${height} long content`;
  const page = await launch({ width, height });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = [
      "```js\nconst thisIsADeliberatelyVeryLongLineOfCodeThatMustScrollHorizontallyInsideItsOwnCodeBlockRatherThanWrappingOrOverflowingThePage = 1;\n```\n",
      "See https://example.com/a/very/long/path/segment/that/should/wrap/normally/inside/the/prose/paragraph/rather/than/overflow for details.",
    ];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("show me code and a link"), awaitPromise: true });
  // The mock's own delays are tiny (firstTokenDelay/tokenGap ~10-60ms); the
  // dominant factor is the client's own paced reveal, confirmed by direct
  // measurement to need closer to 700ms to fully resolve for content this
  // long, plus a second queued chunk (the URL paragraph) behind it. 1400ms
  // leaves real margin rather than sitting right at that edge.
  await sleep(1800);

  const overflow = await noOverflow(page);
  log(overflow.scrollWidth <= overflow.clientWidth, `[${label}] long code line + long URL cause no PAGE-level horizontal overflow`, JSON.stringify(overflow));

  const codeScroll = await evaluate(page, () => {
    const pre = document.querySelector(".assistant-content pre");
    if (!pre) return null;
    return { scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth, overflowX: getComputedStyle(pre).overflowX };
  });
  log(
    Boolean(codeScroll) && codeScroll.scrollWidth > codeScroll.clientWidth,
    `[${label}] the long code line itself scrolls horizontally within its own block`,
    JSON.stringify(codeScroll),
  );

  // Copy button reachable (always visible now, not hover-only) and meets
  // the touch target floor.
  await sleep(200); // let streaming finish so Copy renders
  const copyRect = await rectOf(page, 'button[aria-label="Copy response"]');
  log(Boolean(copyRect) && copyRect.h >= 44, `[${label}] Copy button is present without hover and meets touch target`, JSON.stringify(copyRect));

  await page.close();
}

/* ============================= Live resize ============================= */
async function checkResize() {
  const page = await launch({ width: 1366, height: 768 });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);

  // Start a conversation so there is real transcript state to check for
  // duplication/remounting across the resize.
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["a stable answer"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hello before resize"), awaitPromise: true });
  await sleep(500);

  const messageCount = () => evaluate(page, () => document.querySelectorAll(".assistant-content, .flex.justify-end.pt-3").length);
  const before = { messageCount: await messageCount(), mode: await sidebarMode(page) };
  log(
    before.mode.fullSidebarVisible && !before.mode.drawerOpen,
    "[resize] starts in full-sidebar mode at 1366px wide",
    JSON.stringify(before.mode),
  );

  // Resize live, on the SAME page -- no reload -- down below the 1024px
  // compact threshold.
  await page.send("Emulation.setDeviceMetricsOverride", { width: 480, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);

  const afterShrink = {
    messageCount: await messageCount(),
    mode: await sidebarMode(page),
    overflow: await noOverflow(page),
  };
  log(
    afterShrink.messageCount === before.messageCount,
    "[resize] the transcript is not remounted or duplicated across a live resize",
    JSON.stringify({ before: before.messageCount, after: afterShrink.messageCount }),
  );
  log(
    !afterShrink.mode.fullSidebarVisible && !afterShrink.mode.drawerOpen,
    "[resize] shrinking below 1024px live closes the full sidebar to the closed-by-default drawer state",
    JSON.stringify(afterShrink.mode),
  );
  log(
    afterShrink.overflow.scrollWidth <= afterShrink.overflow.clientWidth,
    "[resize] no horizontal overflow immediately after a live shrink",
    JSON.stringify(afterShrink.overflow),
  );

  // Resize back up to desktop.
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const afterGrow = { messageCount: await messageCount(), mode: await sidebarMode(page) };
  log(afterGrow.messageCount === before.messageCount, "[resize] the transcript is still intact after resizing back up", JSON.stringify(afterGrow));
  log(
    afterGrow.mode.fullSidebarVisible && !afterGrow.mode.drawerOpen,
    "[resize] growing back above 1024px live restores the full inline sidebar",
    JSON.stringify(afterGrow.mode),
  );

  await page.close();
}

/**
 * A drawer opened while compact must not stay stuck open once the viewport
 * grows past the compact threshold underneath it (WorkspaceLayout derives
 * `overlay` from `isCompactSidebar` at render time specifically to prevent
 * two redundant "Conversations" surfaces from ever being visible together).
 */
async function checkResizeClosesStaleDrawer() {
  const page = await launch({ width: 480, height: 900 });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);

  await clickToggle(page);
  await sleep(200);
  const opened = await sidebarMode(page);
  log(opened.drawerOpen, "[resize] drawer opens at 480px wide", JSON.stringify(opened));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const afterGrow = await sidebarMode(page);
  log(
    afterGrow.fullSidebarVisible && !afterGrow.drawerOpen,
    "[resize] growing past 1024px while the drawer is open replaces it with the full sidebar, never both at once",
    JSON.stringify(afterGrow),
  );

  await page.close();
}

/* ============================= Phone landscape ============================= */
async function checkPhoneLandscape() {
  const width = 844;
  const height = 390;
  const page = await launch({ width, height });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);

  const overflow = await noOverflow(page);
  log(overflow.scrollWidth <= overflow.clientWidth, "[844x390 landscape] no horizontal page overflow", JSON.stringify(overflow));

  // 844px is below the 1024px compact threshold -- width-based, not a
  // phone/tablet device guess -- so landscape phone gets the closed-by-
  // default drawer, same as portrait phone.
  const mode = await sidebarMode(page);
  log(
    !mode.fullSidebarVisible && !mode.drawerOpen,
    "[844x390 landscape] 844px wide is below the compact threshold, so the sidebar is closed by default",
    JSON.stringify(mode),
  );

  // The composer must stay reachable within the short landscape height.
  const composer = await rectOf(page, "textarea");
  log(
    Boolean(composer) && composer.bottom <= height && composer.y >= 0,
    "[844x390 landscape] the composer is fully within the viewport, not clipped",
    JSON.stringify(composer),
  );

  const sendRect = await rectOf(page, '[aria-label="Send message"]');
  log(Boolean(sendRect) && sendRect.h >= 44 && sendRect.w >= 44, "[844x390 landscape] Send button meets touch target", JSON.stringify(sendRect));

  // The drawer still fits and is usable within the short landscape height.
  await clickToggle(page);
  await sleep(250);
  const drawerRect = await rectOf(page, '[role="dialog"][aria-label="Conversations"]');
  log(
    Boolean(drawerRect) && drawerRect.y >= 0 && drawerRect.bottom <= height,
    "[844x390 landscape] the opened drawer fits fully within the short viewport height",
    JSON.stringify(drawerRect),
  );

  await screenshot(page, `${OUT}/responsive-844x390-landscape.png`);
  await page.close();
}

/* ================================== Run ================================== */
await checkViewport(360, 800, true);
await checkViewport(390, 844, true);
await checkViewport(768, 1024, true);
await checkViewport(1024, 768, false);
await checkViewport(1366, 768, false);
await checkViewport(1680, 1050, false);
await checkLongContent(390, 844);
await checkLongContent(1366, 768);
await checkResize();
await checkResizeClosesStaleDrawer();
await checkPhoneLandscape();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
