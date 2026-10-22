// Project 4, Milestone 3: real-browser acceptance checks for the document
// workspace -- upload, the searchable-files tray, the Send lock while a file
// is being indexed, removal, failure reporting, and the actual request body
// the app sends once files are attached.
//
// Nothing reaches a provider or the dev server's own document route: every
// `/api/chat` AND `/api/documents` call is answered inside the page (see
// mock.mjs), Chrome blocks the provider domains at the network layer, and
// cdp.mjs intercepts both API paths at the Fetch layer as the fail-closed
// backstop -- so a missing mock fails the run instead of spending real
// embedding quota. `getApiChatInterceptCount()` is asserted to be 0 at the
// end, which is what proves it.
//
// Usage (dev server must already be running at BASE_URL):
//   node tests/browser/verify-documents.mjs [--out DIR]

import { launch, evaluate, sleep, screenshot, waitForInteractive } from "./cdp.mjs";
import {
  MOCK,
  SEND,
  TYPE,
  CLICK_SEND,
  PDF_BYTES,
  PNG_BYTES,
  STAGE_FILE,
  TRAY_STATE,
  REMOVE_DOCUMENT,
  OPEN_EXTRACT,
  EXTRACT_CLICK,
  EXTRACT_STATE,
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

/**
 * Runs a string expression in the page, the same way the other verify
 * scripts do -- the fixtures in mock.mjs are expression strings, not
 * functions, so they go through Runtime.evaluate directly rather than
 * through `evaluate()`'s function-serialising path.
 */
async function run(page, expression) {
  const r = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? `eval failed: ${expression.slice(0, 60)}`);
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

// `launch()` returns the page handle itself -- `send`, `on`, `close` and the
// interception counter all live on it.
const page = await launch({ width: 1366, height: 768 });

try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  await assertMocked(page, evaluate);

  /* ---------------------------------------------------------- upload ---- */

  const before = await run(page, TRAY_STATE);
  log(!before.present, "the tray is absent until a file is uploaded");

  /**
   * Two things have to be arranged before the indexing window can be
   * observed at all, and getting either wrong makes this check lie.
   *
   * The mock's upload delay must outlast `STAGE_FILE`'s own 300 ms settle
   * wait, or the upload is already finished by the time the tray is read --
   * which is exactly what an earlier version of this script did, and it
   * reported a passing Send lock that was really just an empty composer.
   *
   * And a question must already be typed, because Send is disabled on an
   * empty draft regardless of documents. With text present, Send's state
   * reflects the indexing and nothing else.
   */
  await evaluate(page, () => {
    window.__mock.documents.delay = 1500;
  });
  await run(page, TYPE("What does the contract say about termination?"));

  // Stage a PDF through the composer's own hidden file input -- the same DOM
  // path a real picker selection takes.
  await run(page, STAGE_FILE(PDF_BYTES, "contract.pdf", "application/pdf"));

  const during = await run(page, TRAY_STATE);
  log(during.present, "the tray appears as soon as a file is picked");
  log(
    during.chips.some((c) => /Reading and indexing/.test(c.text)),
    "an in-flight upload reports that it is being read and indexed",
    JSON.stringify(during.chips.map((c) => c.text)),
  );
  log(
    during.sendDisabled === true,
    "Send is locked while a file is still being indexed, even with a question typed",
    `sendDisabled=${during.sendDisabled}`,
  );
  log(
    /Send unlocks once/.test(during.notice || ""),
    "the notice explains why Send is locked",
    JSON.stringify(during.notice),
  );

  await sleep(1800);
  const after = await run(page, TRAY_STATE);
  log(
    after.chips.some((c) => c.text.includes("contract.pdf")),
    "the indexed file stays in the tray, named",
    JSON.stringify(after.chips.map((c) => c.text)),
  );
  log(
    after.chips.some((c) => /12 pages|12 sections/.test(c.text)),
    "the chip reports what retrieval can cite (pages/sections)",
    JSON.stringify(after.chips.map((c) => c.text)),
  );
  log(
    /searched on every question/.test(after.explainer || ""),
    "the tray explains that the file is searched on every question",
    JSON.stringify(after.explainer),
  );
  log(
    after.sendDisabled === false,
    "Send unlocks once the file is searchable",
    `sendDisabled=${after.sendDisabled}`,
  );

  const uploads = await evaluate(page, () => window.__mock.documents.uploads);
  log(
    uploads.length === 1 && uploads[0].name === "contract.pdf" && uploads[0].size > 0,
    "exactly one upload was issued, carrying the real file",
    JSON.stringify(uploads),
  );
  log(
    Boolean(uploads[0] && uploads[0].conversationId),
    "the upload is bound to a conversation id",
    JSON.stringify(uploads[0] && uploads[0].conversationId),
  );

  /* ------------------------------------------- the request that follows -- */

  await run(page, CLICK_SEND);
  await sleep(1400);

  /**
   * A deliberate product choice, pinned here because it is easy to "fix"
   * into a bug: an uploaded file alone does NOT enable Send. The composer is
   * empty again after that send and a searchable file is still attached, yet
   * Send stays disabled -- a file is not a question, and because the tray
   * persists for the whole conversation, enabling Send on its presence would
   * leave an empty-question trap armed indefinitely. (A staged IMAGE does
   * enable Send, with a generated prompt, because it is transient and
   * belongs to the turn being composed.)
   */
  const emptyDraft = await run(page, TRAY_STATE);
  log(
    emptyDraft.sendDisabled === true,
    "a file alone is not a question: Send stays disabled on an empty draft",
    `sendDisabled=${emptyDraft.sendDisabled}`,
  );

  const sent = await evaluate(page, () => window.__sent);
  const body = sent[sent.length - 1];
  log(
    Array.isArray(body.documentIds) && body.documentIds.length === 1,
    "the question is sent with the conversation's document ids",
    JSON.stringify(body.documentIds),
  );
  log(
    typeof body.conversationId === "string" && body.conversationId.length > 0,
    "the conversation id is sent alongside them",
  );
  log(
    /^[A-Za-z0-9_-]{43,86}$/.test(body.documentIds[0] || ""),
    "the id sent is the server's own capability id, not a client-made one",
    JSON.stringify(body.documentIds),
  );

  /* ------------------------------------------- images still go inline ---- */

  await run(page, STAGE_FILE(PNG_BYTES, "shot.png", "image/png"));
  await sleep(700);
  const afterImage = await run(page, TRAY_STATE);
  const imageUploads = await evaluate(page, () => window.__mock.documents.uploads.length);
  log(
    imageUploads === 1,
    "an image is NOT sent to the document route -- it stays on the vision path",
    `document uploads=${imageUploads}`,
  );
  log(
    !afterImage.chips.some((c) => c.text.includes("shot.png")),
    "an image does not appear in the searchable-files tray",
  );
  const attachmentTray = await evaluate(page, () => {
    const tray = document.querySelector('[aria-label="Attached files"]');
    return tray ? tray.textContent : null;
  });
  log(
    /shot\.png/.test(attachmentTray || ""),
    "the image appears in the attachment tray instead",
    JSON.stringify(attachmentTray),
  );

  await screenshot(page, `${OUT}/documents-tray.png`);

  /* ------------------------------------- Milestone 4: structured extraction */

  const opened = await run(page, OPEN_EXTRACT);
  log(opened === true, "the tray offers an Extract action once a file is indexed");
  await sleep(200);

  const dialog = await run(page, EXTRACT_STATE);
  log(dialog.open === true, "the extraction dialog opens");
  log(
    /Invoice/.test(dialog.text) && /Contract/.test(dialog.text),
    "both registered schemas are offered",
    JSON.stringify(dialog.buttons),
  );

  await run(page, EXTRACT_CLICK("Extract invoice fields"));
  await sleep(700);
  const extracted = await run(page, EXTRACT_STATE);

  const request = await evaluate(page, () => window.__mock.extract.requests);
  log(
    request.length === 1 && request[0].schema === "invoice" && Boolean(request[0].documentId),
    "the extraction request names the document and the chosen schema",
    JSON.stringify(request),
  );
  log(
    Boolean(request[0] && request[0].conversationId),
    "and the conversation it is bound to",
    JSON.stringify(request[0] && request[0].conversationId),
  );

  const rowFor = (label) => (extracted.rows.find((row) => row[0] === label) || [])[1];
  log(rowFor("Vendor") === "Northwind Ltd", "extracted values render in the field table", rowFor("Vendor"));
  log(rowFor("Total") === "1750", "numbers render without inventing formatting", rowFor("Total"));
  log(
    rowFor("Notes") === "not found",
    'a field the document did not contain reads "not found" rather than vanishing',
    JSON.stringify(rowFor("Notes")),
  );
  log(
    extracted.warnings.length === 1 && /1800\.00/.test(extracted.warnings[0]),
    "the arithmetic discrepancy is shown, above the table that would otherwise look settled",
    JSON.stringify(extracted.warnings),
  );
  log(
    /9 of 10 fields found/.test(extracted.text),
    "the found/total tally is stated",
    (extracted.text.match(/\d+ of \d+ fields found[^·]*/) || [""])[0].trim(),
  );
  log(/from p\. 1, p\. 2/.test(extracted.text), "the pages the values came from are named");
  log(extracted.tables === 2, "the line items get their own table", `tables=${extracted.tables}`);
  log(
    extracted.rows.some((row) => row[0] === "Consulting" && row[3] === "1000"),
    "line items render row by row",
    JSON.stringify(extracted.rows.filter((row) => row[0] === "Consulting")),
  );
  log(
    extracted.buttons.some((b) => b === "JSON") && extracted.buttons.some((b) => b === "Excel"),
    "both downloads are offered",
    JSON.stringify(extracted.buttons),
  );

  await screenshot(page, `${OUT}/extraction-panel.png`);

  // The downloads must not throw. A click cannot be followed to disk from
  // here (headless Chrome discards it), so what is asserted is that building
  // the file -- including SheetJS's dynamic import and real .xlsx write --
  // completes without an error reaching the page.
  const downloadErrors = await evaluate(page, () => {
    window.__downloadErrors = [];
    window.addEventListener("error", (event) => window.__downloadErrors.push(String(event.message)));
    window.addEventListener("unhandledrejection", (event) =>
      window.__downloadErrors.push(String(event.reason)),
    );
    return true;
  });
  void downloadErrors;
  await run(page, EXTRACT_CLICK("JSON"));
  await run(page, EXTRACT_CLICK("Excel"));
  await sleep(1200);
  const errors = await evaluate(page, () => window.__downloadErrors || []);
  log(errors.length === 0, "generating both downloads raises no error", JSON.stringify(errors));

  // A failing extraction must say so rather than showing an empty table.
  await evaluate(page, () => {
    window.__mock.extract.failNextWith = {
      status: 502,
      code: "INVALID_OUTPUT",
      detail: "The extracted data did not match the schema — total: expected number.",
    };
  });
  await run(page, EXTRACT_CLICK("Extract invoice fields"));
  await sleep(700);
  const failedExtraction = await run(page, EXTRACT_STATE);
  log(
    /did not match the schema/.test(failedExtraction.text),
    "a validation failure is reported in the server's own words",
  );
  log(
    !/Northwind/.test(failedExtraction.text),
    "and the previous result is cleared, never left looking current",
  );

  const clickedClose = await run(page, EXTRACT_CLICK("Close extraction"));
  await sleep(200);
  const closed = await run(page, EXTRACT_STATE);
  log(clickedClose === true && closed.open === false, "the dialog closes", `clicked=${clickedClose}`);

  /* ------------------------------------------------------- failure ------- */

  // Back to a short delay (the long one above existed only to make the
  // in-flight window observable), and a question typed again so Send's state
  // reflects the failed upload rather than an empty draft.
  await evaluate(page, () => {
    window.__mock.documents.delay = 150;
    window.__mock.documents.failNextWith = {
      status: 415,
      detail: "scanned.pdf contains no extractable text — it looks like a scan.",
    };
  });
  await run(page, TYPE("what about this one?"));
  await run(page, STAGE_FILE(PDF_BYTES, "scanned.pdf", "application/pdf"));
  await sleep(800);
  const failed = await run(page, TRAY_STATE);
  log(
    failed.chips.some((c) => /looks like a scan/.test(c.text)),
    "a rejected file keeps a chip carrying the server's own reason",
    JSON.stringify(failed.chips.map((c) => c.text)),
  );
  log(
    failed.sendDisabled === false,
    "a failed upload does not lock Send -- the question can still be asked",
    `sendDisabled=${failed.sendDisabled}`,
  );

  await run(page, REMOVE_DOCUMENT("scanned.pdf"));
  await sleep(300);
  const dismissed = await run(page, TRAY_STATE);
  log(
    !dismissed.chips.some((c) => c.text.includes("scanned.pdf")),
    "a failed chip can be dismissed",
  );

  /* -------------------------------------------------------- removal ------ */

  await run(page, REMOVE_DOCUMENT("contract.pdf"));
  await sleep(400);
  const removed = await run(page, TRAY_STATE);
  log(
    !removed.chips.some((c) => c.text.includes("contract.pdf")),
    "removing a file takes it out of the tray",
  );
  const deletes = await evaluate(page, () => window.__mock.documents.deletes);
  log(
    deletes.length === 1 && /id=.*conversationId=/.test(deletes[0]),
    "removal also deletes it server-side, presenting both ids",
    JSON.stringify(deletes),
  );

  await run(page, SEND("and now with no files attached?"));
  await sleep(1200);
  const sentAfterRemoval = await evaluate(page, () => window.__sent);
  const last = sentAfterRemoval[sentAfterRemoval.length - 1];
  log(
    last.documentIds === undefined && last.conversationId === undefined,
    "with no files left, the request carries no document fields at all",
    JSON.stringify({ documentIds: last.documentIds, conversationId: last.conversationId }),
  );

  /* ---------------------------------------------------- reload survives -- */

  await page.send("Page.navigate", { url: BASE_URL });
  await waitForInteractive(page, evaluate);
  const afterReload = await run(page, TRAY_STATE);
  log(
    !afterReload.present,
    "after removing every file, none come back on reload",
    JSON.stringify(afterReload.chips.map((c) => c.text)),
  );

  /* ------------------------------------------------ the isolation proof -- */

  const escaped = page.getApiChatInterceptCount();
  log(
    escaped === 0,
    "no /api/chat or /api/documents request escaped the page mock",
    `intercepted=${escaped}`,
  );
} catch (error) {
  // Without this, `process.exit` in `finally` discards the exception and the
  // run reports "0 passed, 0 failed" with no clue why.
  fail++;
  console.log(`FAIL  the run threw: ${error && error.message ? error.message : String(error)}`);
  if (error && error.stack) console.log(error.stack);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  await page.close();
  process.exit(fail > 0 ? 1 : 0);
}
