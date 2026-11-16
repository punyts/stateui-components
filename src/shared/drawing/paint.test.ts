import { describe, expect, it } from 'vitest';
import { NO_PAINT, buildGradients, createPaintResolver, linearEnds, placeGradient, resolveColor, tokenProperty } from './paint.js';
import type { PaintIssue, ReadCustomProperty } from './paint.js';

const SHAPE = '$.app.children.map.children.seat';
const PAINTS = '$.app.children.map.paints';

/** A computed style that knows only the given custom properties */
const theme =
    (values: Record<string, string>): ReadCustomProperty =>
    (name) =>
        values[name] ?? '';

const paints = {
    sky: { kind: 'linear', angle: 90, stops: { top: { offset: 0, color: '#87ceeb' }, bottom: { offset: 1, color: '{color.accent.base}' } } },
    glow: { kind: 'radial', center: [0.25, 0.75], stops: { inner: { offset: 0, color: 'rgb(255, 255, 255)' }, outer: { offset: 1, color: 'transparent' } } }
};

describe('tokenProperty', () => {
    it('should name the custom property of a token', () => {
        expect(tokenProperty('{color.accent.base}')).toBe('--ui-color-accent-base');
        expect(tokenProperty('{chart.series.1}')).toBe('--ui-chart-series-1');
    });

    it('should give nothing for a value that is not a token', () => {
        expect(tokenProperty('#fff')).toBeUndefined();
        expect(tokenProperty('{color}')).toBeUndefined();
        expect(tokenProperty('sky')).toBeUndefined();
    });
});

describe('resolveColor', () => {
    it.each(['#fff', '#A1B2C380', 'rgb(10, 20, 30)', 'rgba(10, 20, 30, 0.5)', 'hsl(210, 50%, 40%)', 'hsla(210deg, 50%, 40%, 0.2)', 'transparent'])(
        'should keep the literal %s',
        (value) => {
            expect(resolveColor(value)).toEqual({ kind: 'color', css: value, computed: value });
        }
    );

    it('should reference the custom property of a token without read', () => {
        expect(resolveColor('{color.accent.base}')).toEqual({ kind: 'color', css: 'var(--ui-color-accent-base)', token: 'color.accent.base' });
    });

    it('should compute a token through read', () => {
        const read = theme({ '--ui-color-accent-base': ' #3366ff ' });

        expect(resolveColor('{color.accent.base}', read)).toEqual({
            kind: 'color',
            css: 'var(--ui-color-accent-base)',
            computed: '#3366ff',
            token: 'color.accent.base'
        });
    });

    it('should refuse a token the theme does not define', () => {
        expect(resolveColor('{color.nowhere.base}', theme({}))).toEqual({ kind: 'unresolved', reason: 'token', value: '{color.nowhere.base}' });
        expect(resolveColor('{color.nowhere.base}', () => undefined)).toMatchObject({ kind: 'unresolved', reason: 'token' });
    });

    it('should not throw when read throws', () => {
        const read: ReadCustomProperty = () => {
            throw new Error('detached');
        };

        expect(resolveColor('{color.accent.base}', read)).toMatchObject({ kind: 'unresolved', reason: 'token' });
    });

    it('should hand a paint name back for the caller', () => {
        expect(resolveColor('sky')).toEqual({ kind: 'paint', name: 'sky' });
    });

    it.each([undefined, null, ''])('should treat %j as unset', (value) => {
        expect(resolveColor(value)).toEqual({ kind: 'unset' });
    });

    it.each([['var(--ui-x)'], ['url(#sky)'], ['red fade'], [5], [{ r: 1 }], ['a'.repeat(101)]])('should refuse %j as invalid', (value) => {
        expect(resolveColor(value)).toMatchObject({ kind: 'unresolved', reason: 'invalid' });
    });
});

describe('linearEnds', () => {
    it('should run left to right at 0 and top to bottom at 90', () => {
        expect(linearEnds(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
        expect(linearEnds(90)).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
        expect(linearEnds(180)).toEqual({ x1: 1, y1: 0.5, x2: 0, y2: 0.5 });
    });
});

describe('buildGradients', () => {
    it('should build linear and radial gradients from paints', () => {
        const { gradients, issues } = buildGradients(paints, PAINTS, theme({ '--ui-color-accent-base': '#3366ff' }));

        expect(issues).toEqual([]);
        expect(gradients.get('sky')).toEqual({
            kind: 'linear',
            name: 'sky',
            path: `${PAINTS}.sky`,
            angle: 90,
            x1: 0.5,
            y1: 0,
            x2: 0.5,
            y2: 1,
            stops: [
                { offset: 0, color: { kind: 'color', css: '#87ceeb', computed: '#87ceeb' } },
                { offset: 1, color: { kind: 'color', css: 'var(--ui-color-accent-base)', computed: '#3366ff', token: 'color.accent.base' } }
            ]
        });
        expect(gradients.get('glow')).toMatchObject({ kind: 'radial', cx: 0.25, cy: 0.75, r: 0.5 });
    });

    it('should sort stops by offset, clamp them, and take center as an object', () => {
        const { gradients } = buildGradients(
            {
                fade: {
                    kind: 'radial',
                    center: { x: 0.1, y: 0.2 },
                    stops: { b: { offset: 1.5, color: '#000' }, a: { offset: -1, color: '#fff' }, c: { offset: 0.5, color: '#888' } }
                }
            },
            PAINTS
        );
        const fade = gradients.get('fade');

        expect(fade).toMatchObject({ cx: 0.1, cy: 0.2 });
        expect(fade?.stops.map((stop) => [stop.offset, stop.color.css])).toEqual([
            [0, '#fff'],
            [0.5, '#888'],
            [1, '#000']
        ]);
    });

    it('should leave out a stop whose colour is unresolvable and list it', () => {
        const { gradients, issues } = buildGradients(
            { sky: { kind: 'linear', stops: { a: { offset: 0, color: '{color.nowhere.base}' }, b: { offset: 1, color: 'other' }, c: { offset: 1, color: '#fff' } } } },
            PAINTS,
            theme({})
        );

        expect(gradients.get('sky')?.stops).toHaveLength(1);
        expect(issues).toEqual([
            { code: 'SUI-STATE-TOKEN', path: `${PAINTS}.sky.stops.a.color`, property: 'color', value: '{color.nowhere.base}' },
            { code: 'SUI-STATE-PAINT', path: `${PAINTS}.sky.stops.b.color`, property: 'color', value: 'other' }
        ]);
    });

    it('should make no gradient of an entry with no usable stop or an unknown kind', () => {
        const { gradients } = buildGradients(
            { empty: { kind: 'linear', stops: {} }, conic: { kind: 'conic', stops: { a: { offset: 0, color: '#fff' } } }, bad: 'sky' },
            PAINTS
        );

        expect(gradients.size).toBe(0);
        expect(buildGradients(undefined, PAINTS).gradients.size).toBe(0);
    });
});

describe('placeGradient', () => {
    it('should place a gradient on the bounds of a shape', () => {
        const { gradients } = buildGradients(paints, PAINTS);
        const bounds = { x: 10, y: 20, width: 100, height: 40 };

        expect(placeGradient(gradients.get('sky')!, bounds)).toEqual({ kind: 'linear', x1: 60, y1: 20, x2: 60, y2: 60 });
        expect(placeGradient(gradients.get('glow')!, bounds)).toEqual({ kind: 'radial', cx: 35, cy: 50, rx: 50, ry: 20 });
    });
});

describe('createPaintResolver', () => {
    const resolver = (read?: ReadCustomProperty) => {
        const issues: PaintIssue[] = [];
        const paint = createPaintResolver({ paints, paintsPath: PAINTS, read, onIssue: (issue) => issues.push(issue) });
        return { paint, issues };
    };

    it('should resolve literals, tokens and paints', () => {
        const { paint, issues } = resolver(theme({ '--ui-color-accent-base': '#3366ff' }));

        expect(paint.resolve('#fff', SHAPE, 'fill')).toEqual({ kind: 'color', css: '#fff', computed: '#fff' });
        expect(paint.resolve('{color.accent.base}', SHAPE, 'stroke')).toMatchObject({ kind: 'color', css: 'var(--ui-color-accent-base)', computed: '#3366ff' });
        expect(paint.resolve('sky', SHAPE, 'fill')).toEqual({ kind: 'gradient', gradient: paint.gradients.get('sky') });
        expect(paint.resolve(undefined, SHAPE, 'fill')).toBe(NO_PAINT);
        expect(issues).toEqual([]);
    });

    it('should resolve a paint name with no entry to no paint and report it once', () => {
        const { paint, issues } = resolver();

        expect(paint.resolve('sea', SHAPE, 'fill')).toBe(NO_PAINT);
        expect(paint.resolve('sea', SHAPE, 'fill')).toBe(NO_PAINT);
        expect(issues).toEqual([{ code: 'SUI-STATE-PAINT', path: `${SHAPE}.fill`, property: 'fill', value: 'sea' }]);
    });

    it('should resolve an unknown token at run time to no paint and report it once', () => {
        const { paint, issues } = resolver(theme({}));

        expect(paint.resolve('{color.nowhere.base}', SHAPE, 'fill')).toBe(NO_PAINT);
        expect(paint.resolve('{color.nowhere.base}', SHAPE, 'fill')).toBe(NO_PAINT);
        expect(issues.filter((issue) => issue.path === `${SHAPE}.fill`)).toEqual([{ code: 'SUI-STATE-TOKEN', path: `${SHAPE}.fill`, property: 'fill', value: '{color.nowhere.base}' }]);
        // The token stop of `sky` is unresolvable too, reported once at the stop
        expect(issues.filter((issue) => issue.path === `${PAINTS}.sky.stops.bottom.color`)).toHaveLength(1);
    });

    it('should report a linked value that is not a colour as SUI-RUN-DRAW', () => {
        const { paint, issues } = resolver();

        expect(paint.resolve(42, SHAPE, 'fill')).toBe(NO_PAINT);
        expect(issues).toEqual([{ code: 'SUI-RUN-DRAW', path: `${SHAPE}.fill`, property: 'fill', value: '42' }]);
    });

    it('should keep drawing the other shapes after a problem', () => {
        const { paint, issues } = resolver(theme({ '--ui-color-accent-base': '#3366ff' }));
        const fills = ['#f00', 'sea', '{color.nowhere.base}', 'glow', '{color.accent.base}'].map((value, index) => paint.resolve(value, `${SHAPE}${index}`, 'fill'));

        expect(fills.map((fill) => fill.kind)).toEqual(['color', 'none', 'none', 'gradient', 'color']);
        expect(issues.map((issue) => issue.code)).toEqual(['SUI-STATE-PAINT', 'SUI-STATE-TOKEN']);
    });

    it('should survive a reporter that throws', () => {
        const paint = createPaintResolver({
            onIssue: () => {
                throw new Error('report failed');
            }
        });

        expect(paint.resolve('sea', SHAPE, 'fill')).toBe(NO_PAINT);
    });

    it('should rebuild on update and not report a problem again', () => {
        const { paint, issues } = resolver(theme({}));
        paint.resolve('{color.accent.base}', SHAPE, 'fill');

        paint.update({ read: theme({}) });
        paint.resolve('{color.accent.base}', SHAPE, 'fill');
        expect(issues).toHaveLength(2);

        paint.update({ read: theme({ '--ui-color-accent-base': '#000' }), paints: { sea: { stops: { a: { offset: 0, color: '#00f' } } } } });
        expect(paint.resolve('{color.accent.base}', SHAPE, 'fill')).toMatchObject({ computed: '#000' });
        expect(paint.resolve('sea', SHAPE, 'fill')).toMatchObject({ kind: 'gradient', gradient: { kind: 'linear', path: `${PAINTS}.sea` } });
        expect(paint.gradients.has('sky')).toBe(false);
    });
});
