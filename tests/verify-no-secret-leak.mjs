// Project 4, Milestone 6: proves no configured secret VALUE reaches the
// browser bundle.
//
// The usual defences are structural -- keys are read only inside
// `src/server/**`, nothing is prefixed NEXT_PUBLIC_, and no client component
// imports a server module. Those are all checkable by eye and all of them
// can be broken by one careless import. This checks the artefact instead:
// the actual JavaScript the browser downloads, searched for the actual
// values in `.env.local`.
//
// It prints counts and variable NAMES only. A value is never written to
// stdout, so the output is safe to paste into a report or a PR.
//
// Usage:
//   npm run build && node tests/verify-no-secret-leak.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIRS = [".next/static", "public"];
/** Values shorter than this are not credentials and would match by accident. */
const MIN_SECRET_LENGTH = 12;

function readEnvSecrets(path) {
  if (!existsSync(path)) return [];
  const secrets = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (value.length >= MIN_SECRET_LENGTH) secrets.push({ name: match[1], value });
  }
  return secrets;
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

const secrets = [...readEnvSecrets(".env.local"), ...readEnvSecrets(".env")];
if (secrets.length === 0) {
  console.log("No local secrets found to check for. Nothing to verify.");
  process.exit(0);
}

const files = CLIENT_DIRS.flatMap(filesUnder);
if (files.length === 0) {
  console.error("FAIL  no built client output found -- run `npm run build` first.");
  process.exit(1);
}

let leaks = 0;
for (const file of files) {
  const content = readFileSync(file);
  for (const secret of secrets) {
    if (content.includes(secret.value)) {
      leaks += 1;
      // The NAME, so it can be rotated; never the value.
      console.error(`LEAK  ${secret.name} appears in ${file}`);
    }
  }
}

console.log(
  `${leaks === 0 ? "PASS" : "FAIL"}  ${secrets.length} secret value(s) checked against ` +
    `${files.length} client file(s): ${leaks} leak(s) found.`,
);
process.exit(leaks === 0 ? 0 : 1);
