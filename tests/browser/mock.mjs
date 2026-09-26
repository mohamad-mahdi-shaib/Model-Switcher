// Installed via Page.addScriptToEvaluateOnNewDocument so it is in place
// before any app code runs. All model traffic is answered locally: no
// request leaves the page. The actual fail-closed backstop if this script
// somehow did not take effect is `cdp.mjs`'s CDP `Fetch`-layer interception
// of `/api/chat*` itself (Finding U3, independent follow-up review) -- this
// app's browser side never talks to a provider domain directly at all, it
// POSTs to its own same-origin `/api/chat`, so blocking provider domains
// alone (which `cdp.mjs` still also does) cannot catch a real request that
// only ever needed to reach this app's own server. See `cdp.mjs`'s own
// comment on `API_CHAT_PATTERN` for the full explanation.
//
// Finding F9: kept in the repository, not a scratchpad, and extended past
// the original F1/F2 verification pass to also support F3 (conversation
// length/cap), F5 (per-provider failure + single-configured-key setup) and
// F6 (a long fenced code line) scenarios, so this one fixture file covers
// this pass's checklist end to end.
//
// NOTE: this file deliberately contains no backslash escapes inside MOCK.
// The previous version used "\n" inside this template literal; the template
// literal turned it into a REAL newline, that newline landed inside a quoted
// string in the injected source, the script threw SyntaxError, the mock
// never installed, and window.fetch silently stayed real -- so the probe hit
// the live Gemini endpoint. Newlines are now built with
// String.fromCharCode(10), and assertMocked() fails loudly rather than
// letting a send reach the network.

export const MOCK = `
(() => {
  const NL = String.fromCharCode(10);
  const TICK = String.fromCharCode(96);
  const FENCE = TICK + TICK + TICK;
  const realFetch = window.fetch.bind(window);
  window.__mock = {
    firstTokenDelay: 400,
    tokenGap: 40,
    chunks: [
      "Here is a streamed reply with ",
      "**bold** text, ",
      "a [link](https://example.com), ",
      "and a list:" + NL + NL + "- first item" + NL + "- second item" + NL + NL,
      FENCE + "js" + NL + "const x = 1;" + NL + FENCE + NL,
    ],
    sent: [],
    requests: 0,
    installed: true,
    delivered: "",
    // F2: the wire "done" event's confirmed terminal outcome.
    doneOutcome: "complete",
    doneReason: undefined,
    // F5: which providers GET /api/chat reports configured, and with what
    // model id. A test overrides this before navigating (it is read on the
    // very first GET) to simulate a single-key setup.
    availability: {
      gemini: { configured: true, model: "gemini-mock-model" },
      gpt: { configured: true, model: "gpt-mock-model" },
    },
    // F5: when set, the NEXT POST fails outright with this normalized error
    // instead of streaming -- the same shape route.ts's errorResponse()
    // sends. Cleared automatically after one use.
    failNextWith: null,
  };
  window.__sent = window.__mock.sent;

  window.fetch = async (input, init) => {
    init = init || {};
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/chat")) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    const m = window.__mock;

    if (method === "GET") {
      return new Response(
        JSON.stringify({
          providers: m.availability,
          configured: Boolean(m.availability.gemini && m.availability.gemini.configured),
          model: (m.availability.gemini && m.availability.gemini.model) || null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    m.requests++;
    m.delivered = "";
    try { m.sent.push(JSON.parse(init.body)); } catch (e) { m.sent.push(null); }
    const signal = init.signal;

    if (m.failNextWith) {
      const failure = m.failNextWith;
      m.failNextWith = null;
      return new Response(
        JSON.stringify({ code: failure.code, detail: failure.detail || null, info: failure.info || null }),
        { status: failure.status || 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const wait = (ms) => new Promise((res, rej) => {
          const t = setTimeout(res, ms);
          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              rej(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }
        });
        try {
          await wait(m.firstTokenDelay);
          for (const text of m.chunks) {
            m.delivered += text;
            controller.enqueue(enc.encode(JSON.stringify({ type: "delta", text }) + NL));
            await wait(m.tokenGap);
          }
          controller.enqueue(enc.encode(JSON.stringify({ type: "done", outcome: m.doneOutcome, reason: m.doneReason }) + NL));
          controller.close();
        } catch (e) {
          try { controller.error(e); } catch (e2) {}
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  };
})();
`;

/**
 * Throws unless the mock is live in the page. Called before every send: a
 * silently-missing mock means real quota is spent.
 */
export async function assertMocked(page, evaluate) {
  const state = await evaluate(page, () => ({
    installed: Boolean(window.__mock && window.__mock.installed),
    fetchPatched: !String(window.fetch).includes("[native code]"),
  }));
  if (!state.installed || !state.fetchPatched) {
    throw new Error(
      "MOCK NOT INSTALLED -- refusing to send; this would hit a real provider. " +
        JSON.stringify(state),
    );
  }
  return state;
}

/** Sets the composer's value without sending -- for length/cap validation checks. */
export const TYPE = (text) => `
(async () => {
  const ta = document.querySelector("textarea");
  const proto = window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  return ta.value.length;
})()
`;

/** Type into the composer and press Enter. */
export const SEND = (text) => `
(async () => {
  if (!(window.__mock && window.__mock.installed)) throw new Error("mock missing");
  const ta = document.querySelector("textarea");
  const proto = window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ta.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true,
  }));
  return true;
})()
`;

/** Clicks the Send button directly (used once the value is already set via TYPE). */
export const CLICK_SEND = `
(() => {
  const btn = document.querySelector('[aria-label="Send message"]');
  if (!btn) return false;
  btn.click();
  return true;
})()
`;

/**
 * Interaction refinement: stages a file through the composer's hidden
 * `<input type="file">`, exactly the DOM path a real file picker selection
 * takes (a `File` built from real bytes, dispatched via a `DataTransfer`
 * and a genuine `change` event) -- not a shortcut that bypasses staging,
 * classification, or magic-byte sniffing. `bytesArray` is a plain array of
 * byte values (JSON-serializable) so this can cross into the page's own
 * `Runtime.evaluate` call unchanged.
 */
export const STAGE_FILE = (bytesArray, name, mimeType) => `
(async () => {
  const bytes = new Uint8Array(${JSON.stringify(bytesArray)});
  const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mimeType)} });
  const input = document.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return true;
})()
`;

/** Real signature bytes for a minimal (not necessarily fully valid) PNG -- enough to pass the app's own magic-byte sniff. */
export const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8];
