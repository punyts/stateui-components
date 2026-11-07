import { describe, expect, it } from 'vitest';
import { PAINT_TOOLS, UNDO_LIMIT, addPoint, clampPoint, createPaintLog, isPaintTool, isShapeTool, strokeColor } from './strokes.js';
import type { PaintEntry, PaintPoint, Stroke } from './strokes.js';

const stroke = (n: number, tool: Stroke['tool'] = 'brush'): Stroke => ({ tool, color: '#000', size: 2, points: [{ x: n, y: n }] });

const numberOf = (entry: PaintEntry | undefined): number | string | undefined =>
    entry === undefined ? undefined : entry.kind === 'clear' ? 'clear' : entry.stroke.points[0].x;

describe('tools', () => {
    it('should know the brush, the eraser, the shapes and the fill (G2.6b)', () => {
        expect(PAINT_TOOLS).toEqual(['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill']);
        expect(isPaintTool('brush')).toBe(true);
        expect(isPaintTool('eraser')).toBe(true);
        expect(isPaintTool('fill')).toBe(true);
        expect(isPaintTool('spray')).toBe(false);
        expect(isPaintTool(undefined)).toBe(false);
        expect(['line', 'rect', 'ellipse'].every(isShapeTool)).toBe(true);
        expect(isShapeTool('fill')).toBe(false);
        expect(isShapeTool('brush')).toBe(false);
    });

    it('should count a shape or a fill as painted, and an eraser alone as blank', () => {
        for (const tool of ['line', 'rect', 'ellipse', 'fill'] as const) {
            const log = createPaintLog();
            log.push(stroke(1, 'eraser'));
            expect(log.blank).toBe(true);
            log.push(stroke(2, tool));
            expect(log.blank).toBe(false);
        }
    });
});

describe('strokeColor', () => {
    const read = (name: string): string => (name === '--ui-color-accent-base' ? ' #3366ff ' : '');

    it('should keep a literal', () => {
        expect(strokeColor('#ff0000')).toBe('#ff0000');
        expect(strokeColor('rgba(0, 0, 0, 0.5)', read)).toBe('rgba(0, 0, 0, 0.5)');
    });

    it('should resolve a token to its computed colour through the paint resolver', () => {
        expect(strokeColor('{color.accent.base}', read)).toBe('#3366ff');
    });

    it('should give nothing for a token it cannot read, a paint name or a value that is not a colour', () => {
        expect(strokeColor('{color.accent.base}')).toBeUndefined();
        expect(strokeColor('{color.missing}', read)).toBeUndefined();
        expect(strokeColor('sky', read)).toBeUndefined();
        expect(strokeColor(12, read)).toBeUndefined();
        expect(strokeColor('', read)).toBeUndefined();
    });

    it('should keep the colour a stroke resolved when the theme changes', () => {
        let accent = '#111111';
        const theme = (name: string): string => (name === '--ui-color-accent-base' ? accent : '');
        const log = createPaintLog();
        log.push({ tool: 'brush', color: strokeColor('{color.accent.base}', theme) as string, size: 2, points: [{ x: 1, y: 1 }] });
        accent = '#eeeeee';
        const entry = log.entries[0];
        expect(entry.kind === 'stroke' && entry.stroke.color).toBe('#111111');
    });
});

describe('points', () => {
    it('should clamp a point into the canvas and refuse one that is not a number', () => {
        expect(clampPoint({ x: -5, y: 120 }, 100, 50)).toEqual({ x: 0, y: 50 });
        expect(clampPoint({ x: 10, y: 20 }, 100, 50)).toEqual({ x: 10, y: 20 });
        expect(clampPoint({ x: Number.NaN, y: 1 }, 100, 50)).toBeUndefined();
        expect(clampPoint({ x: '1', y: 1 }, 100, 50)).toBeUndefined();
    });

    it('should leave out a point that repeats the last one', () => {
        const points: PaintPoint[] = [];
        expect(addPoint(points, { x: 10, y: 10 }, 100, 100)).toBe(true);
        expect(addPoint(points, { x: 10.2, y: 10.1 }, 100, 100)).toBe(false);
        expect(addPoint(points, { x: 12, y: 10 }, 100, 100)).toBe(true);
        expect(addPoint(points, { x: 500, y: -500 }, 100, 100)).toBe(true);
        expect(addPoint(points, { x: 600, y: -1 }, 100, 100)).toBe(false);
        expect(points).toEqual([
            { x: 10, y: 10 },
            { x: 12, y: 10 },
            { x: 100, y: 0 }
        ]);
    });
});

describe('createPaintLog', () => {
    it('should undo and redo strokes in order', () => {
        const log = createPaintLog();
        expect(log.canUndo).toBe(false);
        expect(log.undo()).toBeUndefined();
        log.push(stroke(1));
        log.push(stroke(2));
        log.push(stroke(3));
        expect(numberOf(log.undo())).toBe(3);
        expect(numberOf(log.undo())).toBe(2);
        expect(log.entries.map(numberOf)).toEqual([1]);
        expect(log.canRedo).toBe(true);
        expect(numberOf(log.redo())).toBe(2);
        expect(log.entries.map(numberOf)).toEqual([1, 2]);
        expect(numberOf(log.redo())).toBe(3);
        expect(log.redo()).toBeUndefined();
    });

    it('should drop the redo stack on a new stroke', () => {
        const log = createPaintLog();
        log.push(stroke(1));
        log.push(stroke(2));
        log.undo();
        log.push(stroke(9));
        expect(log.canRedo).toBe(false);
        expect(log.redo()).toBeUndefined();
        expect(log.entries.map(numberOf)).toEqual([1, 9]);
    });

    it('should clear as an entry undo takes back, and not clear a blank painting', () => {
        const log = createPaintLog();
        expect(log.blank).toBe(true);
        expect(log.clear()).toBe(false);
        log.push(stroke(1));
        expect(log.blank).toBe(false);
        expect(log.clear()).toBe(true);
        expect(log.blank).toBe(true);
        expect(log.clear()).toBe(false);
        expect(log.entries.map(numberOf)).toEqual([1, 'clear']);
        expect(log.undo()?.kind).toBe('clear');
        expect(log.blank).toBe(false);
    });

    it('should count an eraser alone as painting nothing', () => {
        const log = createPaintLog();
        log.push(stroke(1, 'eraser'));
        expect(log.blank).toBe(true);
        log.push(stroke(2));
        log.push(stroke(3, 'eraser'));
        expect(log.blank).toBe(false);
    });

    it('should keep 200 entries and flatten the oldest, in order', () => {
        const flattened: (number | string | undefined)[] = [];
        const log = createPaintLog({ onFlatten: (entry) => flattened.push(numberOf(entry)) });
        for (let i = 1; i <= 250; i++) log.push(stroke(i));
        expect(UNDO_LIMIT).toBe(200);
        expect(log.entries).toHaveLength(200);
        expect(flattened).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
        let undone = 0;
        while (log.undo() !== undefined) undone++;
        expect(undone).toBe(200);
        expect(log.undo()).toBeUndefined();
        expect(log.canUndo).toBe(false);
        // The flattened strokes are still painted
        expect(log.blank).toBe(false);
        expect(flattened).toHaveLength(50);
    });

    it('should flatten a clear into the base, so the base is blank again', () => {
        const log = createPaintLog({ limit: 2 });
        log.push(stroke(1));
        log.clear();
        log.push(stroke(2, 'eraser'));
        log.push(stroke(3, 'eraser'));
        log.undo();
        log.undo();
        expect(log.canUndo).toBe(false);
        expect(log.blank).toBe(true);
    });

    it('should forget everything on reset', () => {
        const log = createPaintLog({ limit: 1 });
        log.push(stroke(1));
        log.push(stroke(2));
        log.undo();
        log.reset();
        expect(log.entries).toEqual([]);
        expect(log.canRedo).toBe(false);
        expect(log.blank).toBe(true);
    });
});
