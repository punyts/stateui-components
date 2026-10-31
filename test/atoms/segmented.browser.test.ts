import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const segments = (element: Element): HTMLButtonElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.segment') ?? []);
const group = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.group') as HTMLElement;
const labels = (element: Element): string[] => segments(element).map((segment) => segment.querySelector('.label')?.textContent ?? '');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const focusedKey = (element: Element): string | undefined => {
    const root = element.shadowRoot as ShadowRoot;
    return (root.activeElement as HTMLElement | null)?.dataset.key;
};
const tabStops = (element: Element): string[] => segments(element).filter((segment) => segment.tabIndex === 0).map((segment) => segment.dataset.key ?? '');
const checked = (element: Element): string[] =>
    segments(element).filter((segment) => segment.getAttribute('aria-checked') === 'true').map((segment) => segment.dataset.key ?? '');
const pressed = (element: Element): string[] =>
    segments(element).filter((segment) => segment.getAttribute('aria-pressed') === 'true').map((segment) => segment.dataset.key ?? '');
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};

const options = { list: { _label: 'List', icon: 'list' }, grid: { _label: 'Grid', icon: 'layout-grid' }, map: { _label: 'Map', icon: 'map' } };

describe('segmented in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render one segment per option as a radiogroup of radios with the linked value checked', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, '<-value': '$.data.view' }, { data: { view: 'grid' } });
        await flush();

        // Assert
        expect(group(mounted.element).getAttribute('role')).toBe('radiogroup');
        expect(group(mounted.element).getAttribute('aria-label')).toBe('Options');
        expect(labels(mounted.element)).toEqual(['List', 'Grid', 'Map']);
        expect(segments(mounted.element).every((segment) => segment.getAttribute('role') === 'radio')).toBe(true);
        expect(checked(mounted.element)).toEqual(['grid']);
        expect(pressed(mounted.element)).toEqual([]);
        expect(mounted.element.getAttribute('size')).toBe('md');
    });

    it('should write the pressed key to $.data through a link and raise change once, and ignore a press of the chosen segment', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, '<-value': '$.data.view' }, { data: { view: 'list' } });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.click(segments(mounted.element)[2] as HTMLElement);
        await flush();
        await userEvent.click(segments(mounted.element)[2] as HTMLElement);

        // Assert
        expect(mounted.store.get('$.data.view')).toBe('map');
        expect(checked(mounted.element)).toEqual(['map']);
        expect(changes).toEqual(['map']);
    });

    it('should follow a data write', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, '<-value': '$.data.view' }, { data: { view: 'list' } });
        await flush();

        // Act
        mounted.store.set('$.data.view', 'grid');
        await flush();

        // Assert
        expect(checked(mounted.element)).toEqual(['grid']);
        expect(tabStops(mounted.element)).toEqual(['grid']);
    });

    it('should have one tab stop, the chosen segment or the first when none is chosen', async () => {
        // Arrange
        const none = mountComponent('segmented', { options });
        const some = mountComponent('segmented', { options, value: 'map' });
        await flush();

        // Assert
        expect(tabStops(none.element)).toEqual(['list']);
        expect(tabStops(some.element)).toEqual(['map']);
    });

    it('should move focus and choice with the arrow keys, wrapping, and with Tab leave the group', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, '<-value': '$.data.view' }, { data: { view: 'list' } });
        await flush();
        segments(mounted.element)[0]?.focus();

        // Act
        await userEvent.keyboard('{ArrowRight}');
        const right = [focusedKey(mounted.element), mounted.store.get('$.data.view')];
        await userEvent.keyboard('{ArrowDown}');
        const down = [focusedKey(mounted.element), mounted.store.get('$.data.view')];
        await userEvent.keyboard('{ArrowRight}');
        const wrapped = [focusedKey(mounted.element), mounted.store.get('$.data.view')];
        await userEvent.keyboard('{ArrowLeft}');
        const left = [focusedKey(mounted.element), mounted.store.get('$.data.view')];
        await userEvent.keyboard('{ArrowUp}');
        const up = [focusedKey(mounted.element), mounted.store.get('$.data.view')];
        await flush();

        // Assert
        expect(right).toEqual(['grid', 'grid']);
        expect(down).toEqual(['map', 'map']);
        expect(wrapped).toEqual(['list', 'list']);
        expect(left).toEqual(['map', 'map']);
        expect(up).toEqual(['grid', 'grid']);
        expect(tabStops(mounted.element)).toEqual(['grid']);
    });

    it('should choose with Space or Enter on a focused segment', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, '<-value': '$.data.view' }, { data: { view: 'list' } });
        await flush();
        segments(mounted.element)[1]?.focus();

        // Act
        await userEvent.keyboard('{Enter}');

        // Assert
        expect(mounted.store.get('$.data.view')).toBe('grid');
    });

    it('should render toggle buttons with aria-pressed in multiple mode and write an array in option order', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, multiple: true, '<-value': '$.data.views' }, { data: { views: ['map'] } });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.click(segments(mounted.element)[0] as HTMLElement);
        await flush();
        const afterAdd = [...(mounted.store.get('$.data.views') as string[])];
        await userEvent.click(segments(mounted.element)[2] as HTMLElement);
        await flush();

        // Assert
        expect(group(mounted.element).getAttribute('role')).toBe('group');
        expect(segments(mounted.element).every((segment) => !segment.hasAttribute('role'))).toBe(true);
        expect(afterAdd).toEqual(['list', 'map']);
        expect(mounted.store.get('$.data.views')).toEqual(['list']);
        expect(pressed(mounted.element)).toEqual(['list']);
        expect(checked(mounted.element)).toEqual([]);
        expect(changes).toEqual([['list', 'map'], ['list']]);
    });

    it('should make every segment a tab stop in multiple mode and toggle with Space', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, multiple: true, '<-value': '$.data.views' }, { data: { views: [] } });
        await flush();
        segments(mounted.element)[0]?.focus();

        // Act
        await userEvent.keyboard('{Tab}{ }');
        await flush();

        // Assert
        expect(tabStops(mounted.element)).toEqual(['list', 'grid', 'map']);
        expect(mounted.store.get('$.data.views')).toEqual(['grid']);
    });

    it('should treat a missing array value as empty in multiple mode', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, multiple: true });
        await flush();

        // Act
        await userEvent.click(segments(mounted.element)[1] as HTMLElement);

        // Assert
        expect(pressed(mounted.element)).toEqual(['grid']);
        expect(mounted.store.get('$.app.value')).toEqual(['grid']);
    });

    it('should disable every segment and ignore presses while disabled', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, disabled: true, '<-value': '$.data.view' }, { data: { view: 'list' } });
        await flush();
        const changes = events(mounted.element, 'change');

        // Act
        segments(mounted.element)[1]?.click();
        await flush();

        // Assert
        expect(segments(mounted.element).every((segment) => segment.disabled)).toBe(true);
        expect(group(mounted.element).getAttribute('aria-disabled')).toBe('true');
        expect(mounted.store.get('$.data.view')).toBe('list');
        expect(changes).toEqual([]);
    });

    it('should focus the tab stop by the focus command', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, value: 'grid' });
        await flush();

        // Act
        command(mounted.element, 'focus');

        // Assert
        expect(focusedKey(mounted.element)).toBe('grid');
    });

    it('should name an icon-only segment by its label, draw no label text and show the label as a tip', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, iconOnly: true, value: 'list' });
        await flush();
        const first = segments(mounted.element)[0] as HTMLButtonElement;
        const tips = Array.from(mounted.element.shadowRoot?.querySelectorAll<HTMLElement>('.tip') ?? []);

        // Act
        first.focus();
        await flush();

        // Assert
        expect(segments(mounted.element).map((segment) => segment.getAttribute('aria-label'))).toEqual(['List', 'Grid', 'Map']);
        expect(mounted.element.shadowRoot?.querySelectorAll('.label')).toHaveLength(0);
        expect(mounted.element.shadowRoot?.querySelectorAll('ui-icon')).toHaveLength(3);
        expect(tips.map((tip) => tip.textContent)).toEqual(['List', 'Grid', 'Map']);
        expect(tips[0]?.matches(':popover-open')).toBe(true);
        expect(tips[1]?.matches(':popover-open')).toBe(false);
    });

    it('should place each tip by its own segment', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options, iconOnly: true, value: 'list' });
        mounted.host.style.padding = '120px 200px';
        await flush();

        // Act
        segments(mounted.element)[2]?.focus();
        await flush();
        const tip = mounted.element.shadowRoot?.querySelectorAll<HTMLElement>('.tip')[2] as HTMLElement;
        const tipBox = tip.getBoundingClientRect();
        const segmentBox = (segments(mounted.element)[2] as HTMLElement).getBoundingClientRect();

        // Assert
        expect(tipBox.bottom).toBeLessThanOrEqual(segmentBox.top + 1);
        expect(Math.abs(tipBox.left + tipBox.width / 2 - (segmentBox.left + segmentBox.width / 2))).toBeLessThan(2);
    });

    it('should show the label and no tip text when iconOnly is off, and open no tip on focus', async () => {
        // Arrange
        const mounted = mountComponent('segmented', { options });
        await flush();
        const tips = Array.from(mounted.element.shadowRoot?.querySelectorAll<HTMLElement>('.tip') ?? []);

        // Act
        segments(mounted.element)[0]?.focus();

        // Assert
        expect(tips.map((tip) => tip.textContent)).toEqual(['', '', '']);
        expect(tips.some((tip) => tip.matches(':popover-open'))).toBe(false);
        expect(segments(mounted.element).every((segment) => !segment.hasAttribute('aria-label'))).toBe(true);
    });

    it('should show German option labels and the German group name', async () => {
        // Arrange
        const mounted = mountComponent(
            'segmented',
            { options },
            { locales: { de: { options: { list: { _label: 'Liste' }, grid: { _label: 'Raster' }, map: { _label: 'Karte' } } } } }
        );
        await flush();

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(labels(mounted.element)).toEqual(['Liste', 'Raster', 'Karte']);
        expect(group(mounted.element).getAttribute('aria-label')).toBe('Optionen');
    });

    it('should use the German labels as the names and tips of icon-only segments', async () => {
        // Arrange
        const mounted = mountComponent(
            'segmented',
            { options, iconOnly: true },
            { locales: { de: { options: { list: { _label: 'Liste' } } } } }
        );
        await flush();

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(segments(mounted.element)[0]?.getAttribute('aria-label')).toBe('Liste');
        expect(mounted.element.shadowRoot?.querySelector('.tip')?.textContent).toBe('Liste');
    });
});
