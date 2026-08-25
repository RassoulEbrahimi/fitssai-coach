#!/usr/bin/env node
/**
 * Mojibake guard.
 *
 * Fails the build when text that was UTF-8, misread as CP1252/Latin-1 and
 * re-encoded, would ship — e.g. "hinzugefÃ¼gt" instead of "hinzugefügt".
 *
 * Detection is deliberately conservative. It does not flag any single
 * non-ASCII character: legitimate German (ü, ä, ö, ß), emoji and typographic
 * punctuation must all pass untouched. A finding requires a mojibake *lead*
 * character (Â Ã â ð ñ) immediately followed by characters that only a
 * CP1252 round-trip produces — and the run must actually decode back to
 * valid UTF-8, which is what separates real corruption from a coincidence.
 *
 * Also flags U+FFFD (the replacement character), which is always data loss.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = ["src", "public"];
const SCAN_FILES = ["index.html"];

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".json", ".webmanifest", ".txt", ".svg", ".md",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

// Characters that a UTF-8 -> CP1252 -> UTF-8 round-trip can emit.
const LEAD = "ÂÃâðñ";
const CONT =
  "-ÿ" +
  "ŒœŠšŸŽžƒˆ˜" +
  "–—‘’‚“”„" +
  "†‡•…‰‹›€™";
const RUN = new RegExp(`[${LEAD}][${CONT}]+`, "g");
const REPLACEMENT = /�/g;

// CP1252 high range, for the round-trip test.
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

const decoder = new TextDecoder("utf-8", { fatal: true });

/** True when `run` really is double-encoded UTF-8 rather than incidental text. */
function decodesAsUtf8(run) {
  const bytes = new Uint8Array(run.length);
  for (let i = 0; i < run.length; i++) {
    const code = run.codePointAt(i);
    if (code > 0xffff) return false;
    const byte = code <= 0xff ? code : CP1252_HIGH[code];
    if (byte === undefined) return false;
    bytes[i] = byte;
  }
  try {
    const decoded = decoder.decode(bytes);
    return decoded !== run && !decoded.includes("�");
  } catch {
    return false;
  }
}

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

  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(RUN)) {
      if (!decodesAsUtf8(match[0])) continue;
      findings.push({
        file: relative(ROOT, file),
        line: index + 1,
        found: match[0],
        expected: decoder.decode(
          Uint8Array.from([...match[0]].map((c) => {
            const code = c.codePointAt(0);
            return code <= 0xff ? code : CP1252_HIGH[code];
          }))
        ),
      });
    }
    if (REPLACEMENT.test(line)) {
      REPLACEMENT.lastIndex = 0;
      findings.push({
        file: relative(ROOT, file),
        line: index + 1,
        found: "U+FFFD",
        expected: "(irrecoverable — original character was lost)",
      });
    }
  });
}

if (findings.length > 0) {
  console.error(`\nMojibake guard FAILED — ${findings.length} broken sequence(s) found:\n`);
  for (const { file, line, found, expected } of findings) {
    console.error(`  ${file}:${line}  ${JSON.stringify(found)} -> should be ${JSON.stringify(expected)}`);
  }
  console.error("\nRe-save the affected file as UTF-8 without double-encoding.\n");
  process.exit(1);
}

console.log(`Mojibake guard passed — ${scanned} file(s) scanned, no broken sequences.`);
