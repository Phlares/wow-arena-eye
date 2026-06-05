import { openSync, readSync, closeSync } from 'node:fs';

const RE = /BUILD_VERSION,([^,]+),/;

/** Read the WoW client build (e.g. "12.0.5") from a combat log's header line. null if absent.
 *  Reads only the first ~4 KB (the header is the first line) — cheap on multi-GB logs. */
export function readBuildVersion(logPath: string): string | null {
  const fd = openSync(logPath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString('utf8', 0, n);
    const m = head.match(RE);
    return m ? m[1].trim() : null;
  } finally { closeSync(fd); }
}
