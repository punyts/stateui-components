import { describe, expect, it } from 'vitest';
import type { Catalog, PatternCatalogEntry } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

function pattern(name: string): PatternCatalogEntry {
    const found = catalog.patterns.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`pattern ${name} is not in the catalog`);
    return found;
}

/** Each commerce screen with its slots and the type of each param (S2.3) */
const COMMERCE = [
    ['product-grid', ['actions', 'card'], { title: 'string', products: 'path' }],
    ['product-detail', ['actions', 'detail'], { title: 'string', product: 'path', picture: 'path', pictureText: 'path' }],
    ['bag-and-checkout', ['line', 'payment', 'summary'], { title: 'string', bag: 'path', products: 'path' }],
    ['sign-in-form', ['fields', 'help'], { title: 'string', email: 'path' }]
] as const;

/** The dashboard, master and detail, and settings screens (S2.4), and booking (S2.12) */
const FIRST_SCREENS = [
    ['dashboard', ['chart', 'figures'], { title: 'string', records: 'path', x: 'string', value: 'string' }],
    ['master-detail', ['detail', 'row'], { title: 'string', items: 'path' }],
    ['settings', ['general', 'menu', 'sections'], { title: 'string' }],
    ['booking', ['details', 'room', 'summary'], { title: 'string', rooms: 'path', availability: 'path', dates: 'path', guests: 'path', bookings: 'path' }]
] as const;

describe('catalog patterns', () => {
    it('should list the patterns sorted by kind then name', () => {
        // Arrange and Act
        const keys = catalog.patterns.map((entry) => `${entry.kind}/${entry.name}`);

        // Assert
        expect(keys).toEqual([...keys].sort());
    });

    it('should list the eleven screen patterns', () => {
        // Arrange and Act
        const screens = catalog.patterns.filter((entry) => entry.kind === 'screen').map((entry) => entry.name);

        // Assert
        expect(screens).toEqual([
            'bag-and-checkout',
            'booking',
            'dashboard',
            'marketing',
            'master-detail',
            'product-detail',
            'product-grid',
            'settings',
            'side-navigation',
            'sign-in-form',
            'top-navigation'
        ]);
    });

    it.each([...COMMERCE, ...FIRST_SCREENS])('should hold the screen pattern %s with its slots and params', (name, slots, params) => {
        // Arrange and Act
        const entry = pattern(name);

        // Assert
        expect(entry.kind).toBe('screen');
        expect(Object.keys(entry.slots).sort()).toEqual([...slots]);
        expect(Object.fromEntries(Object.entries(entry.params).map(([key, param]) => [key, param.type]))).toEqual(params);
        expect(entry.components).not.toContain('app');
        expect(entry.purposes.length).toBeGreaterThanOrEqual(3);
    });

    it('should build bag-and-checkout from a stepper and a recordList', () => {
        // Arrange and Act
        const entry = pattern('bag-and-checkout');

        // Assert
        expect(entry.components).toEqual(expect.arrayContaining(['stepper', 'recordList']));
    });

    it.each(['master-detail', 'settings'])('should copy %s as plain nodes, with no composed component', (name) => {
        // Arrange and Act
        const entry = pattern(name);

        // Assert
        expect(entry.components).not.toContain('masterDetail');
        expect(entry.components).not.toContain('settingsPanel');
    });

    it('should build dashboard from stat tiles and a chart', () => {
        // Arrange and Act
        const entry = pattern('dashboard');

        // Assert
        expect(entry.components).toEqual(expect.arrayContaining(['stat', 'chart']));
    });

    it.each(['marketing', 'side-navigation', 'top-navigation'])('should hold the frame screen pattern %s with a menu that collapses, a title and header, content and footer slots', (name) => {
        // Arrange and Act
        const entry = pattern(name);

        // Assert
        expect(entry.kind).toBe('screen');
        expect(entry.components).not.toContain('app');
        expect(JSON.stringify(entry.tree)).toContain('"collapseBelow":"md"');
        expect(Object.keys(entry.slots)).toEqual(expect.arrayContaining(['menu', 'content']));
        expect(entry.params['title']?.type).toBe('string');
        expect(entry.params['title']?.default).toEqual(expect.any(String));
        expect(Object.keys(entry.slots)).toEqual(expect.arrayContaining(['headerActions', 'footer']));
        expect(entry.purposes.length).toBeGreaterThanOrEqual(3);
        expect(entry.purposes.length).toBeLessThanOrEqual(8);
    });

    it('should build booking from steps, room cards with pictures, a date range field, a calendar, a form and a summary', () => {
        // Arrange and Act
        const entry = pattern('booking');

        // Assert
        expect(entry.components).toEqual(expect.arrayContaining(['dateRangeField', 'calendar', 'form', 'numberField', 'stat', 'stepper', 'recordGrid', 'image', 'textField']));
    });
});
