import { parsePathData } from '@punyts/stateui-app/core';
import { describe, expect, it } from 'vitest';
import { arcCenter, buildPath } from './canvasPath.js';
import type { PathSink } from './canvasPath.js';

/** A path sink that records each call, numbers rounded */
function recorder(): PathSink & { calls: string[] } {
    const calls: string[] = [];
    const round = (n: number): number => Math.round(n * 1000) / 1000;
    const record =
        (name: string) =>
        (...args: (number | boolean | undefined)[]): void => {
            calls.push(`${name} ${args.map((arg) => (typeof arg === 'number' ? round(arg) : String(arg))).join(' ')}`.trim());
        };
    return {
        calls,
        moveTo: record('M'),
        lineTo: record('L'),
        quadraticCurveTo: record('Q'),
        bezierCurveTo: record('C'),
        ellipse: record('E'),
        closePath: record('Z')
    };
}

function build(d: string): string[] {
    const parsed = parsePathData(d);
    if (!parsed.ok) throw new Error(`does not parse: ${d}`);
    const sink = recorder();
    buildPath(parsed.commands, sink);
    return sink.calls;
}

describe('buildPath', () => {
    it('should make relative commands absolute and draw H and V as lines', () => {
        // Act
        const calls = build('M 10 10 l 5 0 h 5 v 5 H 0 V 0 z');

        // Assert
        expect(calls).toEqual(['M 10 10', 'L 15 10', 'L 20 10', 'L 20 15', 'L 0 15', 'L 0 0', 'Z']);
    });

    it('should reflect the control point of S and T', () => {
        // Act
        const cubic = build('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
        const quad = build('M 0 0 Q 5 10 10 0 T 20 0');

        // Assert
        expect(cubic).toEqual(['M 0 0', 'C 0 10 10 10 10 0', 'C 10 -10 20 -10 20 0']);
        expect(quad).toEqual(['M 0 0', 'Q 5 10 10 0', 'Q 15 -10 20 0']);
    });

    it('should draw an arc as an ellipse segment through its centre', () => {
        // Act
        const calls = build('M 0 0 A 10 10 0 0 1 20 0');

        // Assert: a half circle of radius 10 about (10, 0), clockwise from angle pi to 2 pi
        expect(calls).toEqual(['M 0 0', `E 10 0 10 10 0 ${Math.round(Math.PI * 1000) / 1000} ${Math.round(2 * Math.PI * 1000) / 1000} false`]);
    });

    it('should draw an arc with a radius of 0 as a line, and skip one that ends where it starts', () => {
        // Act
        const flat = build('M 0 0 A 0 5 0 0 1 20 0');
        const none = build('M 3 3 A 5 5 0 0 1 3 3');

        // Assert
        expect(flat).toEqual(['M 0 0', 'L 20 0']);
        expect(none).toEqual(['M 3 3']);
    });

    it('should start a subpath at the start of the closed one when drawing goes on after Z', () => {
        // Act
        const calls = build('M 5 5 L 10 5 Z l 0 5');

        // Assert
        expect(calls).toEqual(['M 5 5', 'L 10 5', 'Z', 'M 5 5', 'L 5 10']);
    });
});

describe('arcCenter', () => {
    it('should scale up radii that are too small to reach the end point', () => {
        // Act
        const arc = arcCenter([0, 0], [20, 0], 2, 2, 0, false, true);

        // Assert
        expect(arc?.rx).toBeCloseTo(10);
        expect(arc?.cx).toBeCloseTo(10);
        expect(arc?.cy).toBeCloseTo(0);
    });
});
