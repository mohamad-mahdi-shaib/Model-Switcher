// Minimal CDP driver: launches a disposable, headless Chrome and drives one
// page over the DevTools Protocol. No Playwright/Puppeteer dependency -- this
// project intentionally adds none, and Node ships a global WebSocket.
//
// Finding F9: kept in the repository (not a scratchpad) so the real-browser
// checks this project's audits describe are reproducible by anyone with this
// checkout and a local Chrome install, not just a one-off session artifact.
//
// Every launch gets its own temp --user-data-dir (removed on close), so
// nothing here ever touches the machine's real Chrome profile or history.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * Domains no test in this harness should ever reach. Blocked at the network
 * layer via Chrome's own `Network.setBlockedURLs`. This is a real, useful
 * backstop for any request that somehow targets a provider domain directly
 * -- but Finding U3 (independent follow-up review) correctly pointed out
 * that it is NOT what actually keeps a live provider request from happening
 * in THIS app: the browser never talks to Gemini/OpenAI directly at all: it
 * POSTs to this app's own same-origin `/api/chat`, and the Next.js SERVER is
 * what would then contact a real provider, using whatever key is in that
 * server's own `.env.local`. Blocking `generativelanguage.googleapis.com`
 * etc. at the BROWSER's network layer does nothing to stop that server-side
 * hop if the page's JS mock (`mock.mjs`) ever failed to install -- a real
 * POST to `/api/chat` would sail straight past this list, reach the real dev
 * server, and (if that server happened to have a real key configured) reach
 * a real provider. See `apiChatInterceptCount` below for the actual fix.
 */
const BLOCKED_URLS = [
  "*generativelanguage.googleapis.com*",
  "*api.openai.com*",
  "*aiplatform.googleapis.com*",
];

/**
 * The actual fail-closed guarantee for this app (Finding U3, fixing the
 * inaccurate claim the comment above used to make): every request matching
 * `/api/chat*` is intercepted at the CDP `Fetch` layer -- outside the page's
 * own JS entirely, at the browser-engine level -- and failed outright,
 * before it can ever leave the browser process. This is unconditional and
 * always on, for every page this file launches, regardless of whether
 * `mock.mjs`'s `window.fetch` override is installed or working.
 *
 * When the JS mock IS installed and working correctly, it answers `/api/chat`
 * by constructing a synthetic `Response` entirely in JS (via
 * `new Response(stream)`) -- that path never touches the browser's real
 * network stack at all, so `Fetch.requestPaused` never fires for it, and
 * `apiChatInterceptCount` should stay exactly 0 for the whole life of a
 * correctly-mocked test. If it is ever NOT installed (the scenario Finding
 * U3 asked to be provable), a real `fetch('/api/chat')` call goes out over
 * the real network, THIS interception catches it, fails it, and the count
 * goes above 0 -- proving the request never reached the real dev server (and
 * so never could have reached a real provider), without needing real
 * credentials to prove it. See `tests/browser/verify-network-isolation.mjs`
 * for the dedicated negative test that exercises exactly this.
 */
const API_CHAT_PATTERN = "*/api/chat*";

export async function launch({ width = 1366, height = 768, reducedMotion = false } = {}) {
  const port = 9000 + Math.floor(Math.random() * 900);
  const profile = mkdtempSync(join(tmpdir(), "model-switcher-cdp-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars=false",
    "--force-device-scale-factor=1",
    "about:blank",
  ];
  if (reducedMotion) args.unshift("--force-prefers-reduced-motion");
  const proc = spawn(CHROME, args, { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a debugger endpoint");

  const browser = await connect(wsUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

  let apiChatInterceptCount = 0;

  const page = {
    send: (method, params) => browser.send(method, params, sessionId),
    on: (evt, fn) => browser.on(evt, fn, sessionId),
    /**
     * How many real (browser-network-level) requests to `/api/chat` have
     * been caught and failed by the `Fetch` interception below, over this
     * page's whole life so far. Finding U3: a correctly-mocked test should
     * see this stay 0 throughout, since the JS mock answers `/api/chat`
     * without ever touching the real network; a positive count proves the
     * interception genuinely engaged (see `verify-network-isolation.mjs`).
     */
    getApiChatInterceptCount: () => apiChatInterceptCount,
    async close() {
      try {
        await browser.send("Browser.close");
      } catch {
        // Already gone.
      }
      browser.ws.close();
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Best effort.
      }
    },
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await page.send("Network.setBlockedURLs", { urls: BLOCKED_URLS });
  // Finding U3: the real fail-closed guarantee. See API_CHAT_PATTERN's own
  // comment above for why blocking provider domains alone is not enough.
  await page.send("Fetch.enable", { patterns: [{ urlPattern: API_CHAT_PATTERN }] });
  page.on("Fetch.requestPaused", (params) => {
    apiChatInterceptCount += 1;
    page.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" }).catch(() => {
      // The page may already be gone (navigation, close); nothing to do.
    });
  });
  if (reducedMotion) {
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  }
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        for (const l of listeners) {
          if (l.evt === msg.method && (!l.sessionId || l.sessionId === msg.sessionId)) l.fn(msg.params);
        }
      }
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () =>
      resolve({
        ws,
        send(method, params = {}, sessionId) {
          const msgId = ++id;
          const payload = { id: msgId, method, params };
          if (sessionId) payload.sessionId = sessionId;
          ws.send(JSON.stringify(payload));
          return new Promise((res, rej) => pending.set(msgId, { resolve: res, reject: rej }));
        },
        on(evt, fn, sessionId) {
          listeners.push({ evt, fn, sessionId });
        },
      }),
    );
  });
}

/** Evaluate an async function body in the page, returning a JSON value. */
export async function evaluate(page, fn, arg) {
  const expr = `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
  const r = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  }
  return r.result.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function screenshot(page, path) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, Buffer.from(data, "base64"));
}

/**
 * Dispatch a single key press (keydown+keyup) via CDP's Input domain.
 *
 * Finding U5 (independent follow-up review): `Input.dispatchKeyEvent` has no
 * `shiftKey` parameter at all -- modifiers are a single bit field named
 * `modifiers` (Alt=1, Ctrl=2, Meta/Command=4, Shift=8), documented at
 * https://chromium.googlesource.com/devtools/devtools-frontend/+/main/third_party/blink/public/devtools_protocol/browser_protocol.json.
 * The previous version sent `shiftKey: true` -- a field the protocol simply
 * ignores -- so a requested Shift+Tab reached the browser as a bare,
 * un-modified Tab. With exactly two focusable controls in the switch
 * dialog's trap, forward Tab and (the never-actually-sent) Shift+Tab landed
 * on the same element by coincidence, so the earlier reverse-focus test
 * passed for the wrong reason -- it could not have told a real Shift+Tab
 * apart from an ordinary one. Fixed to send the correct bit field;
 * `tests/browser/verify.mjs`'s F8.3 check additionally now confirms the
 * page actually RECEIVED `shiftKey: true` and called `preventDefault()`,
 * rather than trusting which element ended up focused.
 */
export async function pressKey(page, key, modifiers = {}) {
  const bits =
    (modifiers.alt ? 1 : 0) |
    (modifiers.ctrl ? 2 : 0) |
    (modifiers.meta ? 4 : 0) |
    (modifiers.shift ? 8 : 0);
  const common = {
    key,
    windowsVirtualKeyCode: KEY_CODES[key] ?? 0,
    nativeVirtualKeyCode: KEY_CODES[key] ?? 0,
    modifiers: bits,
  };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

const KEY_CODES = { Tab: 9, Escape: 27, Enter: 13 };

/**
 * Dispatch a real left-button click (mouseMoved + mousePressed +
 * mouseReleased) at viewport coordinates `x, y`, via CDP's Input domain.
 *
 * Finding U5, second pass (independent follow-up review): a synthetic DOM
 * `element.click()` -- used everywhere else in this harness for ordinary
 * button presses -- fires the element's click handler directly. It never
 * asks the browser's actual hit-testing algorithm which element is
 * frontmost at a point, so it cannot detect (or reproduce) a bug where a
 * higher-stacked, transparent sibling -- like the switch dialog's own
 * backdrop -- silently intercepts real pointer input intended for something
 * visually beneath or beside it. `Input.dispatchMouseEvent` goes through
 * the real rendering/hit-testing pipeline, the same one `elementFromPoint()`
 * and an actual mouse both use, so it is the only way this harness can
 * prove a button is genuinely clickable, not merely present. See
 * `verify.mjs`'s F8.7/F8.8 and `verify-dialog-hit-testing.mjs`.
 */
export async function clickAt(page, x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

/**
 * Wait for the app to be INTERACTIVE, not just for a fixed delay.
 *
 * Everything this app restores -- saved conversations, saved appearance
 * settings -- is read in a post-mount effect, and the composer stays
 * disabled until that read has happened and the availability probe has
 * answered. A fixed `sleep()` after `Page.navigate` therefore raced the
 * dev server's own compile step: on a cold or busy run the probe fired
 * against the server-rendered defaults, so a typed draft could be
 * overwritten by hydration and a click could land before the control it
 * targeted existed. Polling the one signal that means "React is driving
 * this page now" removes the race instead of widening it.
 */
export async function waitForInteractive(page, evaluate, timeoutMs = 40000) {
  const started = Date.now();
  for (;;) {
    const ready = await evaluate(page, () => {
      const ta = document.querySelector("textarea[aria-label='Message']");
      if (!ta) return false;
      // The composer is enabled once hydration AND the availability probe
      // have both landed.
      if (ta.disabled === false) return true;
      // A disabled composer is also the CORRECT post-hydration state when
      // the active provider has no key configured -- in which case the app
      // has rendered its own setup screen, which it can only do after the
      // probe answered. Treat that as ready too, or a deliberately
      // unconfigured scenario would wait forever for something that is
      // never going to happen.
      const main = document.querySelector("main")?.textContent || "";
      return /is not configured|to start chatting/i.test(main);
    });
    if (ready) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the app to become interactive");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
