/**
 * Minimal ESM resolver hook so tests can import source modules that use the
 * "@/*" path alias, without a bundler or a build step. Node 24 strips the
 * TypeScript types natively. Extensions are appended because TS sources are
 * written extensionless, as the bundler expects.
 */
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = resolvePath(process.cwd(), "src");
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = resolvePath(SRC, specifier.slice(2));
  for (const candidate of [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => resolvePath(base, "index" + e)),
  ]) {
    if (existsSync(candidate) && !existsSync(resolvePath(candidate, "."))) {
      // plain file
    }
    if (existsSync(candidate)) {
      try {
        return next(pathToFileURL(candidate).href, context);
      } catch {
        // fall through to the next candidate
      }
    }
  }
  return next(specifier, context);
}
