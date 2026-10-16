// Settings pass -- dedicated real-browser coverage for:
//  1. The reported bug: clicking Settings made the workspace disappear with
//     no settings interface shown, in the 640-1023px viewport range. This
//     file reproduces it with a REAL pointer click at exactly that width,
//     confirms it is fixed, and confirms close/reopen/resize/preservation
//     of workspace state around it.
//  2. Appearance: exactly two backgrounds, the one remaining glass style,
//     migration from every removed saved preset/glass id, and text-size
//     persistence/effect.
//  3. Personalizations: Save/Reset, refresh persistence, and (together with
//     tests/route.test.ts / tests/gemini.test.ts / tests/openai.test.ts,
//     which cover the server-side mapping into both adapters' own request
//     shape with mocks) the real outgoing wire payload's `preferences`
//     field.
//  4. Read aloud: voice list/speed controls render and are wired.
//  5. Conversations: Export downloads real content with the attachment
//     disclosure; Delete all Cancel preserves data, Confirm clears it.
//
// Every provider response is mocked (mock.mjs); Chrome additionally blocks
// provider domains and intercepts /api/chat at the network layer as a
// fail-closed backstop (cdp.mjs). Zero live requests.
//
// Usage: node tests/browser/verify-settings.mjs
// Requires a local Chrome and the dev server already running at BASE_URL.

import { launch, evaluate, sleep, screenshot, clickAt, waitForInteractive } from "./cdp.mjs";
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

async function open(width, height, seedLocalStorage) {
  const page = await launch({ width, height });
  let source = MOCK;
  if (seedLocalStorage) {
    for (const [key, value] of Object.entries(seedLocalStorage)) {
      source += `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
    }
  }
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  await assertMocked(page, evaluate);
  return page;
}

/**
 * Layout-restructure pass: Settings is one trigger in the global header,
 * visible at every width. This helper used to have to open the sidebar
 * drawer first below 1024px, because the only trigger lived in the
 * sidebar's own footer -- which is exactly the coupling that produced the
 * bug this file was written for.
 */
async function openSettings(page) {
  const settingsBtn = await evaluate(page, () => {
    const btn = document.querySelector('header [aria-label="Settings"]');
    if (!btn || btn.offsetParent === null) return null;
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  if (!settingsBtn) return false;
  await clickAt(page, settingsBtn.cx, settingsBtn.cy);
  await sleep(500);
  return true;
}

const dialogState = (page) =>
  evaluate(page, () => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Settings"]');
    if (!dialog) return { present: false };
    const r = dialog.getBoundingClientRect();
    const heading = [...dialog.querySelectorAll("h2")].find((h) => h.textContent?.trim() === "Settings");
    const closeBtn = dialog.querySelector('[aria-label="Close settings"]');
    return {
      present: true,
      visible: r.width > 0 && r.height > 0 && getComputedStyle(dialog).display !== "none",
      hasHeading: Boolean(heading),
      hasClose: Boolean(closeBtn),
      inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  });

/* ====================================================================== */
/* 1. THE BUG: Settings across the full viewport range                    */
/* ====================================================================== */
async function checkBugFix(width, height, label) {
  const page = await open(width, height);

  // Type a draft so we can confirm it survives Settings opening/closing.
  await evaluate(page, () => {
    const ta = document.querySelector("textarea");
    const proto = window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, "a draft that must survive");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });

  const opened = await openSettings(page);
  log(opened, `[${label}] a Settings trigger is reachable with a real pointer click`);

  const state = await dialogState(page);
  log(state.present && state.visible, `[${label}] Settings dialog is actually present AND visible (the reported bug)`, JSON.stringify(state));
  log(Boolean(state.hasHeading), `[${label}] the dialog has an accessible "Settings" heading`, JSON.stringify(state));
  log(Boolean(state.hasClose), `[${label}] the dialog has a Close control`, JSON.stringify(state));
  log(Boolean(state.inViewport), `[${label}] the dialog is fully within the viewport`, JSON.stringify(state));

  // Draft preserved while Settings is open.
  const draftDuring = await evaluate(page, () => document.querySelector("textarea")?.value);
  log(draftDuring === "a draft that must survive", `[${label}] the composer draft survives Settings being open`, String(draftDuring));

  // Close via the X button, confirm gone, reopen, close via Escape.
  await evaluate(page, () => {
    document.querySelector('[aria-label="Close settings"]')?.click();
    return true;
  });
  await sleep(450);
  let after = await dialogState(page);
  log(!after.present, `[${label}] the Close button actually closes Settings`, JSON.stringify(after));

  await openSettings(page);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(450);
  after = await dialogState(page);
  log(!after.present, `[${label}] Escape closes Settings`, JSON.stringify(after));

  // Reopen, close via backdrop click.
  await openSettings(page);
  await evaluate(page, () => {
    const backdrops = [...document.querySelectorAll('[aria-hidden="true"].fixed.inset-0')];
    backdrops[backdrops.length - 1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  await sleep(450);
  after = await dialogState(page);
  log(!after.present, `[${label}] clicking the backdrop closes Settings`, JSON.stringify(after));

  // The workspace/draft is still there after all that open/close cycling.
  const draftAfter = await evaluate(page, () => document.querySelector("textarea")?.value);
  const composerReachable = await evaluate(page, () => Boolean(document.querySelector("textarea")));
  log(
    draftAfter === "a draft that must survive" && composerReachable,
    `[${label}] the composer and its draft are intact after the whole Settings open/close cycle`,
    String(draftAfter),
  );

  await screenshot(page, `${OUT}/settings-${label}.png`);
  await page.close();
}

/* ====================================================================== */
/* 2. Resize while Settings is open                                       */
/* ====================================================================== */
async function checkResizeWhileOpen() {
  const page = await open(900, 700);
  await openSettings(page);
  let state = await dialogState(page);
  log(state.present && state.visible, "[resize] Settings visible at 900px before resize", JSON.stringify(state));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  state = await dialogState(page);
  log(state.present && state.visible && state.inViewport, "[resize] Settings stays visible and in-viewport after shrinking to 390px", JSON.stringify(state));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  state = await dialogState(page);
  log(state.present && state.visible && state.inViewport, "[resize] Settings stays visible and in-viewport after growing to 1366px", JSON.stringify(state));

  await page.close();
}

/* ====================================================================== */
/* 3. Appearance: 3 backgrounds, both glass modes, migration, text size   */
/* ====================================================================== */
async function checkAppearance() {
  const page = await open(1366, 768);
  await openSettings(page);

  const backgroundOptions = await evaluate(page, () => {
    const group = document.querySelector('[role="dialog"][aria-label="Settings"] [aria-label="Background"][role="radiogroup"]');
    return group ? [...group.querySelectorAll('[role="radio"]')].map((b) => b.textContent?.trim()) : [];
  });
  log(backgroundOptions.length === 2, "exactly two background choices are offered", JSON.stringify(backgroundOptions));
  log(
    backgroundOptions.some((t) => t?.includes("Pearl")) &&
      backgroundOptions.some((t) => t?.includes("Aurora Colors")),
    "the two are exactly Pearl and Aurora Colors",
    JSON.stringify(backgroundOptions),
  );
  log(
    !/Obsidian|Champagne/i.test(JSON.stringify(backgroundOptions)),
    "the removed dark-mode and luxury wallpapers are gone from the picker",
    JSON.stringify(backgroundOptions),
  );

  const glassOptions = await evaluate(page, () => {
    const group = document.querySelector('[role="dialog"][aria-label="Settings"] [aria-label="Glass appearance"][role="radiogroup"]');
    return group ? [...group.querySelectorAll('[role="radio"]')].map((b) => b.textContent?.trim()) : [];
  });
  log(
    glassOptions.length === 1 && glassOptions[0]?.includes("Clear Glass"),
    "Clear Glass is the only glass style offered",
    JSON.stringify(glassOptions),
  );
  log(!/Glow/i.test(JSON.stringify(glassOptions)), "Glowy Glass is gone from the picker", JSON.stringify(glassOptions));

  // Selecting Aurora Colors actually changes the live preset -- and the ink
  // tone with it, since it is the dark-tone wallpaper.
  await evaluate(page, () => {
    const group = document.querySelector('[role="dialog"][aria-label="Settings"] [aria-label="Background"][role="radiogroup"]');
    const btn = [...group.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Aurora Colors"));
    btn?.click();
    return true;
  });
  await sleep(200);
  const applied = await evaluate(page, () => ({
    preset: document.querySelector(".workspace-root")?.getAttribute("data-preset"),
    tone: document.querySelector(".workspace-root")?.getAttribute("data-tone"),
    orbs: document.querySelectorAll(".aurora-orb").length,
  }));
  log(applied.preset === "aurora", "selecting Aurora Colors updates the live workspace preset", JSON.stringify(applied));
  log(
    applied.tone === "dark" && applied.orbs === 3,
    "Aurora Colors applies its dark ink tone and its three drifting orbs",
    JSON.stringify(applied),
  );

  // Text size: switching to Large actually changes the rendered scale.
  const scaleBefore = await evaluate(page, () => getComputedStyle(document.querySelector(".workspace-root")).getPropertyValue("--text-scale").trim());
  await evaluate(page, () => {
    const group = document.querySelector('[role="dialog"][aria-label="Settings"] [aria-label="Text size"][role="radiogroup"]');
    const btn = [...group.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.trim() === "Large");
    btn?.click();
    return true;
  });
  await sleep(150);
  const scaleAfter = await evaluate(page, () => getComputedStyle(document.querySelector(".workspace-root")).getPropertyValue("--text-scale").trim());
  log(scaleBefore !== scaleAfter && scaleAfter === "1.18", "selecting Large text size changes --text-scale", JSON.stringify({ scaleBefore, scaleAfter }));

  await sleep(500); // the save effect writes synchronously; this is just settle time

  // Reload: a REAL navigation of the SAME page/profile (a fresh launch()
  // would start an entirely new, isolated Chrome profile with its own
  // empty localStorage -- not what "persists across a reload" means).
  // The mock must be re-installed, since a navigation clears any JS state
  // the previous document had, including the injected fetch override.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  await assertMocked(page, evaluate);
  const persisted = await evaluate(page, () => ({
    preset: document.querySelector(".workspace-root")?.getAttribute("data-preset"),
    textSize: document.querySelector(".workspace-root")?.getAttribute("data-text-size"),
  }));
  log(persisted.preset === "aurora" && persisted.textSize === "large", "appearance choices persist across a reload", JSON.stringify(persisted));
  await page.close();
}

async function checkBackgroundMigration() {
  // Every id this app has ever saved must resolve to a real current one --
  // never blank, never invalid. Each removed wallpaper maps to the nearest
  // surviving treatment rather than all collapsing onto the default, and a
  // saved `classic` glass (the removed Glowy Glass, and this app's former
  // default) resolves to the one remaining material.
  const cases = [
    ["warm", "pearl", "a long-removed id falls back to the default"],
    ["marble", "pearl", "migrates specifically to pearl (the same treatment, renamed)"],
    ["champagne-luxury", "pearl", "the removed luxury wallpaper migrates to the remaining light one"],
    ["obsidian", "aurora", "the removed dark-mode wallpaper migrates to the remaining dark one"],
  ];
  for (const [saved, expectedPreset, why] of cases) {
    const page = await open(1366, 768, {
      "model-switcher:settings": JSON.stringify({ version: 1, settings: { background: saved, glass: "classic" } }),
    });
    const state = await evaluate(page, () => ({
      preset: document.querySelector(".workspace-root")?.getAttribute("data-preset"),
      glass: document.querySelector(".workspace-root")?.getAttribute("data-glass"),
    }));
    log(state.preset === expectedPreset, `a saved "${saved}" background: ${why}`, JSON.stringify(state));
    log(state.glass === "ultra", `a saved "classic" glass alongside "${saved}" migrates to Clear Glass`, String(state.glass));
    await page.close();
  }
}

/* ====================================================================== */
/* 4. Personalizations                                                    */
/* ====================================================================== */
async function checkPersonalizations() {
  const page = await open(1366, 768);
  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Personalizations");
    tab?.click();
    return true;
  });
  await sleep(150);

  await evaluate(page, () => {
    const input = document.querySelector('[role="dialog"][aria-label="Settings"] input[type="text"]');
    const proto = window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, "Riley");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const textarea = document.querySelector('[role="dialog"][aria-label="Settings"] textarea');
    const tproto = window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(tproto, "value").set.call(textarea, "Always answer in bullet points.");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.trim() === "Save changes");
    btn?.click();
    return true;
  });
  await sleep(500);

  // Send a message; assert the real outgoing wire payload.
  await evaluate(page, () => {
    document.querySelector('[aria-label="Close settings"]')?.click();
    return true;
  });
  await sleep(200);
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await evaluate(page, () => {
    const ta = document.querySelector("textarea");
    const proto = window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, "hello");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[aria-label="Send message"]').click();
    return true;
  });
  await sleep(700);
  const sent = await evaluate(page, () => window.__mock.sent.at(-1));
  log(
    sent?.preferences?.preferredName === "Riley" && sent?.preferences?.customInstructions === "Always answer in bullet points.",
    "Saved Personalizations are actually included in the outgoing request's `preferences` field",
    JSON.stringify(sent?.preferences),
  );

  await sleep(500);

  // Reload the SAME page/profile (see checkAppearance's own comment on why
  // a fresh launch() would be a different, empty localStorage entirely).
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await sleep(1600);
  await assertMocked(page, evaluate);
  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Personalizations");
    tab?.click();
    return true;
  });
  await sleep(150);
  const reloadedName = await evaluate(page, () => document.querySelector('[role="dialog"][aria-label="Settings"] input[type="text"]')?.value);
  log(reloadedName === "Riley", "the preferred name persists across a reload", String(reloadedName));

  // Reset clears it and saves the empty state.
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.trim() === "Reset to defaults");
    btn?.click();
    return true;
  });
  await sleep(500);
  const afterReset = await evaluate(page, () => document.querySelector('[role="dialog"][aria-label="Settings"] input[type="text"]')?.value);
  log(afterReset === "", "Reset to defaults clears the preferred name field", JSON.stringify(afterReset));
  await sleep(500);
  await page.close();
}

/* ====================================================================== */
/* 5. Read aloud controls render and are wired                            */
/* ====================================================================== */
async function checkReadAloud() {
  const page = await open(1366, 768);
  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Read aloud");
    tab?.click();
    return true;
  });
  await sleep(150);
  const state = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const select = panel.querySelector("select");
    const range = panel.querySelector('input[type="range"]');
    return {
      hasVoiceSelect: Boolean(select),
      autoOptionPresent: select ? [...select.options].some((o) => /Automatic/.test(o.textContent || "")) : false,
      hasRateSlider: Boolean(range),
      rateValue: range?.value,
      rateMin: range?.min,
      rateMax: range?.max,
    };
  });
  log(state.hasVoiceSelect && state.autoOptionPresent, "a voice selector with an Automatic option is offered", JSON.stringify(state));
  log(state.hasRateSlider && state.rateValue === "1", "a reading-speed control defaulting to 1x is offered", JSON.stringify(state));
  log(Number(state.rateMin) >= 0.4 && Number(state.rateMax) <= 3, "the speed range is sensibly bounded", JSON.stringify(state));

  // Changing the rate updates the readout.
  await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const range = panel.querySelector('input[type="range"]');
    const proto = window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(range, "1.5");
    range.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  await sleep(150);
  const readout = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    return [...panel.querySelectorAll("span")].find((s) => /×$/.test(s.textContent?.trim() || "") && s.textContent?.includes("1.5"))?.textContent;
  });
  log(Boolean(readout), "moving the speed slider updates the numeric readout", String(readout));

  // Voice tone (gender preference): three options, enabled while on
  // Automatic, and disabled once a specific voice is chosen (since a
  // named voice's own tone is already fixed -- there is nothing left to
  // prefer). Real voice names vary per machine, so this only exercises
  // the enable/disable wiring and the click-to-select behavior, not a
  // specific voice's own guessed gender.
  const genderState = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const group = panel.querySelector('[role="radiogroup"][aria-label="Voice tone"]');
    const options = group ? [...group.querySelectorAll('[role="radio"]')] : [];
    return {
      count: options.length,
      labels: options.map((o) => o.textContent?.trim()),
      allEnabled: options.every((o) => !o.disabled),
    };
  });
  log(
    genderState.count === 3 && genderState.allEnabled,
    "a Voice tone control (Any/Female/Male) is offered and enabled while Automatic is selected",
    JSON.stringify(genderState),
  );

  await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const group = panel.querySelector('[role="radiogroup"][aria-label="Voice tone"]');
    const btn = [...group.querySelectorAll('[role="radio"]')].find((o) => o.textContent?.trim() === "Female");
    btn.click();
    return true;
  });
  await sleep(150);
  const afterFemale = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const group = panel.querySelector('[role="radiogroup"][aria-label="Voice tone"]');
    const btn = [...group.querySelectorAll('[role="radio"]')].find((o) => o.textContent?.trim() === "Female");
    return btn.getAttribute("aria-checked");
  });
  log(afterFemale === "true", "selecting Female actually marks it as the active voice tone", String(afterFemale));

  // If this device reports any real voices, picking one specific voice
  // disables the (now moot) tone preference.
  const voiceCount = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    return panel.querySelector("select").options.length;
  });
  if (voiceCount > 1) {
    await evaluate(page, () => {
      const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
      const select = panel.querySelector("select");
      select.selectedIndex = 1; // first real voice, past "Automatic"
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    await sleep(150);
    const disabledState = await evaluate(page, () => {
      const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
      const group = panel.querySelector('[role="radiogroup"][aria-label="Voice tone"]');
      return [...group.querySelectorAll('[role="radio"]')].every((o) => o.disabled);
    });
    log(disabledState, "choosing one specific voice disables the (now moot) Voice tone control", String(disabledState));
  }

  await page.close();
}

/* ====================================================================== */
/* 6. Conversations: Export + Delete all                                  */
/* ====================================================================== */
/**
 * Runs an export click with two interceptions active at once, resolving
 * once BOTH have fired (or after a generous timeout, since html2canvas's
 * own rasterisation is not instant): the off-screen render container
 * (`conversation-pdf.ts`'s own off-screen `<div>`, identified by its
 * distinctive `left: -99999px` positioning) is captured for its real text
 * content BEFORE rasterisation -- the PDF's own bytes are no longer
 * meaningfully substring-searchable now that content is embedded as a
 * rendered image, not text objects, so this is what actually verifies
 * "the right conversations, and the right characters, were really there"
 * -- and the download itself (jsPDF's `saveAs()`, confirmed by reading
 * node_modules/jspdf/dist/jspdf.es.js to create a detached `<a>`, set its
 * `.download` directly, and dispatch a raw `MouseEvent("click")` rather
 * than call `.click()`) is captured for the real filename and the real
 * downloaded bytes' magic number/size.
 */
async function runExportAndCapture(page) {
  return evaluate(page, () => {
    return new Promise((resolve) => {
      const result = { container: null, url: null, name: null };
      let restored = false;
      // Every one of the three overrides below must be undone the instant
      // all three have fired -- NOT only in the slow-path timeout -- or
      // they stay active (patched onto real global prototypes) for
      // whatever the page does next, which for this same test file is
      // another export a few hundred milliseconds later, well before a
      // multi-second fallback timeout would ever have restored them. That
      // exact ordering bug was caught here: a second export attempt found
      // `document.createElement`/`appendChild`/`URL.createObjectURL` still
      // wrapped from the first one.
      const restore = () => {
        if (restored) return;
        restored = true;
        Element.prototype.appendChild = originalAppend;
        URL.createObjectURL = originalCreateObjectURL;
        document.createElement = originalCreateElement;
      };
      const maybeResolve = () => {
        if (result.container && result.url && result.name) {
          restore();
          resolve(result);
        }
      };

      const originalAppend = Element.prototype.appendChild;
      Element.prototype.appendChild = function (node) {
        if (node?.style?.left === "-99999px") {
          const paragraphs = [...node.querySelectorAll("p")].map((p) => ({
            text: p.textContent,
            dir: p.getAttribute("dir"),
          }));
          result.container = { textContent: node.textContent, paragraphs };
          maybeResolve();
        }
        return originalAppend.call(this, node);
      };

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        const url = originalCreateObjectURL.call(URL, blob);
        if (blob.type === "application/pdf") {
          result.url = url;
          maybeResolve();
        }
        return url;
      };

      const originalCreateElement = document.createElement.bind(document);
      document.createElement = function (tag, ...rest) {
        const el = originalCreateElement(tag, ...rest);
        if (String(tag).toLowerCase() === "a") {
          let stored = "";
          Object.defineProperty(el, "download", {
            configurable: true,
            get: () => stored,
            set: (v) => {
              stored = v;
              result.name = v;
              maybeResolve();
            },
          });
        }
        return el;
      };

      const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) =>
        b.textContent?.trim().startsWith("Export"),
      );
      btn.click();
      setTimeout(() => {
        restore();
        resolve(result);
      }, 3000);
    });
  });
}

async function fetchAsRaw(page, url) {
  return evaluate(
    page,
    (u) =>
      fetch(u)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          let raw = "";
          for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
          return { byteLength: bytes.length, raw };
        }),
    url,
  );
}

const EXPORT_SEED = (() => {
  const now = Date.now();
  return {
    version: 1,
    conversations: [
      {
        id: "c1",
        title: "English chat",
        providerId: "gemini",
        createdAt: now,
        updatedAt: now,
        messages: [
          { id: "u1", role: "user", content: "remember this", state: "complete" },
          { id: "a1", role: "assistant", content: "hi there", state: "complete", outcome: "complete", provider: "gemini" },
        ],
      },
      {
        id: "c2",
        title: "محادثة عربية",
        providerId: "gemini",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        messages: [
          { id: "u2", role: "user", content: "مرحبا، كيف حالك اليوم؟", state: "complete" },
          {
            id: "a2",
            role: "assistant",
            content: "أنا بخير شكرا لسؤالك، كيف يمكنني مساعدتك؟",
            state: "complete",
            outcome: "complete",
            provider: "gemini",
          },
        ],
      },
    ],
    activeId: "c1",
  };
})();

async function openExportSeed() {
  const page = await open(1366, 768, { "model-switcher:conversations": JSON.stringify(EXPORT_SEED) });
  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Conversations");
    tab?.click();
    return true;
  });
  await sleep(200);
  return page;
}

/**
 * Split into two separate page instances (fresh browser process each) --
 * rather than two exports back-to-back in the same page -- deliberately.
 * Each real export now rasterises a real, fairly large off-screen DOM
 * region via html2canvas at 2x scale (confirmed: ~1.9MB per resulting
 * file), and doing that twice in immediate succession in one already
 * long, heavily-loaded session's headless Chrome instance reproducibly
 * crashed the renderer ("Inspected target navigated or closed") -- a
 * genuine resource-pressure finding from this test, not an application
 * bug (the app itself was never seen to fail; only this harness, running
 * two heavy rasterisations back-to-back, was).
 */
async function checkExportSelection() {
  const page = await openExportSeed();

  // Both saved conversations are offered, selected by default.
  const checkboxState = await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const boxes = [...panel.querySelectorAll('input[type="checkbox"]')];
    return { count: boxes.length, allChecked: boxes.every((b) => b.checked) };
  });
  log(
    checkboxState.count === 2 && checkboxState.allChecked,
    "both saved conversations are offered for export, selected by default",
    JSON.stringify(checkboxState),
  );

  // Uncheck the Arabic conversation -- only the English one should be exported.
  await evaluate(page, () => {
    const panel = document.querySelector('[role="dialog"][aria-label="Settings"]');
    const label = [...panel.querySelectorAll("label")].find((l) => l.textContent?.includes("محادثة عربية"));
    label.querySelector('input[type="checkbox"]').click();
    return true;
  });
  await sleep(150);

  const partial = await runExportAndCapture(page);
  log(
    Boolean(partial.container?.textContent?.includes("remember this")) &&
      Boolean(partial.container?.textContent?.includes("hi there")),
    "unchecking a conversation still exports the ones left checked (English content present)",
  );
  log(
    !partial.container?.textContent?.includes("مرحبا"),
    "the unchecked (Arabic) conversation is genuinely excluded from the export, not just visually skipped",
    JSON.stringify({ textSample: partial.container?.textContent?.slice(0, 60) }),
  );
  log(
    !partial.container?.textContent?.includes("Conversations Export") && !partial.container?.textContent?.includes("Provider:"),
    "the exported PDF is clean -- no title-page header, no provider/date metadata, by explicit request",
  );

  if (partial.url) {
    const fetched = await fetchAsRaw(page, partial.url);
    log(Boolean(partial.name?.endsWith(".pdf")), "Export triggers a PDF file download", JSON.stringify({ download: partial.name }));
    log(
      Boolean(fetched.raw?.startsWith("%PDF-")) && fetched.byteLength > 500,
      "the downloaded file is a real, non-trivial PDF (starts with the %PDF- magic bytes)",
      JSON.stringify({ byteLength: fetched.byteLength, head: fetched.raw?.slice(0, 8) }),
    );
  } else {
    log(false, "Export triggers a PDF file download (no download captured)");
  }

  await page.close();
}

async function checkExportArabic() {
  const page = await openExportSeed();
  // Both conversations start selected (the default) -- export as-is.
  const full = await runExportAndCapture(page);
  log(
    Boolean(full.container?.textContent?.includes("remember this")) &&
      Boolean(full.container?.textContent?.includes("مرحبا")),
    "exporting with everything selected includes both the English and Arabic conversations",
  );
  const arabicParagraph = full.container?.paragraphs?.find((p) => p.text?.includes("مرحبا"));
  log(
    arabicParagraph?.dir === "auto",
    'the Arabic message is rendered with dir="auto", letting the browser\'s own bidi layout handle it correctly',
    JSON.stringify(arabicParagraph),
  );

  await page.close();
}

async function checkDeleteAll() {
  const page = await open(1366, 768);
  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 40;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["hi there"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await evaluate(page, () => {
    const ta = document.querySelector("textarea");
    const proto = window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, "should be deleted");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[aria-label="Send message"]').click();
    return true;
  });
  await sleep(700);

  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Conversations");
    tab?.click();
    return true;
  });
  await sleep(150);

  // Cancel path: data survives.
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.includes("Delete all conversations"));
    btn.click();
    return true;
  });
  await sleep(150);
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.trim() === "Cancel");
    btn.click();
    return true;
  });
  await sleep(150);
  await evaluate(page, () => {
    document.querySelector('[aria-label="Close settings"]')?.click();
    return true;
  });
  await sleep(150);
  const stillThere = await evaluate(page, () => document.body.innerText.includes("should be deleted") || document.querySelectorAll('nav[aria-label="Conversation history"] li').length > 0);
  log(stillThere, "Delete all: Cancel preserves the conversation (nothing deleted)", String(stillThere));

  // Confirm path: data actually clears, back to welcome state.
  await openSettings(page);
  await evaluate(page, () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Conversations");
    tab?.click();
    return true;
  });
  await sleep(150);
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.includes("Delete all conversations"));
    btn.click();
    return true;
  });
  await sleep(150);
  await evaluate(page, () => {
    const btn = [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')].find((b) => b.textContent?.trim() === "Delete all");
    btn.click();
    return true;
  });
  await sleep(500);
  await evaluate(page, () => {
    document.querySelector('[aria-label="Close settings"]')?.click();
    return true;
  });
  await sleep(200);
  const cleared = await evaluate(page, () => document.querySelectorAll('nav[aria-label="Conversation history"] li').length === 0);
  const welcome = await evaluate(page, () => Boolean(document.querySelector("h2")?.textContent?.includes("Welcome")));
  log(cleared && welcome, "Delete all: Confirm clears every conversation and returns to the welcome state", JSON.stringify({ cleared, welcome }));

  log(page.getApiChatInterceptCount() === 0, "zero real network requests to /api/chat for the entire settings flow", `count=${page.getApiChatInterceptCount()}`);
  await page.close();
}

/* ================================== Run ================================== */
await checkBugFix(390, 844, "phone-390");
await checkBugFix(900, 700, "tablet-900 (the reported bug range)");
await checkBugFix(1366, 768, "desktop-1366");
await checkResizeWhileOpen();
await checkAppearance();
await checkBackgroundMigration();
await checkPersonalizations();
await checkReadAloud();
await checkExportSelection();
await checkExportArabic();
await checkDeleteAll();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
