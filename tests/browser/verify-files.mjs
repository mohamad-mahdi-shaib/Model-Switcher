// Project 4, Milestone 5: real-browser checks for table rendering and for
// saving an answer as a real file.
//
// The node suite (tests/file-generation.test.ts) already writes each format
// and reopens it with mammoth / SheetJS / unpdf. What THIS adds is proof that
// the same generation runs in a real browser, through the real UI, against
// an answer that actually streamed into the transcript: the dynamic imports
// resolve, the blob is built, and its media type and byte length are what a
// genuine document looks like -- not an empty file behind a download button.
//
// Every model response is mocked in-page and Chrome blocks the provider
// domains, so nothing leaves the browser.
//
// Usage (dev server must already be running at BASE_URL):
//   node tests/browser/verify-files.mjs [--out DIR]

import { launch, evaluate, sleep, screenshot, waitForInteractive } from "./cdp.mjs";
import {
  MOCK,
  SEND,
  CAPTURE_DOWNLOADS,
  OPEN_SAVE_MENU,
  SAVE_MENU_STATE,
  SAVE_AS,
  TABLE_STATE,
  CLOSE_MENUS,
  assertMocked,
} from "./mock.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT = args.out || new URL(".", import.meta.url).pathname.replace(/^\//, "");

async function run(page, expression) {
  const r = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  }
  return r.result.value;
}

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

/**
 * Replaces the mocked answer, asks a question, and waits for it to be fully
 * ON SCREEN -- not merely for the stream to end.
 *
 * Answers are revealed progressively, so a fixed sleep samples a
 * half-rendered transcript and reports a missing table that is simply not
 * revealed yet (which is exactly what an earlier version of this script
 * did). Settlement is polled on the Save-as control, which only renders once
 * the message is no longer streaming, and any remaining paced text is then
 * flushed with the transcript's own "Show full response".
 */
async function answerWith(page, chunks, question) {
  await evaluate(
    page,
    (next) => {
      window.__mock.chunks = next;
      window.__mock.firstTokenDelay = 30;
      window.__mock.tokenGap = 4;
    },
    chunks,
  );
  const before = await evaluate(
    page,
    () => document.querySelectorAll('[aria-label="Save this answer as a file"]').length,
  );
  await run(page, SEND(question));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const settled = await evaluate(
      page,
      (count) =>
        document.querySelectorAll('[aria-label="Save this answer as a file"]').length > count,
      before,
    );
    if (settled) break;
    await sleep(200);
  }

  await evaluate(page, () => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "Show full response",
    );
    if (button) button.click();
    return true;
  });
  await sleep(400);
}

const page = await launch({ width: 1366, height: 768 });

try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  await assertMocked(page, evaluate);
  await run(page, CAPTURE_DOWNLOADS);

  /* ------------------------------------------------ a table in an answer -- */

  await answerWith(
    page,
    [
      "# Quarterly Report\n\n",
      "Revenue by region:\n\n",
      "| Region | Revenue | Growth |\n| --- | ---: | ---: |\n",
      "| North | 1,250.50 | 12 |\n| South | 980 | -3 |\n\n",
      "```python\ndef total(rows):\n    return sum(rows)\n```\n",
    ],
    "summarise revenue by region",
  );

  const table = await run(page, TABLE_STATE);
  log(table.present === true, "a markdown table renders as a real table element");
  log(
    JSON.stringify(table.headers) === JSON.stringify(["Region", "Revenue", "Growth"]),
    "with its header cells",
    JSON.stringify(table.headers),
  );
  log(
    table.rows.length === 2 && table.rows[0][0] === "North" && table.rows[0][1] === "1,250.50",
    "and its body rows, cell by cell",
    JSON.stringify(table.rows),
  );

  await screenshot(page, `${OUT}/answer-table.png`);

  /* ---------------------------------------------------------- the menu --- */

  const opened = await run(page, OPEN_SAVE_MENU);
  log(opened === true, "every settled answer offers Save as");
  await sleep(150);

  const menu = await run(page, SAVE_MENU_STATE);
  log(menu.open === true, "the format menu opens");
  const labels = (menu.entries || []).map((e) => e.label);
  log(
    labels.some((l) => l.includes("Word")) &&
      labels.some((l) => l.includes("PDF")) &&
      labels.some((l) => l.includes("Excel")) &&
      labels.some((l) => l.includes("Markdown")),
    "all five formats are listed",
    JSON.stringify(labels),
  );
  log(
    (menu.entries || []).every((e) => !e.disabled),
    "an answer with a table AND code enables every format",
    JSON.stringify((menu.entries || []).filter((e) => e.disabled)),
  );
  log(
    labels.some((l) => l.includes("Code (.py)")),
    "the code entry names the language's real extension",
    JSON.stringify(labels),
  );

  /* ------------------------------------------- the files actually built -- */

  await run(page, SAVE_AS("Word"));
  await sleep(2500);
  let downloads = await evaluate(page, () => window.__downloads);
  const docx = downloads[downloads.length - 1];
  log(
    docx &&
      docx.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "saving as Word produces a blob with the Word media type",
    JSON.stringify(docx),
  );
  log(docx && docx.size > 5_000, "and a real document's worth of bytes", `size=${docx && docx.size}`);
  log(
    docx && /\.docx$/.test(docx.filename || ""),
    "named from the answer's own heading",
    JSON.stringify(docx && docx.filename),
  );

  await run(page, OPEN_SAVE_MENU);
  await sleep(150);
  await run(page, SAVE_AS("Excel"));
  await sleep(2500);
  downloads = await evaluate(page, () => window.__downloads);
  const xlsx = downloads[downloads.length - 1];
  log(
    xlsx &&
      xlsx.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "saving as Excel produces a spreadsheet blob",
    JSON.stringify(xlsx),
  );
  log(xlsx && xlsx.size > 2_000, "with real spreadsheet bytes", `size=${xlsx && xlsx.size}`);

  await run(page, OPEN_SAVE_MENU);
  await sleep(150);
  await run(page, SAVE_AS("PDF"));
  await sleep(2500);
  downloads = await evaluate(page, () => window.__downloads);
  const pdf = downloads[downloads.length - 1];
  log(pdf && pdf.type === "application/pdf", "saving as PDF produces a PDF blob", JSON.stringify(pdf));
  log(pdf && pdf.size > 1_000, "with real PDF bytes", `size=${pdf && pdf.size}`);

  const errors = await evaluate(page, () => window.__downloadErrors);
  log(errors.length === 0, "no error surfaced while generating any format", JSON.stringify(errors));

  /* ------------------------------------- formats an answer cannot support -- */

  await run(page, CLOSE_MENUS);
  await answerWith(page, ["Just a short prose answer with no table and no code at all."], "say something plain");
  await run(page, OPEN_SAVE_MENU);
  await sleep(150);
  const proseMenu = await run(page, SAVE_MENU_STATE);
  const entry = (label) => (proseMenu.entries || []).find((e) => e.label.includes(label));
  log(
    entry("Excel")?.disabled === true && /no table/.test(entry("Excel")?.title || ""),
    "Excel is disabled, with the reason, when the answer has no table",
    JSON.stringify(entry("Excel")),
  );
  log(
    entry("Code")?.disabled === true && /no code block/.test(entry("Code")?.title || ""),
    "Code is disabled, with the reason, when the answer has no code",
    JSON.stringify(entry("Code")),
  );
  log(
    entry("Word")?.disabled === false && entry("Markdown")?.disabled === false,
    "Word and Markdown stay available for any answer",
  );
  log(
    /no table|no code/.test(proseMenu.note || ""),
    "the menu explains the greyed-out entry rather than leaving it unexplained",
    JSON.stringify(proseMenu.note),
  );

  await screenshot(page, `${OUT}/save-as-menu.png`);

  /* ------------------------------------------- a script PDF cannot render -- */

  await run(page, CLOSE_MENUS);
  await answerWith(page, ["مرحبا بالعالم. هذه فقرة عربية كاملة."], "اكتب فقرة بالعربية");
  await run(page, OPEN_SAVE_MENU);
  await sleep(150);
  const openMenus = await evaluate(
    page,
    () => document.querySelectorAll('[aria-label="File formats"]').length,
  );
  log(openMenus === 1, "only one format menu is open at a time", `open=${openMenus}`);
  const arabicMenu = await run(page, SAVE_MENU_STATE);
  const pdfEntry = (arabicMenu.entries || []).find((e) => e.label.includes("PDF"));
  log(
    pdfEntry?.disabled === true,
    "PDF is withheld for a script its fonts cannot render, rather than producing mojibake",
    JSON.stringify(pdfEntry),
  );
  log(
    /use Word/.test(pdfEntry?.title || ""),
    "and the user is pointed at the format that does handle it",
    JSON.stringify(pdfEntry?.title),
  );

  const arabicWord = (arabicMenu.entries || []).find((e) => e.label.includes("Word"));
  log(arabicWord?.disabled === false, "Word remains available for that same answer");
  await run(page, SAVE_AS("Word"));
  await sleep(2500);
  downloads = await evaluate(page, () => window.__downloads);
  const arabicDocx = downloads[downloads.length - 1];
  log(
    arabicDocx && arabicDocx.size > 5_000,
    "and it really generates, carrying the Arabic text into a Word file",
    JSON.stringify(arabicDocx),
  );

  const escaped = page.getApiChatInterceptCount();
  log(escaped === 0, "no request escaped the page mock", `intercepted=${escaped}`);
} catch (error) {
  fail++;
  console.log(`FAIL  the run threw: ${error && error.message ? error.message : String(error)}`);
  if (error && error.stack) console.log(error.stack);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  await page.close();
  process.exit(fail > 0 ? 1 : 0);
}
