import { alignmentPositions, byteCapacity, encodeQr, formatBits, qrPath, reedSolomon, versionBits } from './qr.js';
import type { QrCode, QrLevel } from './qr.js';

/** Which modules a reader treats as function patterns, worked out here apart from the encoder's own drawing */
function functionModules(size: number): boolean[][] {
    const version = (size - 17) / 4;
    const marked = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    const mark = (row: number, column: number): void => {
        if (row >= 0 && row < size && column >= 0 && column < size) (marked[row] as boolean[])[column] = true;
    };
    for (let i = 0; i < size; i++) {
        mark(6, i);
        mark(i, 6);
    }
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) mark(r, c);
    for (let r = 0; r < 9; r++) for (let c = size - 8; c < size; c++) mark(r, c);
    for (let r = size - 8; r < size; r++) for (let c = 0; c < 9; c++) mark(r, c);
    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((row, i) =>
        positions.forEach((column, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(row + dr, column + dc);
        })
    );
    if (version >= 7) {
        for (let a = size - 11; a < size - 8; a++) {
            for (let b = 0; b < 6; b++) {
                mark(a, b);
                mark(b, a);
            }
        }
    }
    return marked;
}

/** Reads the format bits of the first copy, as a scanner does */
function readFormat(code: QrCode): number {
    const at = (row: number, column: number): number => ((code.modules[row] as readonly boolean[])[column] ? 1 : 0);
    const bits: number[] = [];
    for (let i = 0; i <= 5; i++) bits[i] = at(i, 8);
    bits[6] = at(7, 8);
    bits[7] = at(8, 8);
    bits[8] = at(8, 7);
    for (let i = 9; i < 15; i++) bits[i] = at(8, 14 - i);
    return bits.reduce((value, bit, i) => value | (bit << i), 0);
}

/** Reads every codeword in placement order, unmasked with the mask the format names */
function readCodewords(code: QrCode, mask: number): number[] {
    const size = code.size;
    const reserved = functionModules(size);
    const flips: ((r: number, c: number) => boolean)[] = [
        (r, c) => (r + c) % 2 === 0,
        (r) => r % 2 === 0,
        (_r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
        (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
        (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];
    const bits: number[] = [];
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let step = 0; step < size; step++) {
            const row = upward ? size - 1 - step : step;
            for (const column of [right, right - 1]) {
                if ((reserved[row] as boolean[])[column]) continue;
                const dark = (code.modules[row] as readonly boolean[])[column] === true;
                bits.push(dark !== (flips[mask] as (r: number, c: number) => boolean)(row, column) ? 1 : 0);
            }
        }
        upward = !upward;
    }
    const codewords: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    return codewords;
}

/** Parses byte-mode data codewords back to text */
function parseBytes(data: readonly number[], version: number): string {
    const bits = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
    let at = 0;
    const take = (length: number): number => {
        let value = 0;
        for (let i = 0; i < length; i++) value = (value << 1) | (bits[at++] as number);
        return value;
    };
    expect(take(4)).toBe(0b0100);
    const count = take(version <= 9 ? 8 : 16);
    return new TextDecoder().decode(Uint8Array.from({ length: count }, () => take(8)));
}

const LEVELS: readonly QrLevel[] = ['low', 'medium', 'quartile', 'high'];

describe('qr', () => {
    it('should hold the byte capacities the standard lists', () => {
        // Assert
        expect(LEVELS.map((level) => byteCapacity(1, level))).toEqual([17, 14, 11, 7]);
        expect(LEVELS.map((level) => byteCapacity(40, level))).toEqual([2953, 2331, 1663, 1273]);
        expect(byteCapacity(10, 'medium')).toBe(213);
    });

    it('should compute the error correction codewords of the HELLO WORLD example at 1-Q', () => {
        // Arrange
        const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];

        // Act
        const ecc = reedSolomon(data, 13);

        // Assert
        expect(ecc).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
    });

    it('should give the format and version bits of the standard tables', () => {
        // Assert
        expect(formatBits('low', 0).toString(2).padStart(15, '0')).toBe('111011111000100');
        expect(formatBits('low', 1).toString(2).padStart(15, '0')).toBe('111001011110011');
        expect(formatBits('medium', 0).toString(2).padStart(15, '0')).toBe('101010000010010');
        expect(formatBits('quartile', 0).toString(2).padStart(15, '0')).toBe('011010101011111');
        expect(formatBits('high', 0).toString(2).padStart(15, '0')).toBe('001011010001001');
        expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
        expect(alignmentPositions(7)).toEqual([6, 22, 38]);
        expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    });

    it('should encode text that a reader gets back, with the format of its level and mask, in a single block', () => {
        // Arrange
        const text = 'https://example.com/tickets/42?seat=14C';

        // Act
        const code = encodeQr(text, 'low') as QrCode;
        const format = readFormat(code);
        const codewords = readCodewords(code, code.mask);

        // Assert
        expect(code.version).toBe(3);
        expect(code.size).toBe(29);
        expect(format).toBe(formatBits('low', code.mask));
        expect(parseBytes(codewords.slice(0, 55), code.version)).toBe(text);
        expect((code.modules[code.size - 8] as readonly boolean[])[8]).toBe(true);
    });

    it('should interleave four blocks at 7-M so a reader that takes every fourth codeword gets the text back', () => {
        // Arrange
        const text = 'Grüße aus München! '.repeat(5).slice(0, 100) + ' Ticket 0042';

        // Act
        const code = encodeQr(text, 'medium') as QrCode;
        const codewords = readCodewords(code, code.mask);
        const data: number[] = [];
        for (let block = 0; block < 4; block++) for (let i = 0; i < 31; i++) data.push(codewords[i * 4 + block] as number);
        const read = (r: number, c: number): number => ((code.modules[r] as readonly boolean[])[c] ? 1 : 0);
        let version = 0;
        for (let i = 0; i < 18; i++) version |= read(code.size - 11 + (i % 3), Math.floor(i / 3)) << i;

        // Assert
        expect(code.version).toBe(7);
        expect(version).toBe(versionBits(7));
        expect(parseBytes(data, 7)).toBe(text);
        for (let block = 0; block < 4; block++) {
            const blockData = data.slice(block * 31, block * 31 + 31);
            const ecc = Array.from({ length: 18 }, (_, i) => codewords[124 + i * 4 + block]);
            expect(ecc).toEqual(reedSolomon(blockData, 18));
        }
    });

    it('should pick a larger version for a higher level, and refuse text past version 40', () => {
        // Act
        const low = encodeQr('x'.repeat(100), 'low') as QrCode;
        const high = encodeQr('x'.repeat(100), 'high') as QrCode;

        // Assert
        expect(low.version).toBeLessThan(high.version);
        expect(encodeQr('x'.repeat(2953), 'low')?.version).toBe(40);
        expect(encodeQr('x'.repeat(2954), 'low')).toBeUndefined();
    });

    it('should draw the dark modules as one path inside a quiet zone, a run of a row as one rectangle', () => {
        // Arrange
        const code = encodeQr('A', 'low') as QrCode;

        // Act
        const path = qrPath(code);

        // Assert
        expect(path.startsWith('M4 4h7v1h-7z')).toBe(true);
        expect(path).not.toMatch(/[^MhvzM0-9 -]/);
    });
});
