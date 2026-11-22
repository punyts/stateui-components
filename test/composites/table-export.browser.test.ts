import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

interface ExportDetail {
    source: string;
    name: string;
    request: Record<string, unknown>;
    respond(result: Promise<number>): void;
}

const columns = {
    name: { _title: 'Name', field: 'name', filter: 'text' },
    state: { _title: 'State', field: 'state', filter: 'select', options: { open: { _label: 'Open' }, done: { _label: 'Done' } } },
    actions: { _title: 'Actions' }
};

const mountTable = async (extra: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('table', { '<-items': '$.data.people', columns, filter: 'a', filters: { state: 'open' }, sortBy: 'name', sortDir: 'desc', ...extra }, { data: { people: { p1: { name: 'Ada', state: 'open' } } } });
    await flush();
    return mounted;
};
const exportWith = (mounted: MountedComponent, value?: unknown): void => (mounted.element as HTMLElement & { commands: Record<string, (value?: unknown) => void> }).commands['export']?.(value);

describe('table export in Chromium', () => {
    let answer: ((detail: ExportDetail) => void) | undefined;
    const listener = (event: Event): void => answer?.((event as CustomEvent<ExportDetail>).detail);
    document.addEventListener('ui-file-export', listener);

    afterEach(() => {
        answer = undefined;
        mountComponent.unmountAll();
    });

    it('should ask the host for the records at the linked path with the columns, filters and sort, never rows', async () => {
        // Arrange
        const mounted = await mountTable();
        const asked: ExportDetail[] = [];
        answer = (detail) => {
            asked.push(detail);
            detail.respond(Promise.resolve(1));
        };
        const exported = events(mounted.element, 'export');

        // Act
        exportWith(mounted, 'People: open');
        await flush();

        // Assert
        expect(asked).toHaveLength(1);
        expect(asked[0]?.source).toBe('$.data.people');
        expect(asked[0]?.name).toBe('People open.csv');
        expect(asked[0]?.request).toEqual({
            columns: [
                { key: 'name', field: 'name', title: 'Name', filter: 'text', options: {} },
                { key: 'state', field: 'state', title: 'State', filter: 'select', options: { open: 'Open', done: 'Done' } }
            ],
            filter: 'a',
            filters: { state: 'open' },
            sortBy: 'name',
            sortDir: 'desc'
        });
        expect(exported).toEqual([{ ok: true, rows: 1 }]);
        expect(mounted.store.get('$.app.exporting')).toBe(false);
    });

    it('should name the file from _exportName, mark exporting while it runs and raise the code of a failure', async () => {
        // Arrange
        const mounted = await mountTable();
        let fail: (error: unknown) => void = () => undefined;
        let name = '';
        answer = (detail) => {
            name = detail.name;
            detail.respond(new Promise((_resolve, reject) => (fail = reject)));
        };
        const exported = events(mounted.element, 'export');

        // Act
        exportWith(mounted);
        const during = mounted.store.get('$.app.exporting');
        exportWith(mounted);
        fail(Object.assign(new Error('Too many'), { code: 'too_large' }));
        await flush();

        // Assert
        expect(name).toBe('Records.csv');
        expect(during).toBe(true);
        expect(exported).toEqual([{ ok: false, code: 'too_large' }]);
        expect(mounted.store.get('$.app.exporting')).toBe(false);
    });

    it('should raise offline when no host answers, and not_found for records that are not under the data', async () => {
        // Arrange
        const unanswered = await mountTable();
        const local = mountComponent('table', { items: [{ id: 'a', name: 'Ada' }], key: 'id', columns }, {});
        await flush();
        const first = events(unanswered.element, 'export');
        const second = events(local.element, 'export');

        // Act
        exportWith(unanswered);
        exportWith(local);

        // Assert
        expect(first).toEqual([{ ok: false, code: 'offline' }]);
        expect(second).toEqual([{ ok: false, code: 'not_found' }]);
    });
});
