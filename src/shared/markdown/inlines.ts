import { decodeTarget, isAsciiPunctuation, safeHref } from './links.js';
import { markdownNode } from './nodes.js';
import type { MarkdownNode } from './nodes.js';

/**
 * The inline parser: emphasis and strong, inline code, links and autolinks. An image becomes its alt text, and inline
 * raw HTML (`<b>`, `<script>`) stays as the characters it is written with. It follows the CommonMark delimiter
 * algorithm (flanking rules, the "multiple of 3" rule and the per-kind lower bound on the opener search), which is
 * linear, and keeps every other scan bounded: a code span closer is found through a table of the backtick runs, and
 * a link target and title are searched for in a window of `TARGET_WINDOW` characters. There is no regular expression on
 * the text. Emphasis nests at most `MAX_INLINE_DEPTH` deep; deeper markers are shown as the characters they are
 */

export const MAX_INLINE_DEPTH = 24;
/** How far past `](` a link target and its title are looked for */
export const TARGET_WINDOW = 1024;

const BACKSLASH = 92;
const BACKTICK = 96;
const STAR = 42;
const UNDERSCORE = 95;
const LBRACKET = 91;
const RBRACKET = 93;
const BANG = 33;
const LT = 60;
const GT = 62;
const LPAREN = 40;
const RPAREN = 41;
const NEWLINE = 10;

interface Match {
    strong: boolean;
    flat: boolean;
    code: number;
}

interface Delimiter {
    code: number;
    /** The characters of the run not used by a match */
    remaining: number;
    original: number;
    canOpen: boolean;
    canClose: boolean;
    prev: Delimiter | undefined;
    next: Delimiter | undefined;
    opens: Match[];
    closes: Match[];
}

type Item =
    | { kind: 'text'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'delimiter'; delimiter: Delimiter }
    | { kind: 'open'; href: string }
    | { kind: 'close' };

interface Bracket {
    item: number;
    image: boolean;
    bottom: Delimiter;
}

const isWhitespace = (code: number): boolean =>
    code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;

const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const isPunctuation = (code: number): boolean => (code < 128 ? isAsciiPunctuation(code) : UNICODE_PUNCTUATION.test(String.fromCharCode(code)));

const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isSchemeCharacter = (code: number): boolean => isLetter(code) || (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46;

/** The index after a link target `(...)` starting at `from` (the `(`), and the target as written, or undefined */
function readTarget(text: string, from: number): { raw: string; end: number } | undefined {
    const limit = Math.min(text.length, from + 1 + TARGET_WINDOW);
    const skip = (start: number): number => {
        let at = start;
        while (at < limit) {
            const code = text.charCodeAt(at);
            if (code !== 32 && code !== 9 && code !== NEWLINE) break;
            at++;
        }
        return at;
    };
    let at = skip(from + 1);
    let raw: string;
    if (text.charCodeAt(at) === LT) {
        let end = at + 1;
        while (end < limit) {
            const code = text.charCodeAt(end);
            if (code === GT || code === NEWLINE || code === LT) break;
            end += code === BACKSLASH ? 2 : 1;
        }
        if (end >= limit || text.charCodeAt(end) !== GT) return undefined;
        raw = text.slice(at + 1, end);
        at = end + 1;
    } else {
        let depth = 0;
        let end = at;
        while (end < limit) {
            const code = text.charCodeAt(end);
            if (code <= 32 || code === 127) break;
            if (code === BACKSLASH && isAsciiPunctuation(text.charCodeAt(end + 1))) {
                end += 2;
                continue;
            }
            if (code === LPAREN) depth++;
            else if (code === RPAREN) {
                if (depth === 0) break;
                depth--;
            }
            end++;
        }
        if (depth !== 0) return undefined;
        raw = text.slice(at, end);
        at = end;
    }
    const afterTarget = at;
    at = skip(at);
    const quote = text.charCodeAt(at);
    if (at > afterTarget && at < limit && (quote === 34 || quote === 39 || quote === LPAREN)) {
        const closer = quote === LPAREN ? RPAREN : quote;
        let end = at + 1;
        while (end < limit && text.charCodeAt(end) !== closer) end += text.charCodeAt(end) === BACKSLASH ? 2 : 1;
        if (end >= limit || text.charCodeAt(end) !== closer) return undefined;
        at = skip(end + 1);
    }
    if (at >= limit || text.charCodeAt(at) !== RPAREN) return undefined;
    return { raw, end: at + 1 };
}

/** The end (index of `>`) of an autolink that starts with `<` at `from`, or -1 */
function autolinkEnd(text: string, from: number): number {
    let at = from + 1;
    if (!isLetter(text.charCodeAt(at))) return -1;
    const schemeStart = at;
    while (at < text.length && isSchemeCharacter(text.charCodeAt(at)) && at - schemeStart < 33) at++;
    if (text.charCodeAt(at) !== 58 || at - schemeStart < 2 || at - schemeStart > 32) return -1;
    at++;
    while (at < text.length) {
        const code = text.charCodeAt(at);
        if (code === GT) return at;
        if (code <= 32 || code === LT) return -1;
        at++;
    }
    return -1;
}

/** Applies the emphasis rules to the delimiters after `bottom`, recording the matches on the delimiters */
function processEmphasis(bottom: Delimiter): void {
    const lowerBounds = new Map<number, Delimiter>();
    let closer = bottom.next;
    while (closer !== undefined) {
        if (!closer.canClose || closer.remaining === 0) {
            closer = closer.next;
            continue;
        }
        const key = closer.code * 6 + (closer.canOpen ? 3 : 0) + (closer.original % 3);
        const floor = lowerBounds.get(key) ?? bottom;
        let opener = closer.prev;
        let found: Delimiter | undefined;
        while (opener !== undefined && opener !== floor && opener !== bottom) {
            const odd =
                (opener.canClose || closer.canOpen) &&
                (opener.original + closer.original) % 3 === 0 &&
                !(opener.original % 3 === 0 && closer.original % 3 === 0);
            if (opener.code === closer.code && opener.canOpen && opener.remaining > 0 && !odd) {
                found = opener;
                break;
            }
            opener = opener.prev;
        }
        if (found === undefined) {
            const after = closer.next;
            lowerBounds.set(key, closer.prev ?? bottom);
            if (!closer.canOpen) {
                if (closer.prev !== undefined) closer.prev.next = closer.next;
                if (closer.next !== undefined) closer.next.prev = closer.prev;
            }
            closer = after;
            continue;
        }
        const strong = found.remaining >= 2 && closer.remaining >= 2;
        const use = strong ? 2 : 1;
        const match: Match = { strong, flat: false, code: closer.code };
        found.remaining -= use;
        found.opens.push(match);
        closer.remaining -= use;
        closer.closes.push(match);
        found.next = closer;
        closer.prev = found;
        if (found.remaining === 0 && found.prev !== undefined) {
            found.prev.next = closer;
            closer.prev = found.prev;
        }
        if (closer.remaining === 0) {
            const after = closer.next;
            if (closer.prev !== undefined) closer.prev.next = closer.next;
            if (closer.next !== undefined) closer.next.prev = closer.prev;
            closer = after;
        }
    }
}

/** The plain text of the items from `from` on: what an image's alt text is made of */
function plainOf(items: readonly Item[], from: number): string {
    let out = '';
    for (let at = from; at < items.length; at++) {
        const item = items[at] as Item;
        if (item.kind === 'text' || item.kind === 'code') out += item.text;
        else if (item.kind === 'delimiter') out += String.fromCharCode(item.delimiter.code).repeat(item.delimiter.remaining);
    }
    return out;
}

/** Builds the nodes from the items and the matches recorded on the delimiters */
function build(items: readonly Item[]): MarkdownNode[] {
    const root = markdownNode('paragraph');
    const stack: MarkdownNode[] = [root];
    const current = (): MarkdownNode => stack[stack.length - 1] as MarkdownNode;
    const addText = (text: string): void => {
        if (text === '') return;
        const siblings = current().children;
        const last = siblings[siblings.length - 1];
        if (last !== undefined && last.type === 'text') last.text += text;
        else siblings.push(markdownNode('text', { text }));
    };
    const push = (node: MarkdownNode): void => {
        current().children.push(node);
        stack.push(node);
    };
    const pop = (): void => {
        if (stack.length > 1) stack.pop();
    };
    for (const item of items) {
        switch (item.kind) {
            case 'text':
                addText(item.text);
                break;
            case 'code':
                current().children.push(markdownNode('inlineCode', { text: item.text }));
                break;
            case 'open':
                push(markdownNode('link', { href: item.href }));
                break;
            case 'close':
                pop();
                break;
            case 'delimiter': {
                const delimiter = item.delimiter;
                const mark = String.fromCharCode(delimiter.code);
                for (const match of delimiter.closes) {
                    if (match.flat) addText(mark.repeat(match.strong ? 2 : 1));
                    else pop();
                }
                addText(mark.repeat(delimiter.remaining));
                for (let at = delimiter.opens.length - 1; at >= 0; at--) {
                    const match = delimiter.opens[at] as Match;
                    if (stack.length > MAX_INLINE_DEPTH) {
                        match.flat = true;
                        addText(mark.repeat(match.strong ? 2 : 1));
                    } else push(markdownNode(match.strong ? 'strong' : 'emphasis'));
                }
                break;
            }
        }
    }
    return root.children;
}

export function parseInline(text: string): MarkdownNode[] {
    const length = text.length;
    if (length === 0) return [];
    const items: Item[] = [];
    const brackets: Bracket[] = [];
    const head: Delimiter = { code: 0, remaining: 0, original: 0, canOpen: false, canClose: false, prev: undefined, next: undefined, opens: [], closes: [] };
    let top = head;
    let inactiveBelow = 0;
    let plain = 0;
    let at = 0;

    //the table of backtick runs: a code span closer is the next run of the same length, so no run is looked for twice
    let runs: Map<number, number[]> | undefined;
    const cursors = new Map<number, number>();
    const closerOf = (start: number, size: number): number => {
        if (runs === undefined) {
            runs = new Map();
            for (let scan = text.indexOf('`'); scan !== -1 && scan < length; ) {
                let end = scan;
                while (text.charCodeAt(end) === BACKTICK) end++;
                const starts = runs.get(end - scan);
                if (starts === undefined) runs.set(end - scan, [scan]);
                else starts.push(scan);
                scan = text.indexOf('`', end);
            }
        }
        const starts = runs.get(size);
        if (starts === undefined) return -1;
        let cursor = cursors.get(size) ?? 0;
        while (cursor < starts.length && (starts[cursor] as number) <= start) cursor++;
        cursors.set(size, cursor);
        return cursor < starts.length ? (starts[cursor] as number) : -1;
    };

    const flush = (to: number): void => {
        if (to > plain) items.push({ kind: 'text', text: text.slice(plain, to) });
    };

    while (at < length) {
        const code = text.charCodeAt(at);
        if (code === BACKSLASH) {
            if (isAsciiPunctuation(text.charCodeAt(at + 1))) {
                flush(at);
                plain = at + 1;
                at += 2;
            } else at++;
        } else if (code === BACKTICK) {
            let end = at;
            while (text.charCodeAt(end) === BACKTICK) end++;
            const size = end - at;
            const close = closerOf(at, size);
            if (close === -1) at = end;
            else {
                flush(at);
                let content = text.slice(end, close).replaceAll('\n', ' ');
                if (content.length > 2 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32 && content.trim() !== '') content = content.slice(1, -1);
                items.push({ kind: 'code', text: content });
                at = close + size;
                plain = at;
            }
        } else if (code === STAR || code === UNDERSCORE) {
            let end = at;
            while (text.charCodeAt(end) === code) end++;
            const before = at === 0 ? 32 : text.charCodeAt(at - 1);
            const after = end >= length ? 32 : text.charCodeAt(end);
            const beforeSpace = isWhitespace(before);
            const afterSpace = isWhitespace(after);
            const beforePunct = isPunctuation(before);
            const afterPunct = isPunctuation(after);
            const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
            const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
            const delimiter: Delimiter = {
                code,
                remaining: end - at,
                original: end - at,
                canOpen: code === STAR ? left : left && (!right || beforePunct),
                canClose: code === STAR ? right : right && (!left || afterPunct),
                prev: top,
                next: undefined,
                opens: [],
                closes: []
            };
            top.next = delimiter;
            top = delimiter;
            flush(at);
            items.push({ kind: 'delimiter', delimiter });
            at = end;
            plain = at;
        } else if (code === LBRACKET || (code === BANG && text.charCodeAt(at + 1) === LBRACKET)) {
            const image = code === BANG;
            flush(at);
            items.push({ kind: 'text', text: image ? '![' : '[' });
            brackets.push({ item: items.length - 1, image, bottom: top });
            at += image ? 2 : 1;
            plain = at;
        } else if (code === RBRACKET) {
            const index = brackets.length - 1;
            const bracket = brackets.pop();
            const inactive = bracket !== undefined && !bracket.image && index < inactiveBelow;
            inactiveBelow = Math.min(inactiveBelow, brackets.length);
            const target = bracket !== undefined && !inactive && text.charCodeAt(at + 1) === LPAREN ? readTarget(text, at + 1) : undefined;
            if (bracket === undefined || target === undefined) {
                at++;
                continue;
            }
            flush(at);
            processEmphasis(bracket.bottom);
            top = bracket.bottom;
            top.next = undefined;
            if (bracket.image) {
                const alt = plainOf(items, bracket.item + 1);
                items.length = bracket.item;
                if (alt !== '') items.push({ kind: 'text', text: alt });
            } else {
                const href = safeHref(target.raw);
                if (href === undefined) items[bracket.item] = { kind: 'text', text: '' };
                else {
                    items[bracket.item] = { kind: 'open', href };
                    items.push({ kind: 'close' });
                }
                inactiveBelow = brackets.length;
            }
            at = target.end;
            plain = at;
        } else if (code === LT) {
            const end = autolinkEnd(text, at);
            if (end === -1) at++;
            else {
                flush(at);
                const url = text.slice(at + 1, end);
                const href = safeHref(url);
                if (href === undefined) items.push({ kind: 'text', text: url });
                else items.push({ kind: 'open', href }, { kind: 'text', text: url }, { kind: 'close' });
                at = end + 1;
                plain = at;
            }
        } else at++;
    }
    flush(length);
    processEmphasis(head);
    return build(items);
}

export { decodeTarget, safeHref };
