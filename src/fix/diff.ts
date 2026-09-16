/**
 * A unified diff of what a fix would write, so the default mode of `lurq fix`
 * is something a human reviews and `git apply` accepts — not a list of byte
 * offsets, and not a file already overwritten.
 *
 * No diff algorithm here on purpose. A general text diff has to guess which
 * lines correspond; we are not guessing, because the edits themselves say
 * exactly which ranges change. The hunks are computed from those ranges, so the
 * output is exact by construction rather than a plausible alignment.
 */
import { applyEdits, type Edit } from './types';

/** Context lines around a change. Three is what review tools and `git apply` expect. */
const CONTEXT = 3;

/**
 * Required by the format whenever a side's last line has no newline after it.
 * Omitting it does not merely look wrong: `git apply` refuses the entire patch.
 */
const NO_EOL = '\\ No newline at end of file\n';

/** Offset where each line begins, so an edit range maps to line numbers. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Line index containing `offset`, by binary search over line starts. */
function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Hunk {
  edits: Edit[];
  firstLine: number;
  lastLine: number;
}

/**
 * One hunk per cluster of changed lines. Two changes closer than twice the
 * context would print overlapping context, which is not a valid patch, so they
 * merge into one hunk.
 */
function hunksFor(edits: Edit[], starts: number[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    const firstLine = lineOf(starts, e.start);
    // `end` is exclusive: an edit ending at a newline does not touch the next line.
    const lastLine = lineOf(starts, Math.max(e.start, e.end - 1));
    const open = hunks[hunks.length - 1];
    if (open && firstLine - open.lastLine <= CONTEXT * 2 + 1) {
      open.edits.push(e);
      open.lastLine = Math.max(open.lastLine, lastLine);
    } else {
      hunks.push({ edits: [e], firstLine, lastLine });
    }
  }
  return hunks;
}

/**
 * Unified diff for one file. Returns '' for no edits.
 *
 * Throws through `applyEdits` when an edit is stale or out of range, which is
 * the point: the preview and the write share one implementation, so a diff that
 * prints is a diff that would apply.
 */
export function unifiedDiff(file: string, before: string, edits: Edit[]): string {
  if (edits.length === 0) return '';
  const starts = lineStarts(before);
  const lines = before.split('\n');
  // A trailing newline makes split() yield a final '' that is not a line.
  const lastRealLine = before.endsWith('\n') ? lines.length - 2 : lines.length - 1;

  let out = `--- a/${file}\n+++ b/${file}\n`;
  let delta = 0;
  for (const hunk of hunksFor(edits, starts)) {
    const from = Math.max(0, hunk.firstLine - CONTEXT);
    const to = Math.min(lastRealLine, hunk.lastLine + CONTEXT);
    const sliceStart = starts[from]!;
    const sliceEnd = to + 1 < starts.length ? starts[to + 1]! - 1 : before.length;
    const oldText = before.slice(sliceStart, sliceEnd);
    const newText = applyEdits(
      oldText,
      hunk.edits.map((e) => ({ ...e, start: e.start - sliceStart, end: e.end - sliceStart })),
    );
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const head = hunk.firstLine - from;
    const tail = to - hunk.lastLine;

    // A file with no final newline needs the marker, or `git apply` rejects the
    // whole patch. Both sides carry it: the slice never ends in a newline, so
    // if the file has none, neither side does.
    const atEOF = to === lastRealLine && !before.endsWith('\n');

    out += `@@ -${from + 1},${oldLines.length} +${from + 1 + delta},${newLines.length} @@\n`;
    for (let i = 0; i < head; i++) out += ` ${oldLines[i]}\n`;
    for (let i = head; i < oldLines.length - tail; i++) out += `-${oldLines[i]}\n`;
    if (atEOF && tail === 0) out += NO_EOL;
    for (let i = head; i < newLines.length - tail; i++) out += `+${newLines[i]}\n`;
    if (atEOF && tail === 0) out += NO_EOL;
    for (let i = tail; i > 0; i--) out += ` ${oldLines[oldLines.length - i]}\n`;
    if (atEOF && tail > 0) out += NO_EOL;
    delta += newLines.length - oldLines.length;
  }
  return out;
}
