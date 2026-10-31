import { cdp, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

interface AxNode {
    role?: { value: string };
    name?: { value: string };
    description?: { value: string };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const tipOf = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.tip') as HTMLElement;
const isOpen = (element: Element): boolean => tipOf(element).matches(':popover-open');

/** The native button inside the trigger's `button` component, which is inside the tooltip's shadow root */
const nativeOf = (element: Element): HTMLButtonElement => {
    const button = element.shadowRoot?.querySelector('ui-button') as Element;
    return button.shadowRoot?.querySelector('button') as HTMLButtonElement;
};

const trigger = { component: 'button', _title: 'Go' };

/** The accessibility tree of the test iframe, which is what a screen reader is given */
async function axNodes(): Promise<AxNode[]> {
    const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
    await session.send('Accessibility.enable');
    const { frameTree } = (await session.send('Page.getFrameTree')) as {
        frameTree: { frame: { id: string }; childFrames?: { frame: { id: string } }[] };
    };
    const frameId = frameTree.childFrames?.[0]?.frame.id ?? frameTree.frame.id;
    const { nodes } = (await session.send('Accessibility.getFullAXTree', { frameId })) as { nodes: AxNode[] };
    return nodes;
}

const axButton = async (name: string): Promise<AxNode | undefined> =>
    (await axNodes()).find((node) => node.role?.value === 'button' && node.name?.value === name);

/** Room around the mounted component so no side of the tip needs the browser's fallback placement */
const spaced = (mounted: MountedComponent): MountedComponent => {
    mounted.host.style.padding = '160px 200px';
    return mounted;
};

describe('tooltip in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should default to the top side and a 500 ms delay, and hide its text until shown', () => {
        // Arrange and Act
        const mounted = mountComponent('tooltip', { _text: 'Saves', trigger });

        // Assert
        expect(mounted.element.getAttribute('side')).toBe('top');
        expect(mounted.store.get('$.app.delay')).toBe(500);
        expect(tipOf(mounted.element).textContent).toBe('Saves');
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should show after the delay on pointer hover and hide on pointer leave', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { _text: 'Saves', delay: 200, trigger });

        // Act
        await userEvent.hover(nativeOf(mounted.element));
        await sleep(60);
        const early = isOpen(mounted.element);
        await sleep(300);
        const late = isOpen(mounted.element);
        await userEvent.unhover(nativeOf(mounted.element));

        // Assert
        expect(early).toBe(false);
        expect(late).toBe(true);
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should not show when the pointer leaves before the delay ends', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { delay: 200, trigger });

        // Act
        await userEvent.hover(nativeOf(mounted.element));
        await userEvent.unhover(nativeOf(mounted.element));
        await sleep(350);

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should show at once when the trigger takes focus, whatever the delay, and hide on blur', () => {
        // Arrange
        const mounted = mountComponent('tooltip', { delay: 5000, trigger });

        // Act
        nativeOf(mounted.element).focus();
        const focused = isOpen(mounted.element);
        nativeOf(mounted.element).blur();

        // Assert
        expect(focused).toBe(true);
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should show at once on hover when the delay is 0', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { delay: 0, trigger });

        // Act
        await userEvent.hover(nativeOf(mounted.element));

        // Assert
        expect(isOpen(mounted.element)).toBe(true);
    });

    it('should hide on Escape and stay hidden while the trigger keeps focus', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { trigger });
        nativeOf(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should cancel a pending show on Escape', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { delay: 200, trigger });
        await userEvent.hover(nativeOf(mounted.element));

        // Act
        await userEvent.keyboard('{Escape}');
        await sleep(350);

        // Assert
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should hide on a press outside the tooltip', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { trigger });
        nativeOf(mounted.element).focus();
        const outside = document.body.appendChild(document.createElement('div'));
        outside.style.cssText = 'width:40px;height:40px';

        // Act
        await userEvent.click(outside);

        // Assert
        outside.remove();
        expect(isOpen(mounted.element)).toBe(false);
    });

    it('should describe the trigger with the tooltip text in the accessibility tree', async () => {
        // Arrange and Act
        const mounted = mountComponent('tooltip', { _text: 'Saves the record', trigger });
        const node = await axButton('Go');

        // Assert
        expect(mounted.element.isConnected).toBe(true);
        expect(node?.description?.value).toBe('Saves the record');
    });

    it('should keep the trigger name and follow a text change in the accessibility tree', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { _text: 'Saves the record', trigger });

        // Act
        mounted.store.set('$.app._text', 'Sends the record');
        const node = await axButton('Go');

        // Assert
        expect(node?.description?.value).toBe('Sends the record');
    });

    it('should show and describe with the German text', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { trigger }, { locale: 'de' });

        // Act
        nativeOf(mounted.element).focus();
        const node = await axButton('Go');

        // Assert
        expect(tipOf(mounted.element).textContent).toBe('Kurzinfo');
        expect(isOpen(mounted.element)).toBe(true);
        expect(node?.description?.value).toBe('Kurzinfo');
    });

    it('should remove the description when the text is empty', async () => {
        // Arrange
        const mounted = mountComponent('tooltip', { _text: 'Saves', trigger });

        // Act
        mounted.store.set('$.app._text', '');
        const node = await axButton('Go');

        // Assert
        expect(node?.description?.value ?? '').toBe('');
    });

    it('should hold text only: the tip has no focusable content', () => {
        // Arrange and Act
        const mounted = mountComponent('tooltip', { _text: 'Saves', trigger });

        // Assert
        expect(tipOf(mounted.element).querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
        expect(tipOf(mounted.element).getAttribute('aria-hidden')).toBe('true');
    });

    it.each([
        ['top', (t: DOMRect, p: DOMRect) => Math.abs(p.bottom - t.top) < 12 && p.top < t.top],
        ['bottom', (t: DOMRect, p: DOMRect) => Math.abs(p.top - t.bottom) < 12 && p.bottom > t.bottom],
        ['start', (t: DOMRect, p: DOMRect) => Math.abs(p.right - t.left) < 12 && p.right <= t.left],
        ['end', (t: DOMRect, p: DOMRect) => Math.abs(p.left - t.right) < 12 && p.left >= t.right]
    ])('should place the tip on the %s side of the trigger', (side, onSide) => {
        // Arrange
        const mounted = spaced(mountComponent('tooltip', { side, _text: 'Saves the record', trigger }));
        nativeOf(mounted.element).focus();

        // Act
        const triggerBox = nativeOf(mounted.element).getBoundingClientRect();
        const tipBox = tipOf(mounted.element).getBoundingClientRect();

        // Assert
        expect(tipBox.width).toBeGreaterThan(0);
        expect(onSide(triggerBox, tipBox)).toBe(true);
    });

    it('should follow a change of side while open', () => {
        // Arrange
        const mounted = spaced(mountComponent('tooltip', { side: 'top', trigger }));
        nativeOf(mounted.element).focus();

        // Act
        mounted.store.set('$.app.side', 'bottom');
        const triggerBox = nativeOf(mounted.element).getBoundingClientRect();
        const tipBox = tipOf(mounted.element).getBoundingClientRect();

        // Assert
        expect(tipBox.top).toBeGreaterThanOrEqual(triggerBox.bottom - 1);
    });

    it('should anchor two tooltips on one page each to its own trigger', () => {
        // Arrange
        const first = mountComponent('tooltip', { side: 'top', _text: 'First', trigger: { component: 'button', _title: 'One' } });
        first.host.style.padding = '120px 100px 20px';
        const second = mountComponent('tooltip', { side: 'bottom', _text: 'Second', trigger: { component: 'button', _title: 'Two' } });
        second.host.style.padding = '20px 100px 120px';

        // Act
        nativeOf(first.element).focus();
        const firstShown = isOpen(first.element);
        nativeOf(second.element).focus();
        const firstTrigger = nativeOf(first.element).getBoundingClientRect();
        const secondTrigger = nativeOf(second.element).getBoundingClientRect();
        const firstTip = tipOf(first.element).getBoundingClientRect();
        const secondTip = tipOf(second.element).getBoundingClientRect();

        // Assert
        expect(firstShown).toBe(true);
        expect(Math.abs(firstTip.bottom - firstTrigger.top)).toBeLessThan(12);
        expect(Math.abs(secondTip.top - secondTrigger.bottom)).toBeLessThan(12);
        expect(Math.abs(firstTip.left + firstTip.width / 2 - (firstTrigger.left + firstTrigger.width / 2))).toBeLessThan(1);
    });

    it('should show without a transition under the reduced motion overlay', () => {
        // Arrange
        const mounted = mountComponent('tooltip', { trigger }, { motion: 'reduced' });

        // Act
        nativeOf(mounted.element).focus();
        const durations = getComputedStyle(tipOf(mounted.element)).transitionDuration.split(',').map((value) => value.trim());

        // Assert
        expect(isOpen(mounted.element)).toBe(true);
        expect(durations.every((value) => value === '0s')).toBe(true);
    });

    it('should fade in with a transition under the full motion overlay', () => {
        // Arrange
        const mounted = mountComponent('tooltip', { trigger }, { motion: 'full' });

        // Act
        const durations = getComputedStyle(tipOf(mounted.element)).transitionDuration.split(',').map((value) => value.trim());

        // Assert
        expect(durations.some((value) => value !== '0s')).toBe(true);
    });

    it('should use the component tokens for padding, radius and the largest width', () => {
        // Arrange
        const mounted = mountComponent('tooltip', { _text: 'Saves', trigger });
        nativeOf(mounted.element).focus();

        // Act
        const style = getComputedStyle(tipOf(mounted.element));

        // Assert
        expect(style.borderTopLeftRadius).toBe('4px');
        expect(style.paddingTop).not.toBe('0px');
        expect(style.maxWidth).toBe('288px');
    });
});

describe('icon-only button tip in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const tip = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.tip') as HTMLElement;
    const button = (element: Element): HTMLButtonElement => element.shadowRoot?.querySelector('button') as HTMLButtonElement;
    const open = (element: Element): boolean => tip(element).matches(':popover-open');

    it('should show its title on focus without a tooltip node', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add item' });

        // Act
        button(mounted.element).focus();

        // Assert
        expect(open(mounted.element)).toBe(true);
        expect(tip(mounted.element).textContent).toBe('Add item');
        expect(mounted.host.querySelector('ui-tooltip')).toBeNull();
        expect(Array.from(mounted.host.querySelectorAll('*')).some((node) => node.localName === 'ui-tooltip')).toBe(false);
    });

    it('should show after the default delay on hover and hide on pointer leave', async () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add item' });

        // Act
        await userEvent.hover(button(mounted.element));
        await sleep(150);
        const early = open(mounted.element);
        await sleep(550);
        const late = open(mounted.element);
        await userEvent.unhover(button(mounted.element));

        // Assert
        expect(early).toBe(false);
        expect(late).toBe(true);
        expect(open(mounted.element)).toBe(false);
    });

    it('should hide on Escape', async () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add item' });
        button(mounted.element).focus();

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(open(mounted.element)).toBe(false);
    });

    it('should keep the title as the accessible name and add no duplicate description', async () => {
        // Arrange
        mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add item' });

        // Act
        const node = await axButton('Add item');

        // Assert
        expect(node).toBeDefined();
        expect(node?.description?.value ?? '').toBe('');
    });

    it('should show nothing for a button with a visible label', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'start', _title: 'Add item' });

        // Act
        button(mounted.element).focus();

        // Assert
        expect(open(mounted.element)).toBe(false);
    });

    it('should start showing when the button becomes icon-only', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'start', _title: 'Add item' });

        // Act
        mounted.store.set('$.app.iconPosition', 'only');
        button(mounted.element).focus();

        // Assert
        expect(open(mounted.element)).toBe(true);
    });

    it('should show the German title', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only' }, { locale: 'de' });

        // Act
        button(mounted.element).focus();

        // Assert
        expect(tip(mounted.element).textContent).toBe('Schaltfläche');
        expect(open(mounted.element)).toBe(true);
    });

    it('should place the tip above the button', () => {
        // Arrange
        const mounted = mountComponent('button', { icon: 'plus', iconPosition: 'only', _title: 'Add item' });
        mounted.host.style.padding = '120px 100px';

        // Act
        button(mounted.element).focus();
        const buttonBox = button(mounted.element).getBoundingClientRect();
        const tipBox = tip(mounted.element).getBoundingClientRect();

        // Assert
        expect(tipBox.bottom).toBeLessThanOrEqual(buttonBox.top + 1);
        expect(Math.abs(tipBox.bottom - buttonBox.top)).toBeLessThan(12);
    });
});
