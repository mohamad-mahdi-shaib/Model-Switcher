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
    // Project 4: the document endpoint. Mocked for the same reason /api/chat
    // is -- a real POST here parses the file and embeds every chunk of it
    // against the live embedding service. Nothing about an upload reaches
    // the dev server in a browser check.
    documents: {
      configured: true,
      // Every upload answered with this envelope, with the real filename and
      // size filled in from the actual File the app sent.
      sections: 12,
      pages: 12,
      warnings: [],
      // Milliseconds the upload appears to take, so the indexing state (and
      // the Send lock it implies) is observable rather than instantaneous.
      delay: 300,
      // When set, the next upload fails with this {status, detail}.
      failNextWith: null,
      uploads: [],
      deletes: [],
      issued: 0,
    },
    // Project 4, Milestone 4: structured extraction. A real call here spends
    // a Gemini request, so it is answered in the page like everything else.
    extract: {
      requests: [],
      delay: 200,
      failNextWith: null,
      // Overridden per test. Deliberately includes an unfound field (notes)
      // and an arithmetic discrepancy, because showing those honestly is
      // what the panel is for.
      data: {
        vendorName: "Northwind Ltd",
        billedTo: "Acme Corp",
        invoiceNumber: "INV-2024-0042",
        issueDate: "2024-03-01",
        dueDate: "2024-03-31",
        currency: "USD",
        lineItems: [
          { description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 },
          { description: "Licence", quantity: 2, unitPrice: 250, amount: 500 },
        ],
        subtotal: 1500,
        tax: 300,
        total: 1750,
        notes: null,
        sourceRefs: ["p. 1", "p. 2"],
      },
      warnings: [{ field: "total", message: "Subtotal plus tax comes to 1800.00, but the total reads 1750.00." }],
    },
  };
  window.__sent = window.__mock.sent;

  const documentId = () => {
    let id = "";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < 43; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    return id;
  };

  window.fetch = async (input, init) => {
    init = init || {};
    const url = typeof input === "string" ? input : input.url;

    if (url.includes("/api/extract")) {
      const e = window.__mock.extract;
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(JSON.stringify({ configured: true }), { status: 200 });
      }
      let parsedBody = null;
      try { parsedBody = JSON.parse(init.body); } catch (err) { parsedBody = null; }
      e.requests.push(parsedBody);
      await new Promise((r) => setTimeout(r, e.delay));
      if (e.failNextWith) {
        const failure = e.failNextWith;
        e.failNextWith = null;
        return new Response(
          JSON.stringify({ code: failure.code || "UPSTREAM", detail: failure.detail }),
          { status: failure.status || 502, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          result: {
            schemaId: (parsedBody && parsedBody.schema) || "invoice",
            documentId: (parsedBody && parsedBody.documentId) || "",
            filename: "contract.pdf",
            data: e.data,
            warnings: e.warnings,
            model: "gemini-mock-model",
            extractedAt: Date.now(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/api/documents")) {
      const d = window.__mock.documents;
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            configured: d.configured,
            storage: d.configured,
            embeddings: d.configured,
            maxBytes: 4000000,
            maxDocuments: 10,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "DELETE") {
        d.deletes.push(url);
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      const file = init.body && init.body.get ? init.body.get("file") : null;
      const conversationId = init.body && init.body.get ? init.body.get("conversationId") : null;
      d.uploads.push({ name: file ? file.name : null, size: file ? file.size : 0, conversationId: conversationId });
      await new Promise((r) => setTimeout(r, d.delay));
      if (d.failNextWith) {
        const failure = d.failNextWith;
        d.failNextWith = null;
        return new Response(
          JSON.stringify({ code: "PARSE_FAILED", detail: failure.detail }),
          { status: failure.status || 415, headers: { "Content-Type": "application/json" } },
        );
      }
      d.issued++;
      return new Response(
        JSON.stringify({
          document: {
            id: documentId(),
            filename: file ? file.name : "file",
            kind: "pdf",
            bytes: file ? file.size : 0,
            sections: d.sections,
            meta: { chars: 4000, truncated: false, pages: d.pages },
            warnings: d.warnings,
            uploadedAt: Date.now(),
          },
          warnings: d.warnings,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

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

/**
 * Project 4: real `%PDF-` signature bytes. Enough for the composer's own
 * classification and, were this ever sent to the real route, for its
 * magic-byte sniff -- the browser check never sends it anywhere real.
 */
export const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2, 3, 4, 5, 6, 7];

/** Reads the document tray's current state out of the page. */
export const TRAY_STATE = `
(() => {
  const tray = document.querySelector('[aria-label="Searchable files in this conversation"]');
  const send = document.querySelector('[aria-label="Send message"]');
  const chips = tray ? Array.from(tray.querySelectorAll("li")) : [];
  return {
    present: Boolean(tray),
    chips: chips.map((li) => ({
      text: li.textContent || "",
      hasRemove: Boolean(li.querySelector("button")),
    })),
    sendDisabled: send ? send.disabled : null,
    explainer: (() => {
      const p = tray && tray.parentElement ? tray.parentElement.querySelector("p") : null;
      return p ? p.textContent : null;
    })(),
    notice: (() => {
      const alert = document.querySelector('[role="alert"]');
      return alert ? alert.textContent : null;
    })(),
  };
})()
`;

/** Clicks a tray chip's remove control by the filename it carries. */
export const REMOVE_DOCUMENT = (filename) => `
(() => {
  const tray = document.querySelector('[aria-label="Searchable files in this conversation"]');
  if (!tray) return false;
  const chip = Array.from(tray.querySelectorAll("li")).find((li) =>
    (li.textContent || "").includes(${JSON.stringify(filename)}),
  );
  if (!chip) return false;
  const button = chip.querySelector("button");
  if (!button) return false;
  button.click();
  return true;
})()
`;

/** Opens the extraction dialog from the document tray. */
export const OPEN_EXTRACT = `
(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const trigger = buttons.find((b) => (b.textContent || "").includes("Extract data"));
  if (!trigger) return false;
  trigger.click();
  return true;
})()
`;

/**
 * Clicks a button inside the extraction dialog by its visible text OR its
 * aria-label -- icon-only controls (Close) have no text node at all, and
 * matching on text alone silently finds nothing and "passes" by doing
 * nothing.
 */
export const EXTRACT_CLICK = (label) => `
(() => {
  const dialog = document.querySelector('[aria-label="Extract structured data"]');
  if (!dialog) return false;
  const needle = ${JSON.stringify(label)};
  const button = Array.from(dialog.querySelectorAll("button")).find(
    (b) =>
      (b.textContent || "").includes(needle) ||
      (b.getAttribute("aria-label") || "").includes(needle),
  );
  if (!button) return false;
  button.click();
  return true;
})()
`;

/** Reads the extraction dialog's rendered state. */
export const EXTRACT_STATE = `
(() => {
  const dialog = document.querySelector('[aria-label="Extract structured data"]');
  if (!dialog) return { open: false };
  const rows = Array.from(dialog.querySelectorAll("table tr")).map((tr) =>
    Array.from(tr.querySelectorAll("th, td")).map((cell) => (cell.textContent || "").trim()),
  );
  const warnings = Array.from(
    dialog.querySelectorAll('[aria-label="Extraction warnings"] li'),
  ).map((li) => (li.textContent || "").trim());
  const buttons = Array.from(dialog.querySelectorAll("button")).map((b) =>
    (b.textContent || "").trim(),
  );
  return {
    open: true,
    text: dialog.textContent || "",
    rows: rows,
    warnings: warnings,
    buttons: buttons,
    tables: dialog.querySelectorAll("table").length,
  };
})()
`;

/**
 * Project 4, Milestone 5: captures what a download WOULD have written.
 *
 * Headless Chrome discards a download, so the file itself cannot be
 * inspected from here -- but the blob handed to `createObjectURL` can be,
 * and that is the artefact: its media type and its real byte length prove a
 * genuine .docx/.xlsx/.pdf was generated in the browser, not an empty or
 * placeholder file. The anchor click is neutralised so no download prompt
 * can stall the session.
 */
export const CAPTURE_DOWNLOADS = `
(() => {
  window.__downloads = [];
  window.__downloadErrors = [];
  const realCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    try {
      window.__downloads.push({ type: blob.type, size: blob.size });
    } catch (e) {
      window.__downloadErrors.push(String(e));
    }
    return realCreate(blob);
  };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      window.__downloads[window.__downloads.length - 1] &&
        (window.__downloads[window.__downloads.length - 1].filename = this.download);
      return;
    }
    return realClick.call(this);
  };
  window.addEventListener("error", (event) => window.__downloadErrors.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event) =>
    window.__downloadErrors.push(String(event.reason)),
  );
  return true;
})()
`;

/**
 * Opens the "Save as" menu on the LAST assistant answer.
 *
 * A real pointer sends mousedown before click, which is what closes any
 * menu already open (the component listens for mousedown). A bare synthetic
 * `.click()` skips that, leaving two menus open at once -- and a later
 * `querySelector` then reads the FIRST one, i.e. an older answer's menu.
 * The mousedown is dispatched here so the sequence matches a real click.
 */
export const OPEN_SAVE_MENU = `
(() => {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  const triggers = Array.from(
    document.querySelectorAll('[aria-label="Save this answer as a file"]'),
  );
  const trigger = triggers[triggers.length - 1];
  if (!trigger) return false;
  trigger.click();
  return true;
})()
`;

/** Closes any open Save-as menu the way a real click elsewhere would. */
export const CLOSE_MENUS = `
(() => {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  return document.querySelectorAll('[aria-label="File formats"]').length;
})()
`;

/** Reads the open Save-as menu: every entry, its label and whether it is disabled. */
export const SAVE_MENU_STATE = `
(() => {
  const menus = document.querySelectorAll('[aria-label="File formats"]');
  const menu = menus[menus.length - 1];
  if (!menu) return { open: false };
  return {
    open: true,
    entries: Array.from(menu.querySelectorAll('[role="menuitem"]')).map((b) => ({
      label: (b.textContent || "").trim(),
      disabled: b.disabled === true,
      title: b.getAttribute("title") || "",
    })),
    note: (() => {
      const p = menu.querySelector("p");
      return p ? p.textContent : null;
    })(),
  };
})()
`;

/** Clicks one entry in the open Save-as menu by its visible label. */
export const SAVE_AS = (label) => `
(() => {
  const menus = document.querySelectorAll('[aria-label="File formats"]');
  const menu = menus[menus.length - 1];
  if (!menu) return false;
  const entry = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((b) =>
    (b.textContent || "").includes(${JSON.stringify(label)}),
  );
  if (!entry || entry.disabled) return false;
  entry.click();
  return true;
})()
`;

/** Reads the rendered table in the last assistant answer. */
export const TABLE_STATE = `
(() => {
  const tables = Array.from(document.querySelectorAll("main table, table"));
  const table = tables[tables.length - 1];
  if (!table) return { present: false };
  return {
    present: true,
    headers: Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent || "").trim()),
    rows: Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim()),
    ),
  };
})()
`;

/** Reads the generated-file card rendered in the last assistant answer. */
export const FILE_CARD_STATE = `
(() => {
  const buttons = Array.from(document.querySelectorAll('[aria-label^="Download "]'));
  const button = buttons[buttons.length - 1];
  if (!button) return { present: false };
  const card = button.closest("div").parentElement;
  const toggle = Array.from(card.querySelectorAll("button")).find((b) =>
    /Show text|Hide text/.test(b.textContent || ""),
  );
  return {
    present: true,
    filename: (button.getAttribute("aria-label") || "").replace("Download ", ""),
    cardText: (card.textContent || "").trim(),
    toggleLabel: toggle ? (toggle.textContent || "").trim() : null,
    expanded: toggle ? toggle.getAttribute("aria-expanded") === "true" : null,
  };
})()
`;

/** Clicks the last answer's download button. */
export const CLICK_FILE_DOWNLOAD = `
(() => {
  const buttons = Array.from(document.querySelectorAll('[aria-label^="Download "]'));
  const button = buttons[buttons.length - 1];
  if (!button) return false;
  button.click();
  return true;
})()
`;

/** Toggles the card's "Show text" / "Hide text". */
export const TOGGLE_FILE_TEXT = `
(() => {
  const toggle = Array.from(document.querySelectorAll("button")).reverse().find((b) =>
    /Show text|Hide text/.test(b.textContent || ""),
  );
  if (!toggle) return false;
  toggle.click();
  return true;
})()
`;
