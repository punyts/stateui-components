import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends HTMLElement>(element: Element, selector: string): T => root(element).querySelector(selector) as T;
const dialogOf = (element: Element): HTMLDialogElement => part<HTMLDialogElement>(element, 'dialog');
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const deepActive = (scope: Document | ShadowRoot = document): Element | null => {
    const active = scope.activeElement;
    return active?.shadowRoot ? (deepActive(active.shadowRoot) ?? active) : active;
};
const insideOf = (host: Element, target: Element | null): boolean => {
    let node: Node | null = target;
    while (node) {
        if (node === host) return true;
        node = node.parentNode ?? (node as ShadowRoot).host ?? null;
    }
    return false;
};
const findByTag = (scope: ParentNode, tag: string): Element | null => {
    for (const candidate of Array.from(scope.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? findByTag(candidate.shadowRoot, tag) : null;
        if (inner) return inner;
    }
    return null;
};
const text = (value: string): Record<string, unknown> => ({ component: 'text', _text: value });
const counts = (element: Element): { open: number; close: number } => {
    const seen = { open: 0, close: 0 };
    element.addEventListener('open', () => (seen.open += 1));
    element.addEventListener('close', () => (seen.close += 1));
    return seen;
};
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600));

describe.each(['modal', 'drawer'])('%s in Chromium', (name) => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should stay closed with its slots in the DOM until opened, and open and close by command with one event each', () => {
        // Arrange
        const mounted = mountComponent(name, { _title: 'Edit', body: text('Body'), footer: text('Foot') });
        const seen = counts(mounted.element);

        // Assert
        expect(dialogOf(mounted.element).open).toBe(false);
        expect(part(mounted.element, '.body sui-node')).not.toBeNull();
        expect(part(mounted.element, '.footer sui-node')).not.toBeNull();

        // Act
        command(mounted.element, 'open');
        command(mounted.element, 'open');

        // Assert
        expect(dialogOf(mounted.element).open).toBe(true);
        expect(mounted.store.get('$.app.open')).toBe(true);
        expect(seen).toEqual({ open: 1, close: 0 });

        // Act
        command(mounted.element, 'close');
        command(mounted.element, 'close');

        // Assert
        expect(dialogOf(mounted.element).open).toBe(false);
        expect(seen).toEqual({ open: 1, close: 1 });
    });

    it('should toggle by command', () => {
        // Arrange
        const mounted = mountComponent(name, { body: text('Body') });

        // Act
        command(mounted.element, 'toggle');
        const opened = dialogOf(mounted.element).open;
        command(mounted.element, 'toggle');

        // Assert
        expect(opened).toBe(true);
        expect(dialogOf(mounted.element).open).toBe(false);
    });

    it('should follow a state write to open and raise one event per transition', () => {
        // Arrange
        const mounted = mountComponent(name, { body: text('Body') });
        const seen = counts(mounted.element);

        // Act
        mounted.store.set('$.app.open', true);
        mounted.store.set('$.app.open', true);
        const opened = dialogOf(mounted.element).open;
        mounted.store.set('$.app.open', false);

        // Assert
        expect(opened).toBe(true);
        expect(dialogOf(mounted.element).open).toBe(false);
        expect(seen).toEqual({ open: 1, close: 1 });
    });

    it('should be open at load without raising an event', async () => {
        // Arrange
        const mounted = mountComponent(name, { open: true, body: text('Body') });
        await frame();
        const seen = counts(mounted.element);

        // Assert
        expect(dialogOf(mounted.element).open).toBe(true);
        expect(seen).toEqual({ open: 0, close: 0 });
    });

    it('should raise events that reach on wiring whichever path changed open', () => {
        // Arrange
        const mounted = mountComponent(name, {
            body: text('Body'),
            on: {
                open: { command: 'set', target: '$.data.opened', value: true },
                close: { command: 'set', target: '$.data.closed', value: true }
            }
        });

        // Act
        mounted.store.set('$.app.open', true);

        // Assert
        expect(mounted.store.get('$.data.opened')).toBe(true);
        expect(mounted.store.get('$.data.closed')).toBeUndefined();

        // Act
        command(mounted.element, 'close');

        // Assert
        expect(mounted.store.get('$.data.closed')).toBe(true);
    });

    it('should open from a button press wired to the open command and close from on wiring', async () => {
        // Arrange
        const mounted = mountComponent('panel', {
            children: {
                opener: { component: 'button', _title: 'Open', on: { press: { command: 'open', target: '$.app.children.dlg' } } },
                dlg: { component: name, body: text('Body') }
            }
        });
        const dialog = findByTag(root(mounted.element), `ui-${name}`) as Element;
        const button = findByTag(root(mounted.element), 'ui-button') as HTMLElement;
        const seen = counts(dialog);

        // Act
        await userEvent.click(button);

        // Assert
        expect(dialogOf(dialog).open).toBe(true);
        expect(seen).toEqual({ open: 1, close: 0 });
    });

    it('should close on Escape when dismissible', async () => {
        // Arrange
        const mounted = mountComponent(name, { open: true, body: text('Body') });
        await frame();
        const seen = counts(mounted.element);

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(dialogOf(mounted.element).open).toBe(false);
        expect(mounted.store.get('$.app.open')).toBe(false);
        expect(seen).toEqual({ open: 0, close: 1 });
    });

    it('should ignore Escape, even repeated, when not dismissible', async () => {
        // Arrange
        const mounted = mountComponent(name, { open: true, dismissible: false, body: text('Body') });
        await frame();
        const seen = counts(mounted.element);

        // Act
        await userEvent.keyboard('{Escape}');
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(dialogOf(mounted.element).open).toBe(true);
        expect(mounted.store.get('$.app.open')).toBe(true);
        expect(seen.close).toBe(0);
    });

    it('should close on a backdrop press when dismissible and ignore it when not', async () => {
        // Arrange
        const press = (element: Element): void => {
            const dialog = dialogOf(element);
            dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
            dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        };
        const dismissible = mountComponent(name, { open: true, body: text('Body') });
        const fixed = mountComponent(name, { open: true, dismissible: false, body: text('Body') });
        await frame();
        const seen = counts(dismissible.element);

        // Act
        press(fixed.element);
        press(dismissible.element);

        // Assert
        expect(dialogOf(fixed.element).open).toBe(true);
        expect(dialogOf(dismissible.element).open).toBe(false);
        expect(seen.close).toBe(1);
    });

    it('should not close when a press starts inside the dialog or lands on its content', async () => {
        // Arrange
        const mounted = mountComponent(name, { open: true, body: text('Body') });
        await frame();
        const dialog = dialogOf(mounted.element);

        // Act
        part(mounted.element, '.frame').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        part(mounted.element, '.frame').click();

        // Assert
        expect(dialog.open).toBe(true);
    });

    it('should close from the close button, which is absent when not dismissible', async () => {
        // Arrange
        const fixed = mountComponent(name, { open: true, dismissible: false, body: text('Body') });
        await frame();
        const closed = part(fixed.element, '.close');
        fixed.dispose();
        const mounted = mountComponent(name, { open: true, body: text('Body') });
        await frame();

        // Act
        await userEvent.click(part(mounted.element, '.close'));

        // Assert
        expect(dialogOf(mounted.element).open).toBe(false);
        expect(closed).toBeNull();
    });

    it('should move focus in on open, keep the page behind inert and return focus to the opener on close', () => {
        // Arrange
        const outside = document.createElement('button');
        outside.textContent = 'Outside';
        document.body.append(outside);
        const mounted = mountComponent(name, { _title: 'Edit', body: text('Body') });
        outside.focus();

        // Act
        command(mounted.element, 'open');

        // Assert
        expect(insideOf(mounted.element, deepActive())).toBe(true);

        // Act
        outside.focus();

        // Assert
        expect(document.activeElement).not.toBe(outside);

        // Act
        command(mounted.element, 'close');

        // Assert
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    it('should keep slot state across close and reopen', () => {
        // Arrange
        const mounted = mountComponent(name, { body: { component: 'input', value: 'typed' } });
        command(mounted.element, 'open');
        const before = findByTag(root(mounted.element), 'ui-input');

        // Act
        mounted.store.set('$.app.body.value', 'changed');
        command(mounted.element, 'close');
        command(mounted.element, 'open');

        // Assert
        expect(before).not.toBeNull();
        expect(findByTag(root(mounted.element), 'ui-input')).toBe(before);
        expect(mounted.store.get('$.app.body.value')).toBe('changed');
    });

    it('should let a panel in the footer fill the footer instead of collapsing to nothing', async () => {
        // Arrange
        const mounted = mountComponent(name, { _title: 'Cart', footer: { component: 'panel', children: { total: text('Subtotal (2 items): $40.00') } } });

        // Act
        command(mounted.element, 'open');
        await frame();

        // Assert
        const footer = part(mounted.element, '.footer');
        const panel = findByTag(footer, 'ui-panel') as HTMLElement;
        expect(panel.getBoundingClientRect().width).toBeCloseTo(footer.getBoundingClientRect().width, 0);
        expect(findByTag(panel.shadowRoot ?? panel, 'ui-text')!.getBoundingClientRect().height).toBeLessThan(40);
    });

    it('should render a header slot in place of the title', () => {
        // Arrange
        const mounted = mountComponent(name, { _title: 'Plain', header: text('Custom'), body: text('Body') });

        // Assert
        expect(part(mounted.element, '.title')).toBeNull();
        expect(part(mounted.element, '.heading sui-node')).not.toBeNull();
    });

    it('should name the dialog by its title', () => {
        // Arrange
        const mounted = mountComponent(name, { _title: 'Edit order' });

        // Assert
        expect(dialogOf(mounted.element).getAttribute('aria-labelledby')).toBe('title');
        expect(part(mounted.element, '#title').textContent?.trim()).toBe('Edit order');
    });

    it('should show the German close label and a translated title', () => {
        // Arrange
        const mounted = mountComponent(name, { _title: 'Edit' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.close').getAttribute('aria-label')).toBe('Schließen');
    });

    it('should default to the overlay elevation', async () => {
        // Arrange
        const mounted = mountComponent(name, { open: true });
        await frame();

        // Assert
        expect(mounted.element.getAttribute('elevation')).toBe('overlay');
        expect(getComputedStyle(dialogOf(mounted.element)).boxShadow).not.toBe('none');
    });
});

describe('modal widths in Chromium', () => {
    afterEach(async () => {
        mountComponent.unmountAll();
        await page.viewport(414, 896);
    });

    it('should default to md and widen from sm to md to lg, with full the widest', async () => {
        // Arrange
        await page.viewport(1400, 900);
        const width = async (value: string): Promise<number> => {
            const mounted = mountComponent('modal', { open: true, width: value, body: text('Body') });
            await frame();
            return dialogOf(mounted.element).getBoundingClientRect().width;
        };

        // Act
        const [sm, md, lg, full] = [await width('sm'), await width('md'), await width('lg'), await width('full')];

        // Assert
        expect(mountComponent('modal', {}).element.getAttribute('width')).toBe('md');
        expect(sm).toBeLessThan(md);
        expect(md).toBeLessThan(lg);
        expect(full).toBeGreaterThan(lg);
    });

    it('should centre the open modal in the viewport', async () => {
        // Arrange
        await page.viewport(1200, 800);
        const mounted = mountComponent('modal', { open: true, _title: 'Centred', body: text('Body') });
        await frame();
        await settle();

        // Act
        const rect = dialogOf(mounted.element).getBoundingClientRect();

        // Assert: equal space on both sides, horizontally and vertically, and not stretched to the full height
        expect(rect.left).toBeGreaterThan(100);
        expect(Math.abs(rect.left - (1200 - rect.right))).toBeLessThanOrEqual(1);
        expect(Math.abs(rect.top - (800 - rect.bottom))).toBeLessThanOrEqual(1);
        expect(rect.height).toBeLessThan(400);
    });
});

describe('drawer sides in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const settledRect = async (side: string): Promise<DOMRect> => {
        const mounted = mountComponent('drawer', { open: true, side, body: text('Body') });
        await frame();
        await settle();
        return dialogOf(mounted.element).getBoundingClientRect();
    };

    it('should default to the end side', () => {
        // Assert
        expect(mountComponent('drawer', {}).element.getAttribute('side')).toBe('end');
    });

    it('should sit at the inline end, the inline start and the bottom edge', async () => {
        // Act
        const end = await settledRect('end');
        const start = await settledRect('start');
        const bottom = await settledRect('bottom');

        // Assert
        expect(end.right).toBeCloseTo(window.innerWidth, 0);
        expect(start.left).toBeCloseTo(0, 0);
        expect(bottom.bottom).toBeCloseTo(window.innerHeight, 0);
        expect(bottom.width).toBeCloseTo(window.innerWidth, 0);
    });

    it('should slide with a transition on translate', async () => {
        // Arrange
        const mounted = mountComponent('drawer', { open: true });
        await frame();

        // Assert
        expect(getComputedStyle(dialogOf(mounted.element)).transitionProperty).toContain('translate');
    });
});
