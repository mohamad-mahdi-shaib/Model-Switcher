// Dedicated regression for Finding U5, second pass (independent follow-up
// review, "One focused check" section): the switch-confirmation dialog's
// buttons must receive real pointer input in the approved glass mode, not
// just visually sit above the backdrop. A synthetic DOM `.click()` cannot
// prove this -- it fires the target's own handler directly and never asks
// the browser which element is actually frontmost at a point. Every click
// here goes through `clickAt()` (tests/browser/cdp.mjs), which dispatches
// real `Input.dispatchMouseEvent` sequences and so exercises the same
// hit-testing pipeline a real mouse would.
//
// Kept as its own file (mirroring verify-network-isolation.mjs) rather than
// folded into verify.mjs's existing F8 block. It was written when this app
// shipped two glass materials, to prove the dialog hit-tested correctly in
// each; the UI-update pass removed Glowy Glass, so it now runs once, for
// the one remaining material (Clear Glass). The checks themselves are
// unchanged and still worth their own file -- they are the only ones that
// drive the dialog with real pointer input rather than synthetic clicks.
//
// Usage:
//   node tests/browser/verify-dialog-hit-testing.mjs
//
// Not picked up by `npm test` (see tests/*.test.ts glob in package.json);
// run on demand, same as verify.mjs and verify-network-isolation.mjs.

import { launch, evaluate, sleep, clickAt, waitForInteractive } from "./cdp.mjs";
import { MOCK, SEND, assertMocked } from "./mock.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

async function centerOf(page, textRe, scope = "button") {
  return evaluate(
    page,
    ({ textRe, scope }) => {
      const re = new RegExp(textRe);
      const btn = [...document.querySelectorAll(scope)].find((b) => re.test(b.textContent?.trim() || ""));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    },
    { textRe: textRe.source, scope },
  );
}

/**
 * Responsive UI refinement: the provider selector is now a single dropdown
 * trigger, not two always-visible chips -- selecting a provider is opening
 * the trigger, then clicking the option inside the listbox it reveals.
 * Mirrors the identically-named helper in verify.mjs (see its own comment
 * for why the evaluated function is `async` and awaits a real paint frame
 * between the two clicks, rather than doing both synchronously); kept local
 * rather than imported, matching this file's existing preference for a
 * small, fully self-contained script (see its own header comment).
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

// Chatgpt-style trigger: just the provider label + a chevron icon (no text
// of its own), so the button's whole textContent is the label.
const currentProvider = (page) =>
  evaluate(page, () => document.querySelector('[aria-haspopup="listbox"]')?.textContent?.trim());

async function checkGlassMode(glassMode) {
  const page = await launch({ width: 1366, height: 768 });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  await assertMocked(page, evaluate);

  // UI-update pass: there is one glass material now (Clear Glass, internal
  // id `ultra`), so nothing has to be selected first -- it is the default
  // and the only option. This file used to run twice, once per material,
  // selecting Clear Glass through the Appearance picker on the second pass;
  // that loop is gone with the material it covered. The hit-testing
  // coverage below is unchanged.
  const confirmedGlass = await evaluate(page, () => document.querySelector(".workspace-root")?.getAttribute("data-glass"));
  log(confirmedGlass === glassMode, `[${glassMode}] the requested glass mode is actually active`, `data-glass=${confirmedGlass}`);

  await evaluate(page, () => {
    window.__mock.firstTokenDelay = 60;
    window.__mock.tokenGap = 10;
    window.__mock.chunks = ["ok"];
    window.__mock.doneOutcome = "complete";
    return true;
  });
  await page.send("Runtime.evaluate", { expression: SEND("hi"), awaitPromise: true });
  await sleep(400);

  // Open the dialog (Gemini -> OpenAI).
  await selectProvider(page, "OpenAI");
  await sleep(150);

  // 1/2: elementFromPoint resolves to the real button, not the backdrop.
  const hitTest = await evaluate(page, () => {
    function probe(re) {
      const btn = [...document.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() || ""));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { isButton: top === btn || btn.contains(top) };
    }
    return { cancel: probe(/^Cancel$/), switchModel: probe(/Switch model/) };
  });
  log(hitTest.cancel?.isButton === true, `[${glassMode}] elementFromPoint over Cancel resolves to the button`, JSON.stringify(hitTest.cancel));
  log(hitTest.switchModel?.isButton === true, `[${glassMode}] elementFromPoint over Switch model resolves to the button`, JSON.stringify(hitTest.switchModel));

  // 3: a real pointer click on Cancel closes without switching.
  let rect = await centerOf(page, /^Cancel$/);
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  let after = {
    dialogOpen: await evaluate(page, () => Boolean(document.querySelector('[role="dialog"]'))),
    provider: await currentProvider(page),
  };
  log(!after.dialogOpen && after.provider === "Gemini", `[${glassMode}] real pointer click on Cancel closes without switching`, JSON.stringify(after));

  // 4: reopen; a real pointer click on Switch model closes AND switches.
  await selectProvider(page, "OpenAI");
  await sleep(150);
  rect = await centerOf(page, /Switch model/);
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  after = {
    dialogOpen: await evaluate(page, () => Boolean(document.querySelector('[role="dialog"]'))),
    provider: await currentProvider(page),
  };
  log(!after.dialogOpen && after.provider === "OpenAI", `[${glassMode}] real pointer click on Switch model closes AND switches to OpenAI`, JSON.stringify(after));

  // 5: an outside click (sidebar control) dismisses without activating it.
  await selectProvider(page, "Gemini");
  await sleep(150);
  const rowsBefore = await evaluate(page, () => document.querySelectorAll("aside li").length);
  rect = await centerOf(page, /^New chat$/, "aside button");
  await clickAt(page, rect.cx, rect.cy);
  await sleep(200);
  after = {
    dialogOpen: await evaluate(page, () => Boolean(document.querySelector('[role="dialog"]'))),
    provider: await currentProvider(page),
  };
  const rowsAfter = await evaluate(page, () => document.querySelectorAll("aside li").length);
  log(
    !after.dialogOpen && after.provider === "OpenAI" && rowsAfter === rowsBefore,
    `[${glassMode}] outside click (sidebar) dismisses without switching or starting a new conversation`,
    JSON.stringify({ after, rowsBefore, rowsAfter }),
  );

  // 6: Tab/Shift+Tab/Escape/focus-restoration still hold in this glass mode.
  await selectProvider(page, "Gemini");
  await sleep(150);
  const initialFocus = await evaluate(page, () => document.activeElement?.textContent?.trim());
  log(/Switch model/.test(initialFocus || ""), `[${glassMode}] opening the dialog focuses Switch model`, JSON.stringify(initialFocus));

  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(150);
  const afterEscape = await evaluate(page, () => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    // Step 6 reopened the dialog via the Gemini option (provider was OpenAI
    // at that point, from step 4), so the initiating trigger still reads
    // "Gemini" (the switch to it was never confirmed).
    focusedIsTrigger: document.activeElement?.getAttribute("aria-haspopup") === "listbox",
  }));
  log(!afterEscape.dialogOpen && afterEscape.focusedIsTrigger, `[${glassMode}] Escape closes the dialog and returns focus to the initiating trigger`, JSON.stringify(afterEscape));

  await page.close();
}

await checkGlassMode("ultra");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
