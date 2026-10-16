// Finding U3 (independent follow-up review): a dedicated NEGATIVE test.
// Deliberately does NOT install mock.mjs's MOCK script -- the point is to
// prove that even with nothing in the page's own JS mocking `/api/chat`, a
// real request to it can never actually reach this app's real dev server
// (and so can never reach a real provider), because it is caught at the CDP
// `Fetch` network layer, outside the page's JS entirely. See cdp.mjs's own
// comment on `API_CHAT_PATTERN` for the full mechanism.
//
// No real credentials are needed or used to prove this: the claim is about
// the request never leaving the browser process at all, which is true
// regardless of what key (if any) the dev server has configured.
//
// Usage: node tests/browser/verify-network-isolation.mjs
// Requires a local Chrome (see CHROME_PATH in cdp.mjs) and the dev server
// already running at BASE_URL. Not part of `npm test`.

import { launch, evaluate, sleep } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const page = await launch({ width: 1366, height: 768 });

// No MOCK script installed here, deliberately -- window.fetch is the real,
// native fetch for the whole life of this page.
await page.send("Page.navigate", { url: BASE_URL });
// The app's own GET /api/chat availability probe fires on mount -- which, on
// a dev server that may still be compiling, is not a fixed number of
// milliseconds after `Page.navigate`. Poll for the interception instead of
// guessing a delay: with no mock installed there is nothing else that can
// satisfy this, so a real timeout here still fails the check honestly.
for (let waited = 0; page.getApiChatInterceptCount() === 0 && waited < 40000; waited += 200) {
  await sleep(200);
}

const afterLoad = page.getApiChatInterceptCount();
log(
  afterLoad > 0,
  "1. the app's own GET /api/chat availability probe, made with NO mock installed at all, was caught and failed at the network layer before it could reach the real dev server",
  `interceptCount=${afterLoad}`,
);

// A short settle delay: interception happens at the CDP network layer,
// before the app's own `fetch()` promise has even rejected back into its
// JS -- there are still several async hops (promise rejection, the app's
// own `.catch()`, `setAvailability({})`, React's re-render) between "CDP
// intercepted it" (just confirmed above) and "the DOM reflects the
// composer's own resulting disabled state" (checked next). Checking
// immediately, same tick, intermittently read the DOM before that chain
// finished.
await sleep(300);

// Confirm the app itself actually observed that failure honestly (it did
// not silently pretend the probe succeeded) -- the composer should now be
// disabled, since availability could not be determined.
const degraded = await evaluate(page, () => {
  const ta = document.querySelector("textarea");
  return { disabled: ta ? ta.disabled : null };
});
log(
  degraded.disabled === true,
  "2. the app degrades safely when its own network is unavailable -- the composer is disabled rather than allowing a send that could not possibly succeed",
  JSON.stringify(degraded),
);

// The direct, precise test of the mechanism itself: attempt a raw POST to
// /api/chat exactly as the real composer would, bypassing the UI so this
// does not depend on the composer's own (separately correct) disabled state
// above. This must fail at the network level, never reach the real server,
// and never return an HTTP response of any kind.
const beforeAttempt = page.getApiChatInterceptCount();
const attempt = await evaluate(page, async () => {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gemini",
        messages: [{ role: "user", content: "this must never reach a real provider" }],
      }),
    });
    return { reached: true, status: res.status };
  } catch (e) {
    return { reached: false, error: String(e) };
  }
});
const afterAttempt = page.getApiChatInterceptCount();
log(
  attempt.reached === false,
  "3. a raw POST /api/chat, issued directly with no mock installed, throws a network failure rather than returning any real HTTP response",
  JSON.stringify(attempt),
);
log(
  afterAttempt > beforeAttempt,
  "4. ...and the interception counter confirms this was genuinely caught by the Fetch-layer block, not some unrelated failure -- proof the request never left the browser process, so it could never have reached the real dev server or a real provider even if the server had a live key configured",
  `before=${beforeAttempt} after=${afterAttempt}`,
);

await page.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
