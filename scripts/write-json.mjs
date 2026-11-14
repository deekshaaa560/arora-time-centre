/**
 * Write a file by renaming a temporary one over it. Several passes run
 * concurrently - the nightly audit, a sourcing sweep, the repair - and a reader
 * that hits the millisecond a writer is halfway through gets a truncated JSON
 * file and dies with "Unexpected end of JSON input". A rename is atomic, so a
 * reader sees the old file or the new one, never a half of either.
 */
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeJson(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  // On Windows a rename over a file another process has open fails with EPERM -
  // and this file sits in OneDrive, which opens it to sync, while the dev server
  // holds it for hot reload. Try the atomic path a few times (the lock is usually
  // momentary), then fall back to writing in place, which is what every pass here
  // did before and what a reader can survive: the only real risk is a reader
  // catching a half-written file, and the passes that read it re-run anyway.
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      last = e;
      sleep(250 * (attempt + 1));
    }
  }
  try {
    fs.writeFileSync(file, text);
    fs.rmSync(tmp, { force: true });
  } catch (e) {
    throw last || e;
  }
}

/**
 * Drop rows the shop removed on purpose (scripts/remove-rows.mjs records them in
 * tmp/removed-rows.txt). Any pass that holds the catalogue in memory and writes the
 * whole array back would otherwise resurrect them: the long gallery repair reads the
 * file once, runs for an hour, and by then a hand removal has happened.
 */
export function pruneRemoved(catalog, root = process.cwd()) {
  const ledger = path.join(root, "tmp/removed-rows.txt");
  if (!fs.existsSync(ledger)) return catalog;
  const gone = new Set(
    fs
      .readFileSync(ledger, "utf8")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return catalog.filter((w) => !gone.has(w.id));
}
