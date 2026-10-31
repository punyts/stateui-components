import alertTriangle from '@tabler/icons/outline/alert-triangle.svg?raw';
import calendar from '@tabler/icons/outline/calendar.svg?raw';
import chevronDown from '@tabler/icons/outline/chevron-down.svg?raw';
import circleCheckFilled from '@tabler/icons/filled/circle-check.svg?raw';
import circleCheck from '@tabler/icons/outline/circle-check.svg?raw';
import dots from '@tabler/icons/outline/dots.svg?raw';
import gripVertical from '@tabler/icons/outline/grip-vertical.svg?raw';
import infoCircleFilled from '@tabler/icons/filled/info-circle.svg?raw';
import menu2 from '@tabler/icons/outline/menu-2.svg?raw';
import search from '@tabler/icons/outline/search.svg?raw';
import trash from '@tabler/icons/outline/trash.svg?raw';
import x from '@tabler/icons/outline/x.svg?raw';
import { describe, expect, it } from 'vitest';
import { svgToPaths, type IconVariant } from '../../scripts/icon-convert.ts';
import type { IconPath } from '../../src/icons/types.ts';

const SIZE = 96;
/** A pixel differs when its alpha differs by more than this (of 255) */
const ALPHA_TOLERANCE = 32;
/** The share of pixels allowed to differ: anti-aliasing at the edges of arcs may differ by a rounding step */
const DIFFERING_SHARE = 0.002;

const OUTLINE_ROOT = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const FILLED_ROOT = 'fill="currentColor"';

function pathMarkup(path: IconPath): string {
    if (typeof path === 'string') return `<path d="${path}"/>`;
    const fill = path.fill === true ? ' fill="currentColor"' : '';
    const stroke = path.stroke === false ? ' stroke="none"' : '';
    const opacity = path.opacity === undefined ? '' : ` opacity="${path.opacity}"`;
    return `<path d="${path.d}"${fill}${stroke}${opacity}/>`;
}

/** Draws the converted path data the way the icon component does: one root style and plain paths */
function convertedSvg(source: string, variant: IconVariant): string {
    const root = variant === 'outline' ? OUTLINE_ROOT : FILLED_ROOT;
    const paths = svgToPaths(source, variant).map(pathMarkup).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${root}>${paths}</svg>`;
}

async function rasterise(svg: string): Promise<Uint8ClampedArray> {
    const image = new Image();
    image.width = SIZE;
    image.height = SIZE;
    const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The SVG did not load'));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('No 2d canvas context');
    context.drawImage(image, 0, 0, SIZE, SIZE);
    return context.getImageData(0, 0, SIZE, SIZE).data;
}

function differingShare(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let differing = 0;
    let inked = 0;
    for (let index = 3; index < a.length; index += 4) {
        const left = a[index] as number;
        const right = b[index] as number;
        if (left > 0 || right > 0) inked += 1;
        if (Math.abs(left - right) > ALPHA_TOLERANCE) differing += 1;
    }
    expect(inked).toBeGreaterThan(0);
    return differing / (a.length / 4);
}

const OUTLINE_SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ['x', x],
    ['search', search],
    ['circle-check', circleCheck],
    ['alert-triangle', alertTriangle],
    ['chevron-down', chevronDown],
    ['menu-2', menu2],
    ['dots', dots],
    ['grip-vertical', gripVertical],
    ['calendar', calendar],
    ['trash', trash]
];

const FILLED_SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ['circle-check', circleCheckFilled],
    ['info-circle', infoCircleFilled]
];

const SHAPES_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
    `${OUTLINE_ROOT}>` +
    '<circle cx="6" cy="6" r="3"/><ellipse cx="17" cy="6" rx="4" ry="2.5"/>' +
    '<rect x="3" y="12" width="9" height="6" rx="2"/><rect x="14" y="12" width="6" height="6"/>' +
    '<line x1="3" y1="21" x2="10" y2="21"/><polyline points="13 21 16 19 20 21"/></svg>';

describe('icon path data against the source SVG', () => {
    it.each(OUTLINE_SAMPLES)('should draw the outline icon %s like its source SVG', async (_name, source) => {
        // Arrange
        const expected = await rasterise(source);

        // Act
        const actual = await rasterise(convertedSvg(source, 'outline'));

        // Assert
        expect(differingShare(expected, actual)).toBeLessThanOrEqual(DIFFERING_SHARE);
    });

    it.each(FILLED_SAMPLES)('should draw the filled icon %s like its source SVG', async (_name, source) => {
        // Arrange
        const expected = await rasterise(source);

        // Act
        const actual = await rasterise(convertedSvg(source, 'filled'));

        // Assert
        expect(differingShare(expected, actual)).toBeLessThanOrEqual(DIFFERING_SHARE);
    });

    it('should draw circle, ellipse, rect, line and polyline elements like their converted paths', async () => {
        // Arrange
        const expected = await rasterise(SHAPES_SVG);

        // Act
        const actual = await rasterise(convertedSvg(SHAPES_SVG, 'outline'));

        // Assert
        expect(differingShare(expected, actual)).toBeLessThanOrEqual(DIFFERING_SHARE);
    });

    it('should draw nothing differently when a path is changed (the comparison can fail)', async () => {
        // Arrange
        const expected = await rasterise(x);
        const wrong = convertedSvg(search, 'outline');

        // Act
        const actual = await rasterise(wrong);

        // Assert
        expect(differingShare(expected, actual)).toBeGreaterThan(DIFFERING_SHARE);
    });
});
