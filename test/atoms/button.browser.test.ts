import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const native = (element: Element): HTMLButtonElement => element.shadowRoot?.querySelector('button') as HTMLButtonElement;

type Commanded = Element & { commands: Record<string, () => void> };

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** The colour a design token resolves to in the mounted app, read through a probe element */
const tokenColour = (mounted: MountedComponent, token: string): string => {
    const probe = (mounted.element.shadowRoot as ShadowRoot).appendChild(document.createElement('span'));
    probe.style.color = `var(${token})`;
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
};

const presses = (element: Element): { count: number } => {
    const seen = { count: 0 };
    element.addEventListener('press', () => {
        seen.count += 1;
    });
    return seen;
};

describe('button in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render the title and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('button', { _title: 'Save' });

        // Act
        mounted.store.set('$.app._title', 'Send');

        // Assert
        expect(native(mounted.element).textContent?.trim()).toBe('Send');
        expect(native(mounted.element).getAttribute('aria-label')).toBeNull();
    });

    it('should show content linked to $.data and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('button', { '<-_title': '$.data.label' }, { data: { label: 'One' } });

        // Act
        mounted.store.set('$.data.label', 'Two');

        // Assert
        expect(native(mounted.element).textContent?.trim()).toBe('Two');
    });

    it('should default to the accent tone, the solid variant and the md size', () => {
        // Arrange and Act
        const mounted = mountComponent('button');

        // Assert
        expect(mounted.element.getAttribute('tone')).toBe('accent');
        expect(mounted.element.getAttribute('variant')).toBe('solid');
        expect(mounted.element.getAttribute('size')).toBe('md');
    });

    it('should fill with the tone for the solid variant of tone danger', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'solid' });

        // Act
        const style = getComputedStyle(native(mounted.element));

        // Assert
        expect(style.backgroundColor).toBe(tokenColour(mounted, '--ui-color-danger-base'));
        expect(style.color).toBe(tokenColour(mounted, '--ui-color-danger-on'));
    });

    it('should fill with the soft tone for the soft variant of tone danger', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'soft' });

        // Act
        const style = getComputedStyle(native(mounted.element));

        // Assert
        expect(style.backgroundColor).toBe(tokenColour(mounted, '--ui-color-danger-soft'));
        expect(style.color).toBe(tokenColour(mounted, '--ui-color-danger-base'));
    });

    it('should draw a tone border and no fill for the outline variant of tone danger', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'outline' });

        // Act
        const style = getComputedStyle(native(mounted.element));

        // Assert
        expect(style.borderTopColor).toBe(tokenColour(mounted, '--ui-color-danger-base'));
        expect(style.backgroundColor).toBe(TRANSPARENT);
        expect(style.color).toBe(tokenColour(mounted, '--ui-color-danger-base'));
    });

    it('should draw neither border nor fill for the ghost variant of tone danger', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'ghost' });

        // Act
        const style = getComputedStyle(native(mounted.element));

        // Assert
        expect(style.borderTopColor).toBe(TRANSPARENT);
        expect(style.backgroundColor).toBe(TRANSPARENT);
        expect(style.color).toBe(tokenColour(mounted, '--ui-color-danger-base'));
    });

    it('should look like underlined text for the link variant of tone danger', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'link' });

        // Act
        const style = getComputedStyle(native(mounted.element));

        // Assert
        expect(style.backgroundColor).toBe(TRANSPARENT);
        expect(style.color).toBe(tokenColour(mounted, '--ui-color-danger-base'));
        expect(style.textDecorationLine).toBe('underline');
        expect(style.paddingInlineStart).toBe('0px');
    });

    it('should change colours in the dark overlay', () => {
        // Arrange
        const mounted = mountComponent('button', { tone: 'danger', variant: 'ghost' }, { mode: 'light' });
        const light = getComputedStyle(native(mounted.element)).color;

        // Act
        mounted.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(native(mounted.element)).color).not.toBe(light);
    });

    it('should raise press once per click', async () => {
        // Arrange
        const mounted = mountComponent('button');
        const seen = presses(mounted.element);

        // Act
        await userEvent.click(native(mounted.element));

        // Assert
        expect(seen.count).toBe(1);
    });

    it.each(['{Enter}', ' '])('should raise press once for the key %j on the focused button', async (key) => {
        // Arrange
        const mounted = mountComponent('button');
        const seen = presses(mounted.element);
        native(mounted.element).focus();

        // Act
        await userEvent.keyboard(key);

        // Assert
        expect(seen.count).toBe(1);
    });

    it('should not raise press while disabled', () => {
        // Arrange
        const mounted = mountComponent('button', { disabled: true });
        const seen = presses(mounted.element);

        // Act
        native(mounted.element).click();

        // Assert
        expect(native(mounted.element).disabled).toBe(true);
        expect(seen.count).toBe(0);
        expect(getComputedStyle(native(mounted.element)).cursor).toBe('not-allowed');
    });

    it('should not raise press while busy, and raise it again when the busy flag clears', () => {
        // Arrange
        const mounted = mountComponent('button', { busy: true });
        const seen = presses(mounted.element);

        // Act
        native(mounted.element).click();
        const blocked = seen.count;
        mounted.store.set('$.app.busy', false);
        native(mounted.element).click();

        // Assert
        expect(blocked).toBe(0);
        expect(seen.count).toBe(1);
    });

    it('should draw a busy indicator in its own CSS and keep the width', () => {
        // Arrange
        const mounted = mountComponent('button', { _title: 'Save order' });
        const idle = native(mounted.element).getBoundingClientRect().width;

        // Act
        mounted.store.set('$.app.busy', true);

        // Assert
        const indicator = mounted.element.shadowRoot?.querySelector('.busy') as HTMLElement;
        expect(indicator).not.toBeNull();
        expect(getComputedStyle(indicator).animationName).toBe('busy-spin');
        expect(native(mounted.element).getAttribute('aria-busy')).toBe('true');
        expect(native(mounted.element).getBoundingClientRect().width).toBe(idle);
        expect(native(mounted.element).textContent).toContain('Save order');
    });

    it('should stop the busy animation under reduced motion', () => {
        // Arrange
        const mounted = mountComponent('button', { busy: true }, { motion: 'reduced' });

        // Act
        const indicator = mounted.element.shadowRoot?.querySelector('.busy') as HTMLElement;

        // Assert
        expect(getComputedStyle(indicator).animationDuration).toBe('0s');
    });

    it('should name an icon-only button by its title and draw no label', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add order' });

        // Act
        const button = native(mounted.element);

        // Assert
        expect(button.getAttribute('aria-label')).toBe('Add order');
        expect(button.querySelector('.label')).toBeNull();
        expect(button.querySelector('svg')).not.toBeNull();
    });

    it('should draw the icon before the label by default and after it with iconPosition end', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', _title: 'Add' });
        const glyph = (): HTMLElement => mounted.element.shadowRoot?.querySelector('.glyph') as HTMLElement;
        const label = (): HTMLElement => mounted.element.shadowRoot?.querySelector('.label') as HTMLElement;
        const startsBefore = glyph().getBoundingClientRect().left < label().getBoundingClientRect().left;

        // Act
        mounted.store.set('$.app.iconPosition', 'end');

        // Assert
        expect(startsBefore).toBe(true);
        expect(glyph().getBoundingClientRect().left).toBeGreaterThan(label().getBoundingClientRect().left);
    });

    it('should redraw the icon when icon changes and remove it when it is emptied', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus' });
        const glyph = (): Element | null | undefined => mounted.element.shadowRoot?.querySelector('.glyph');
        const first = glyph()?.innerHTML;

        // Act
        mounted.store.set('$.app.icon', 'search');
        const second = glyph()?.innerHTML;
        mounted.store.set('$.app.icon', '');

        // Assert
        expect(first).toContain('path');
        expect(second).toContain('path');
        expect(second).not.toBe(first);
        expect(glyph()).toBeNull();
    });

    it('should run the on entry of the node, writing the target', () => {
        // Arrange
        const mounted = mountComponent('button', { on: { press: { command: 'set', target: '$.data.clicked', value: true } } });

        // Act
        native(mounted.element).click();

        // Assert
        expect(mounted.store.get('$.data.clicked')).toBe(true);
    });

    it('should stretch to the container width with fill', () => {
        // Arrange
        const mounted = mountComponent('button');
        mounted.host.style.width = '400px';
        const natural = native(mounted.element).getBoundingClientRect().width;

        // Act
        mounted.store.set('$.app.fill', true);

        // Assert
        expect(natural).toBeLessThan(200);
        expect(native(mounted.element).getBoundingClientRect().width).toBe(400);
    });

    it('should move focus into the button when the focus command runs', () => {
        // Arrange
        const mounted = mountComponent('button');

        // Act
        (mounted.element as Commanded).commands.focus?.();

        // Assert
        expect(mounted.element.shadowRoot?.activeElement).toBe(native(mounted.element));
    });

    it('should apply the radius token and a node override of it', () => {
        // Arrange
        const mounted = mountComponent('button');
        const before = getComputedStyle(native(mounted.element)).borderTopLeftRadius;

        // Act
        (mounted.element as HTMLElement).style.setProperty('--ui-button-radius', '0px');

        // Assert
        expect(before).toBe('6px');
        expect(getComputedStyle(native(mounted.element)).borderTopLeftRadius).toBe('0px');
    });

    it('should grow with size', () => {
        // Arrange
        const mounted = mountComponent('button', { size: 'sm' });
        const small = native(mounted.element).getBoundingClientRect().height;

        // Act
        mounted.store.set('$.app.size', 'lg');

        // Assert
        expect(native(mounted.element).getBoundingClientRect().height).toBeGreaterThan(small);
    });

    it('should show the German title after the locale switches', () => {
        // Arrange
        const mounted = mountComponent('button');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(native(mounted.element).textContent?.trim()).toBe('Schaltfläche');
    });

    it('should keep a title the author wrote when the language changes', () => {
        // Arrange
        const mounted = mountComponent('button', { _title: 'Save' });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(native(mounted.element).textContent?.trim()).toBe('Save');
    });
});
