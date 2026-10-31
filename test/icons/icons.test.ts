import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildIcons, checkMetadata, findTablerRoot } from '../../scripts/build-icons.ts';
import { elementToPathData, svgToPaths } from '../../scripts/icon-convert.ts';
import { ICON_ALIASES } from '../../src/icons/aliases.ts';
import type { IconsFile } from '../../src/icons/types.ts';

let file: IconsFile;

beforeAll(async () => {
    file = await buildIcons();
}, 60_000);

describe('icons.json', () => {
    it('should have no brand icons and outline data for every icon', () => {
        // Arrange
        const entries = Object.entries(file.icons);

        // Act
        const brand = entries.filter(([name]) => name.startsWith('brand-'));
        const withoutOutline = entries.filter(([, icon]) => icon.outline.length === 0);

        // Assert
        expect(entries.length).toBeGreaterThan(4000);
        expect(brand).toEqual([]);
        expect(withoutOutline).toEqual([]);
    });

    it('should keep category and tags, and filled data only where a filled variant exists', () => {
        // Act
        const check = file.icons['circle-check'];
        const outlineOnly = file.icons['a-b-2'];

        // Assert
        expect(check?.category).toBeTruthy();
        expect(check?.tags.length).toBeGreaterThan(0);
        expect(check?.filled?.length).toBeGreaterThan(0);
        expect(outlineOnly?.filled).toBeUndefined();
    });

    it('should drop the bounding-box path from every icon', () => {
        // Act
        const text = JSON.stringify(file.icons);

        // Assert
        expect(text).not.toContain('M0 0h24v24H0z');
    });

    it('should record the pinned tabler version', async () => {
        // Arrange
        const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
            devDependencies: Record<string, string>;
        };

        // Assert
        expect(manifest.devDependencies['@tabler/icons']).toBe(file.tablerVersion);
    });

    it('should list the aliases and resolve each to an existing icon', () => {
        // Act
        const missing = Object.entries(file.aliases).filter(([, target]) => file.icons[target] === undefined);

        // Assert
        expect(file.aliases).toEqual(ICON_ALIASES);
        expect(Object.keys(file.aliases)).toEqual(
            expect.arrayContaining(['close', 'delete', 'warning', 'error', 'success', 'info'])
        );
        expect(missing).toEqual([]);
    });

    it('should resolve an alias to the paths of its target', () => {
        // Act
        const target = file.aliases.close as string;

        // Assert
        expect(target).toBe('x');
        expect(file.icons[target]?.outline).toEqual(file.icons.x?.outline);
        expect(file.icons.x?.outline.length).toBeGreaterThan(0);
    });

    it('should match the file the build writes for the first icon', async () => {
        // Arrange
        const root = findTablerRoot();

        // Act
        const second = await buildIcons(root);

        // Assert
        expect(Object.keys(second.icons).slice(0, 20)).toEqual(Object.keys(file.icons).slice(0, 20));
    });
});

describe('checkMetadata', () => {
    const complete = { x: { name: 'x', category: 'Navigation', tags: ['close'] } };

    it('should accept complete metadata', () => {
        // Act
        const run = () => checkMetadata('9.9.9', complete);

        // Assert
        expect(run).not.toThrow();
    });

    it.each([
        ['name', { x: { category: 'Navigation', tags: ['close'] } }],
        ['category', { x: { name: 'x', tags: ['close'] } }],
        ['tags', { x: { name: 'x', category: 'Navigation' } }]
    ])('should fail naming the version when %s is missing', (missing, metadata) => {
        // Act
        const run = () => checkMetadata('9.9.9', metadata);

        // Assert
        expect(run).toThrow(/@tabler\/icons@9\.9\.9/);
        expect(run).toThrow(new RegExp(`"x" has no ${missing}`));
    });

    it('should fail naming the version when there are no icons', () => {
        // Act
        const run = () => checkMetadata('9.9.9', {});

        // Assert
        expect(run).toThrow(/@tabler\/icons@9\.9\.9/);
    });
});

describe('svgToPaths', () => {
    const wrap = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;

    it('should drop the bounding-box path and keep the others as path data', () => {
        // Arrange
        const svg = wrap('<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 12h14" />');

        // Act
        const paths = svgToPaths(svg, 'outline');

        // Assert
        expect(paths).toEqual(['M5 12h14']);
    });

    it('should convert circle, ellipse, rect, line and polyline to path data', () => {
        // Arrange
        const svg = wrap(
            '<circle cx="12" cy="12" r="4" /><ellipse cx="12" cy="12" rx="6" ry="3" />' +
                '<rect x="3" y="4" width="10" height="6" rx="2" /><line x1="1" y1="2" x2="3" y2="4" />' +
                '<polyline points="1,2 3,4 5,6" />'
        );

        // Act
        const paths = svgToPaths(svg, 'outline');

        // Assert
        expect(paths).toEqual([
            'M 8 12 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0 z',
            'M 6 12 a 6 3 0 1 0 12 0 a 6 3 0 1 0 -12 0 z',
            'M 5 4 h 6 a 2 2 0 0 1 2 2 v 2 a 2 2 0 0 1 -2 2 h -6 a 2 2 0 0 1 -2 -2 v -2 a 2 2 0 0 1 2 -2 z',
            'M 1 2 L 3 4',
            'M 1 2 L 3 4 L 5 6'
        ]);
    });

    it('should keep the styles Tabler sets on an outline path', () => {
        // Arrange
        const svg = wrap(
            '<path d="M1 1" fill="currentColor" /><path d="M2 2" fill="currentColor" stroke="none" />' +
                '<path d="M3 3" opacity=".5" />'
        );

        // Act
        const paths = svgToPaths(svg, 'outline');

        // Assert
        expect(paths).toEqual([
            { d: 'M1 1', fill: true },
            { d: 'M2 2', fill: true, stroke: false },
            { d: 'M3 3', opacity: 0.5 }
        ]);
    });

    it('should treat fill="currentColor" as the default on a filled icon', () => {
        // Act
        const paths = svgToPaths('<svg><path d="M1 1" fill="currentColor" /></svg>', 'filled');

        // Assert
        expect(paths).toEqual(['M1 1']);
    });

    it('should reject an element or attribute it cannot convert', () => {
        // Act
        const polygon = () => svgToPaths(wrap('<polygon points="1,2 3,4 5,6" />'), 'outline');
        const gradient = () => svgToPaths(wrap('<path d="M1 1" fill="url(#a)" />'), 'outline');

        // Assert
        expect(polygon).toThrow('<polygon>');
        expect(gradient).toThrow('fill="url(#a)"');
    });

    it('should reject a circle without a radius', () => {
        // Act
        const run = () => elementToPathData('circle', { cx: '1', cy: '1' });

        // Assert
        expect(run).toThrow('"r"');
    });
});
