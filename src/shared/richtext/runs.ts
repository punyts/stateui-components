import { MARKS, normalizeRuns, plainText } from './model.js';
import type { Mark, Run } from './model.js';

/**
 * Character ranges over a block's runs. Offsets count UTF-16 code units, as the DOM's selection offsets do, so a point
 * taken from the page is an offset here. Every function returns runs in their one form (`normalizeRuns`)
 */

/** The runs covering `[from, to)` of a block's text, with their marks and links */
export function sliceRuns(runs: readonly Run[], from: number, to: number): Run[] {
    const sliced: Run[] = [];
    let at = 0;
    for (const run of runs) {
        const start = at;
        const end = at + run.text.length;
        at = end;
        if (end <= from || start >= to) continue;
        const text = run.text.slice(Math.max(0, from - start), Math.min(run.text.length, to - start));
        if (text !== '') sliced.push({ ...run, text });
    }
    return normalizeRuns(sliced);
}

/** Runs joined end to end */
export function joinRuns(...lists: ReadonlyArray<readonly Run[]>): Run[] {
    return normalizeRuns(lists.flat());
}

/** Runs with `inserted` put in at `offset` */
export function insertRuns(runs: readonly Run[], offset: number, inserted: readonly Run[]): Run[] {
    const length = plainText(runs).length;
    return joinRuns(sliceRuns(runs, 0, offset), inserted, sliceRuns(runs, offset, length));
}

/** Runs with `[from, to)` taken out */
export function deleteRuns(runs: readonly Run[], from: number, to: number): Run[] {
    const length = plainText(runs).length;
    return joinRuns(sliceRuns(runs, 0, from), sliceRuns(runs, to, length));
}

/** The run holding the character at `index`, or undefined past the end */
function runAt(runs: readonly Run[], index: number): Run | undefined {
    let at = 0;
    for (const run of runs) {
        if (index < at + run.text.length) return run;
        at += run.text.length;
    }
    return undefined;
}

/**
 * What typed text at `offset` takes: the marks of the character before it (of the first character at the start), and a
 * link only when the characters on both sides share it, so typing at the end of a link does not lengthen it
 */
export function styleAt(runs: readonly Run[], offset: number): { marks: Mark[]; link?: string } {
    const before = offset > 0 ? runAt(runs, offset - 1) : runAt(runs, 0);
    const after = runAt(runs, offset);
    const marks = [...(before?.marks ?? [])];
    const link = offset > 0 && before?.link !== undefined && before.link === after?.link ? before.link : undefined;
    return link === undefined ? { marks } : { marks, link };
}

/** Whether every character in `[from, to)` has `mark`; an empty range has it when the style at `from` has it */
export function hasMark(runs: readonly Run[], from: number, to: number, mark: Mark): boolean {
    if (from >= to) return styleAt(runs, from).marks.includes(mark);
    return sliceRuns(runs, from, to).every((run) => (run.marks ?? []).includes(mark));
}

/** Runs with `mark` added to (or, with `on` false, taken from) every character in `[from, to)` */
export function markRuns(runs: readonly Run[], from: number, to: number, mark: Mark, on: boolean): Run[] {
    const length = plainText(runs).length;
    const middle = sliceRuns(runs, from, to).map((run) => {
        const marks = new Set(run.marks ?? []);
        if (on) marks.add(mark);
        else marks.delete(mark);
        const next: Run = { text: run.text, marks: MARKS.filter((known) => marks.has(known)) };
        if (run.link !== undefined) next.link = run.link;
        if (run.mention !== undefined) next.mention = run.mention;
        return next;
    });
    return joinRuns(sliceRuns(runs, 0, from), middle, sliceRuns(runs, to, length));
}

/** The mention whose characters are on both sides of `offset`, as `[from, to)`; null when the offset is not inside one */
export function atomAround(runs: readonly Run[], offset: number): { from: number; to: number } | null {
    let at = 0;
    for (const run of runs) {
        const end = at + run.text.length;
        if (run.mention !== undefined && at < offset && offset < end) return { from: at, to: end };
        if (end >= offset) return null;
        at = end;
    }
    return null;
}

/** Runs with every character in `[from, to)` linked to `href`, or unlinked when it is null; marks are kept */
export function linkRuns(runs: readonly Run[], from: number, to: number, href: string | null): Run[] {
    const length = plainText(runs).length;
    const middle = sliceRuns(runs, from, to).map((run) => {
        const next: Run = { text: run.text };
        if (run.marks !== undefined) next.marks = run.marks;
        if (run.mention !== undefined) next.mention = run.mention;
        else if (href !== null) next.link = href;
        return next;
    });
    return joinRuns(sliceRuns(runs, 0, from), middle, sliceRuns(runs, to, length));
}

/** The stretch `[from, to)` around `offset` whose characters share one link, or null when no link touches it (the character before the offset counts first) */
export function linkExtent(runs: readonly Run[], offset: number): { href: string; from: number; to: number } | null {
    const bounds: Array<{ run: Run; start: number; end: number }> = [];
    let at = 0;
    for (const run of runs) {
        bounds.push({ run, start: at, end: at + run.text.length });
        at += run.text.length;
    }
    const hit = bounds.findIndex((bound) => bound.run.link !== undefined && bound.start < offset && offset <= bound.end);
    const index = hit >= 0 ? hit : bounds.findIndex((bound) => bound.run.link !== undefined && bound.start === offset);
    const found = bounds[index];
    if (found === undefined || found.run.link === undefined) return null;
    const href = found.run.link;
    let first = index;
    let last = index;
    while (bounds[first - 1]?.run.link === href) first--;
    while (bounds[last + 1]?.run.link === href) last++;
    return { href, from: (bounds[first] as { start: number }).start, to: (bounds[last] as { end: number }).end };
}

const graphemes =typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;
const words = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : undefined;

/** How far a delete reaches: one character as the reader sees it, a word, or the rest of the line */
export type DeleteUnit = 'character' | 'word' | 'line';

/** The offset a backward delete of one `unit` from `offset` reaches */
export function previousBoundary(text: string, offset: number, unit: DeleteUnit): number {
    if (offset <= 0) return 0;
    if (unit === 'line') {
        const newline = text.lastIndexOf('\n', offset - 1);
        return newline === offset - 1 ? offset - 1 : newline + 1;
    }
    if (unit === 'word' && words !== undefined) {
        let start = 0;
        for (const segment of words.segment(text.slice(0, offset))) if (segment.isWordLike === true) start = segment.index;
        //with no word before the offset, only the spaces go
        return start < offset ? start : 0;
    }
    if (graphemes !== undefined) {
        let start = 0;
        for (const segment of graphemes.segment(text.slice(0, offset))) start = segment.index;
        return start;
    }
    const code = text.charCodeAt(offset - 1);
    return code >= 0xdc00 && code <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1;
}

/** The offset a forward delete of one `unit` from `offset` reaches */
export function nextBoundary(text: string, offset: number, unit: DeleteUnit): number {
    if (offset >= text.length) return text.length;
    if (unit === 'line') {
        const newline = text.indexOf('\n', offset);
        return newline === -1 ? text.length : newline === offset ? offset + 1 : newline;
    }
    if (unit === 'word' && words !== undefined) {
        for (const segment of words.segment(text.slice(offset))) {
            if (segment.isWordLike === true) return offset + segment.index + segment.segment.length;
        }
        return text.length;
    }
    if (graphemes !== undefined) {
        for (const segment of graphemes.segment(text.slice(offset))) return offset + segment.segment.length;
    }
    const code = text.charCodeAt(offset);
    return code >= 0xd800 && code <= 0xdbff ? offset + 2 : offset + 1;
}
