#!/usr/bin/env node
/**
 * Placeholder guard.
 *
 * Fails the build when an unresolved user-facing placeholder token would ship,
 * e.g. [SUPPORT_EMAIL] or [DELETION_RESPONSE_COMMITMENT].
 *
 * The generic pattern deliberately requires ALL_CAPS *with at least one
 * underscore* so that ordinary source constructs never match:
 *   []  [0]  [i]  string[]  arr[IDX]  [A]  [Symbol.iterator]  ->  ignored
 *   [SUPPORT_EMAIL]  [DELETION_RESPONSE_COMMITMENT]           ->  flagged
 *
 * Scans production-relevant source, and the built output too when dist/ exists.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();

// Roots that end up in front of a user.
const SCAN_ROOTS = ["src", "public", "dist"];
const SCAN_FILES = ["index.html"];

// Text formats only — never try to read images, fonts or archives.
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".json", ".webmanifest", ".txt", ".svg",
]);

// Documentation is authored prose and may legitimately discuss tokens.
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "docs"]);

const EXPLICIT = ["[SUPPORT_EMAIL]", "[DELETION_RESPONSE_COMMITMENT]"];
const GENERIC = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.has(extname(entry.name))) yield full;
  }
}

function collectFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const full = join(ROOT, root);
    if (existsSync(full) && statSync(full).isDirectory()) files.push(...walk(full));
  }
  for (const file of SCAN_FILES) {
    const full = join(ROOT, file);
    if (existsSync(full)) files.push(full);
  }
  return files;
}

const findings = [];
let scanned = 0;

for (const file of collectFiles()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  scanned++;

  const hits = new Set();
  for (const token of EXPLICIT) if (text.includes(token)) hits.add(token);
  for (const match of text.matchAll(GENERIC)) hits.add(match[0]);
  if (hits.size === 0) continue;

  // Report the first line each distinct token appears on.
  const lines = text.split("\n");
  for (const token of hits) {
    const index = lines.findIndex((line) => line.includes(token));
    findings.push({
      file: relative(ROOT, file),
      line: index + 1,
      token,
    });
  }
}

if (findings.length > 0) {
  console.error(
    `\nPlaceholder guard FAILED — ${findings.length} unresolved placeholder token(s) found:\n`
  );
  for (const { file, line, token } of findings) {
    console.error(`  ${file}:${line}  ${token}`);
  }
  console.error(
    "\nReplace these with real content before shipping. " +
      "If a token is legitimate, narrow the pattern in scripts/check-placeholders.mjs.\n"
  );
  process.exit(1);
}

console.log(`Placeholder guard passed — ${scanned} file(s) scanned, no unresolved tokens.`);
