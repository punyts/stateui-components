/**
 * A QR code encoder (ISO/IEC 18004) for `qrCode`: byte mode with UTF-8 text, versions 1 to 40, the four error
 * correction levels and the mask with the least penalty. It returns the modules as rows of booleans and, for the view,
 * one SVG path of unit squares. It needs no network and no library; it follows the published algorithm step by step:
 * the data bits, the Reed-Solomon codewords per block, the interleaving, the function patterns, the zigzag placement,
 * the eight masks and their penalty, and the format and version bits
 */

/** An error correction level: about 7, 15, 25 or 30% of the codewords can be restored */
export type QrLevel = 'low' | 'medium' | 'quartile' | 'high';

export const QR_LEVELS: readonly QrLevel[] = ['low', 'medium', 'quartile', 'high'];

/** The two format bits of each level, as the standard numbers them */
const FORMAT_BITS: Readonly<Record<QrLevel, number>> = { low: 1, medium: 0, quartile: 3, high: 2 };

const LEVEL_INDEX: Readonly<Record<QrLevel, number>> = { low: 0, medium: 1, quartile: 2, high: 3 };

/** Error correction codewords per block, by level and version (index 0 unused) */
const ECC_PER_BLOCK: readonly (readonly number[])[] = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];

/** Error correction blocks, by level and version (index 0 unused) */
const BLOCKS: readonly (readonly number[])[] = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

/** The modules of a version that hold data and error correction bits: all but the function patterns */
export function rawDataModules(version: number): number {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const align = Math.floor(version / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (version >= 7) result -= 36;
    }
    return result;
}

/** The data codewords a version and level hold */
export function dataCodewords(version: number, level: QrLevel): number {
    const index = LEVEL_INDEX[level];
    return Math.floor(rawDataModules(version) / 8) - (ECC_PER_BLOCK[index]?.[version] ?? 0) * (BLOCKS[index]?.[version] ?? 0);
}

/** The most bytes of text a version and level hold in byte mode */
export function byteCapacity(version: number, level: QrLevel): number {
    const countBits = version <= 9 ? 8 : 16;
    return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8);
}

/** Multiplies two elements of GF(256) with the QR code's polynomial 0x11D */
function multiply(x: number, y: number): number {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

/** The Reed-Solomon generator polynomial of a degree, highest term first and its leading 1 left out */
function generator(degree: number): number[] {
    const result: number[] = new Array<number>(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = multiply(result[j] as number, root);
            if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
        }
        root = multiply(root, 0x02);
    }
    return result;
}

/** The Reed-Solomon error correction codewords of a block of data codewords */
export function reedSolomon(data: readonly number[], degree: number): number[] {
    const divisor = generator(degree);
    const result: number[] = new Array<number>(degree).fill(0);
    for (const byte of data) {
        const factor = byte ^ (result.shift() as number);
        result.push(0);
        for (let i = 0; i < degree; i++) result[i] = (result[i] as number) ^ multiply(divisor[i] as number, factor);
    }
    return result;
}

/** The centres of the alignment patterns of a version along either axis */
export function alignmentPositions(version: number): number[] {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
}

/** The 15 format bits of a level and mask, with their BCH code and the standard's XOR mask */
export function formatBits(level: QrLevel, mask: number): number {
    const data = (FORMAT_BITS[level] << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    return ((data << 10) | remainder) ^ 0x5412;
}

/** The 18 version bits of a version (7 and up), with their BCH code */
export function versionBits(version: number): number {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    return (version << 12) | remainder;
}

/** Whether the mask flips the module at a row and column */
export function maskBit(mask: number, row: number, column: number): boolean {
    switch (mask) {
        case 0: return (row + column) % 2 === 0;
        case 1: return row % 2 === 0;
        case 2: return column % 3 === 0;
        case 3: return (row + column) % 3 === 0;
        case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
        case 5: return ((row * column) % 2) + ((row * column) % 3) === 0;
        case 6: return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
        default: return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
    }
}

/** A QR code: its version, level, mask and modules, `true` for dark */
export interface QrCode {
    readonly version: number;
    readonly level: QrLevel;
    readonly mask: number;
    readonly size: number;
    readonly modules: readonly (readonly boolean[])[];
}

/** The grid while it is built: the modules and which of them belong to function patterns */
class Grid {
    readonly modules: boolean[][];
    readonly reserved: boolean[][];

    constructor(readonly size: number) {
        this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
        this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    }

    set(row: number, column: number, dark: boolean): void {
        (this.modules[row] as boolean[])[column] = dark;
        (this.reserved[row] as boolean[])[column] = true;
    }
}

/** Draws a finder pattern centred at a row and column, with its light separator */
function drawFinder(grid: Grid, row: number, column: number): void {
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const r = row + dy;
            const c = column + dx;
            if (r < 0 || r >= grid.size || c < 0 || c >= grid.size) continue;
            const distance = Math.max(Math.abs(dx), Math.abs(dy));
            grid.set(r, c, distance !== 2 && distance !== 4);
        }
    }
}

function drawAlignment(grid: Grid, row: number, column: number): void {
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) grid.set(row + dy, column + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
}

function drawFormat(grid: Grid, level: QrLevel, mask: number): void {
    const bits = formatBits(level, mask);
    const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
    const size = grid.size;
    for (let i = 0; i <= 5; i++) grid.set(i, 8, bit(i));
    grid.set(7, 8, bit(6));
    grid.set(8, 8, bit(7));
    grid.set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) grid.set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) grid.set(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) grid.set(size - 15 + i, 8, bit(i));
    grid.set(size - 8, 8, true);
}

function drawVersion(grid: Grid, version: number): void {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = grid.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        grid.set(a, b, dark);
        grid.set(b, a, dark);
    }
}

function drawFunctionPatterns(grid: Grid, version: number, level: QrLevel): void {
    const size = grid.size;
    for (let i = 0; i < size; i++) {
        grid.set(6, i, i % 2 === 0);
        grid.set(i, 6, i % 2 === 0);
    }
    drawFinder(grid, 3, 3);
    drawFinder(grid, 3, size - 4);
    drawFinder(grid, size - 4, 3);
    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((row, i) => {
        positions.forEach((column, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            drawAlignment(grid, row, column);
        });
    });
    drawFormat(grid, level, 0);
    drawVersion(grid, version);
}

/** Splits the data into blocks, adds each block's error correction and interleaves them */
function interleave(data: readonly number[], version: number, level: QrLevel): number[] {
    const index = LEVEL_INDEX[level];
    const blockCount = BLOCKS[index]?.[version] as number;
    const eccLength = ECC_PER_BLOCK[index]?.[version] as number;
    const raw = Math.floor(rawDataModules(version) / 8);
    const shortBlocks = blockCount - (raw % blockCount);
    const shortLength = Math.floor(raw / blockCount);
    const blocks: number[][] = [];
    const eccs: number[][] = [];
    for (let i = 0, k = 0; i < blockCount; i++) {
        const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
        const block = data.slice(k, k + length);
        k += length;
        blocks.push(block);
        eccs.push(reedSolomon(block, eccLength));
    }
    const result: number[] = [];
    const longest = shortLength - eccLength + 1;
    for (let i = 0; i < longest; i++) {
        for (const block of blocks) if (i < block.length) result.push(block[i] as number);
    }
    for (let i = 0; i < eccLength; i++) for (const ecc of eccs) result.push(ecc[i] as number);
    return result;
}

/** Places the codewords' bits in the zigzag order, two columns at a time from the bottom right, skipping the timing column */
function placeCodewords(grid: Grid, codewords: readonly number[]): void {
    const size = grid.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vertical = 0; vertical < size; vertical++) {
            for (let j = 0; j < 2; j++) {
                const column = right - j;
                const upward = ((right + 1) & 2) === 0;
                const row = upward ? size - 1 - vertical : vertical;
                if ((grid.reserved[row] as boolean[])[column] === true) continue;
                if (i < codewords.length * 8) {
                    (grid.modules[row] as boolean[])[column] = (((codewords[i >>> 3] as number) >>> (7 - (i & 7))) & 1) === 1;
                    i++;
                }
            }
        }
    }
}

function applyMask(grid: Grid, mask: number): void {
    for (let row = 0; row < grid.size; row++) {
        for (let column = 0; column < grid.size; column++) {
            if ((grid.reserved[row] as boolean[])[column] !== true && maskBit(mask, row, column)) {
                const modules = grid.modules[row] as boolean[];
                modules[column] = !modules[column];
            }
        }
    }
}

/** The standard's penalty of a masked grid: runs, 2x2 blocks, finder-like patterns and the balance of dark modules */
export function penalty(modules: readonly (readonly boolean[])[]): number {
    const size = modules.length;
    const at = (row: number, column: number): boolean => (modules[row] as readonly boolean[])[column] === true;
    let result = 0;
    const lines = (read: (a: number, b: number) => boolean): void => {
        for (let a = 0; a < size; a++) {
            let run = 0;
            let previous = false;
            const pattern: boolean[] = [];
            for (let b = 0; b < size; b++) {
                const dark = read(a, b);
                if (b > 0 && dark === previous) run++;
                else {
                    if (run >= 5) result += run - 2;
                    run = 1;
                    previous = dark;
                }
                pattern.push(dark);
            }
            if (run >= 5) result += run - 2;
            const text = pattern.map((dark) => (dark ? '1' : '0')).join('');
            for (const finder of ['10111010000', '00001011101']) {
                for (let from = text.indexOf(finder); from >= 0; from = text.indexOf(finder, from + 1)) result += 40;
            }
        }
    };
    lines((row, column) => at(row, column));
    lines((column, row) => at(row, column));
    for (let row = 0; row < size - 1; row++) {
        for (let column = 0; column < size - 1; column++) {
            const dark = at(row, column);
            if (dark === at(row, column + 1) && dark === at(row + 1, column) && dark === at(row + 1, column + 1)) result += 3;
        }
    }
    let dark = 0;
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) if (at(row, column)) dark++;
    const total = size * size;
    result += Math.ceil(Math.abs(dark * 20 - total * 10) / total - 1) * 10;
    return result;
}

/** The data codewords of text in byte mode for a version and level: mode, count, bytes, terminator and padding */
function dataBits(bytes: Uint8Array, version: number, level: QrLevel): number[] {
    const bits: number[] = [];
    const push = (value: number, length: number): void => {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, version <= 9 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);
    const capacity = dataCodewords(version, level) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    const codewords: number[] = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
    return codewords;
}

/**
 * Encodes text as a QR code in byte mode, UTF-8, at the smallest version that holds it at `level`. Returns undefined
 * when the text is longer than version 40 holds (2953 bytes at `low`)
 */
export function encodeQr(text: string, level: QrLevel = 'medium'): QrCode | undefined {
    const bytes = new TextEncoder().encode(text);
    let version = 1;
    while (version <= 40 && byteCapacity(version, level) < bytes.length) version++;
    if (version > 40) return undefined;
    const codewords = interleave(dataBits(bytes, version, level), version, level);
    const size = version * 4 + 17;
    let best: { mask: number; modules: boolean[][]; score: number } | undefined;
    for (let mask = 0; mask < 8; mask++) {
        const grid = new Grid(size);
        drawFunctionPatterns(grid, version, level);
        placeCodewords(grid, codewords);
        applyMask(grid, mask);
        drawFormat(grid, level, mask);
        const score = penalty(grid.modules);
        if (best === undefined || score < best.score) best = { mask, modules: grid.modules, score };
    }
    const chosen = best as { mask: number; modules: boolean[][] };
    return { version, level, mask: chosen.mask, size, modules: chosen.modules };
}

/**
 * One SVG path of the dark modules, a unit square each, offset by a quiet zone of `margin` modules: runs of dark modules
 * in a row are joined into one rectangle to keep the path short
 */
export function qrPath(code: QrCode, margin = 4): string {
    const parts: string[] = [];
    code.modules.forEach((row, y) => {
        let x = 0;
        while (x < code.size) {
            if (row[x] !== true) {
                x++;
                continue;
            }
            const start = x;
            while (x < code.size && row[x] === true) x++;
            parts.push(`M${start + margin} ${y + margin}h${x - start}v1h${start - x}z`);
        }
    });
    return parts.join('');
}
