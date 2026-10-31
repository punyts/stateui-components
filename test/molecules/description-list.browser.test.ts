import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const NBSP = ' ';

const part = (element: Element, selector: string): HTMLElement | null => element.shadowRoot?.querySelector(selector) ?? null;
const terms = (element: Element): string[] =>
    Array.from(element.shadowRoot?.querySelectorAll('dt') ?? []).map((term) => term.textContent?.trim() ?? '');
const values = (element: Element): string[] =>
    Array.from(element.shadowRoot?.querySelectorAll('dd') ?? []).map((value) => value.textContent?.trim() ?? '');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const badgeText = (element: Element): string => {
    const badge = part(element, 'dd ui-badge');
    return badge?.shadowRoot?.textContent?.trim() ?? '';
};

const records = {
    k1: { name: 'Ada', total: 1234.5, status: 'open', rate: 0.25, took: 125 },
    k2: { name: 'Grace', total: 99, status: 'done', rate: 0.5, took: 3725 }
};

const items = {
    name: { _term: 'Name', field: 'name' },
    total: { _term: 'Total', field: 'total', format: 'currency', currency: 'EUR' },
    rate: { _term: 'Rate', field: 'rate', format: 'percent' },
    took: { _term: 'Took', field: 'took', format: 'duration' }
};

describe('descriptionList in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should list the terms and the record values in key order', async () => {
        // Arrange
        const mounted = mountComponent('descriptionList', { items, '<-record': '$.data.k1' }, { data: { k1: records.k1 } });

        // Act
        await flush();

        // Assert
        expect(part(mounted.element, 'dl')).not.toBeNull();
        expect(terms(mounted.element)).toEqual(['Name', 'Total', 'Rate', 'Took']);
        expect(values(mounted.element)[0]).toBe('Ada');
    });

    it('should format the values with the shared formatter, and again after a language switch', async () => {
        // Arrange
        const mounted = mountComponent('descriptionList', { items, '<-record': '$.data.k1' }, { data: { k1: records.k1 } });
        await flush();
        const english = values(mounted.element);

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(english).toEqual(['Ada', '€1,234.50', '25%', '2:05']);
        expect(values(mounted.element)).toEqual(['Ada', `1.234,50${NBSP}€`, `25${NBSP}%`, '2:05']);
    });

    it('should show the empty text for a missing, null or empty value and honour _empty', async () => {
        // Arrange
        const withRecord = { name: { _term: 'Name', field: 'name' }, none: { _term: 'None', field: 'nothing' }, blank: { _term: 'Blank', field: 'blank' } };
        const standard = mountComponent('descriptionList', { items: withRecord, '<-record': '$.data.r' }, { data: { r: { name: 'Ada', blank: '' } } });
        const custom = mountComponent('descriptionList', { items: withRecord, _empty: 'n/a', '<-record': '$.data.r' }, { data: { r: { name: null } } });

        // Act
        await flush();

        // Assert
        expect(values(standard.element)).toEqual(['Ada', '—', '—']);
        expect(values(custom.element)).toEqual(['n/a', 'n/a', 'n/a']);
    });

    it('should draw a node item with $row following the record, also when the record is re-pointed', async () => {
        // Arrange
        const node = { component: 'badge', '<-_text': '$row.status' };
        const mounted = mountComponent(
            'descriptionList',
            { items: { name: { _term: 'Name', field: 'name' }, status: { _term: 'Status', node } }, '<-record': '$.data.k1' },
            { data: { k1: records.k1, k2: records.k2 } }
        );
        await flush();
        const first = badgeText(mounted.element);

        // Act
        mounted.store.link('$.app.record', '$.data.k2');
        await flush();
        const second = badgeText(mounted.element);
        mounted.store.set('$.data.k2.status', 'archived');
        await flush();

        // Assert
        expect(first).toBe('open');
        expect(second).toBe('done');
        expect(badgeText(mounted.element)).toBe('archived');
        expect(values(mounted.element)[0]).toBe('Grace');
    });

    it('should update every value when the record is re-linked', async () => {
        // Arrange
        const mounted = mountComponent('descriptionList', { items, '<-record': '$.data.k1' }, { data: records });
        await flush();

        // Act
        mounted.store.link('$.app.record', '$.data.k2');
        await flush();

        // Assert
        expect(values(mounted.element)).toEqual(['Grace', '€99.00', '50%', '1:02:05']);
    });

    it('should translate the terms from the document locale overlay', async () => {
        // Arrange
        const mounted = mountComponent(
            'descriptionList',
            { items, '<-record': '$.data.k1' },
            { data: { k1: records.k1 }, locales: { de: { items: { name: { _term: 'Name (de)' }, total: { _term: 'Summe' } } } } }
        );

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(terms(mounted.element)).toEqual(['Name (de)', 'Summe', 'Rate', 'Took']);
    });

    it('should lay out the columns as a grid and as one column below the md breakpoint', async () => {
        // Arrange
        const mounted = mountComponent('descriptionList', { items, columns: 2, '<-record': '$.data.k1' }, { data: { k1: records.k1 } });
        const host = mounted.element as HTMLElement;
        const columns = (): number => getComputedStyle(part(host, 'dl') as HTMLElement).gridTemplateColumns.split(' ').length;
        host.style.width = '900px';
        await flush();
        const wide = columns();

        // Act
        host.style.width = '400px';
        await flush();

        // Assert
        expect(wide).toBe(2);
        expect(columns()).toBe(1);
    });

    it('should stack the term over the value when vertical', async () => {
        // Arrange
        const mounted = mountComponent('descriptionList', { items, orientation: 'vertical', '<-record': '$.data.k1' }, { data: { k1: records.k1 } });

        // Act
        await flush();
        const term = part(mounted.element, 'dt')?.getBoundingClientRect();
        const value = part(mounted.element, 'dd')?.getBoundingClientRect();

        // Assert
        expect((value?.top ?? 0) >= (term?.bottom ?? 1)).toBe(true);
    });
});
