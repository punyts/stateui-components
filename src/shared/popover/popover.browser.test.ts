import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { createPopover } from './popover.js';
import type { Placement, PopoverDismissReason } from './popover.js';

/** A plain page with an anchor and a popover and no component: the popover code works on any elements */
function page(): { anchor: HTMLElement; element: HTMLElement; outside: HTMLElement } {
    const style = document.createElement('style');
    style.textContent = `
        #anchor { anchor-name: --a; margin: 200px 0 0 200px; width: 80px; height: 30px; display: block; }
        #pop { margin: 0; border: 0; padding: 4px; inset: auto; position-try-fallbacks: none; }
        #outside { width: 50px; height: 50px; }`;
    document.head.append(style);
    document.body.insertAdjacentHTML(
        'beforeend',
        '<button id="anchor">Anchor</button><div id="pop">Text</div><div id="outside"></div>'
    );
    const find = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
    return { anchor: find('anchor'), element: find('pop'), outside: find('outside') };
}

afterEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('style').forEach((style) => style.remove());
});

describe('createPopover in Chromium', () => {
    it('should make the element a manual popover and open and close it', () => {
        // Arrange
        const { element } = page();
        const popover = createPopover({ element });

        // Act
        popover.open();
        const opened = popover.isOpen();
        popover.close();

        // Assert
        expect(element.getAttribute('popover')).toBe('manual');
        expect(opened).toBe(true);
        expect(popover.isOpen()).toBe(false);
    });

    it('should keep an existing popover attribute', () => {
        // Arrange
        const { element } = page();
        element.setAttribute('popover', 'auto');

        // Act
        createPopover({ element });

        // Assert
        expect(element.getAttribute('popover')).toBe('auto');
    });

    it('should do nothing when the element is not connected', () => {
        // Arrange
        const element = document.createElement('div');
        const popover = createPopover({ element });

        // Act
        popover.open();

        // Assert
        expect(popover.isOpen()).toBe(false);
    });

    it.each([
        ['top', (a: DOMRect, p: DOMRect) => Math.abs(p.bottom - a.top) < 1],
        ['bottom', (a: DOMRect, p: DOMRect) => Math.abs(p.top - a.bottom) < 1],
        ['start', (a: DOMRect, p: DOMRect) => Math.abs(p.right - a.left) < 1],
        ['end', (a: DOMRect, p: DOMRect) => Math.abs(p.left - a.right) < 1]
    ] as [Placement, (a: DOMRect, p: DOMRect) => boolean][])('should place the popover on the %s side of the anchor', (placement, onSide) => {
        // Arrange
        const { anchor, element } = page();
        const popover = createPopover({ element, placement, anchor: '--a' });

        // Act
        popover.open();

        // Assert
        expect(onSide(anchor.getBoundingClientRect(), element.getBoundingClientRect())).toBe(true);
    });

    it('should move to another side with setPlacement and follow the anchor when it moves', () => {
        // Arrange
        const { anchor, element } = page();
        const popover = createPopover({ element, placement: 'top', anchor: '--a' });
        popover.open();

        // Act
        popover.setPlacement('bottom');
        anchor.style.marginLeft = '300px';
        const a = anchor.getBoundingClientRect();
        const p = element.getBoundingClientRect();

        // Assert
        expect(Math.abs(p.top - a.bottom)).toBeLessThan(1);
        expect(Math.abs(p.left + p.width / 2 - (a.left + a.width / 2))).toBeLessThan(1);
    });

    it('should refuse an anchor that is not a dashed identifier and an unknown placement', () => {
        // Arrange
        const { element } = page();

        // Act and Assert
        expect(() => createPopover({ element, anchor: 'a;color:red' })).toThrow(TypeError);
        expect(() => createPopover({ element, placement: 'left' as Placement })).toThrow(TypeError);
    });

    it('should close on Escape and report the reason', async () => {
        // Arrange
        const { element } = page();
        const reasons: PopoverDismissReason[] = [];
        const popover = createPopover({ element, onDismiss: (reason) => reasons.push(reason) });
        popover.open();

        // Act
        await userEvent.keyboard('{Escape}');

        // Assert
        expect(popover.isOpen()).toBe(false);
        expect(reasons).toEqual(['escape']);
    });

    it('should close on a press outside and stay open for a press inside it or on the inside list', async () => {
        // Arrange
        const { anchor, element, outside } = page();
        const reasons: PopoverDismissReason[] = [];
        const popover = createPopover({ element, inside: [anchor], onDismiss: (reason) => reasons.push(reason) });
        popover.open();

        // Act
        await userEvent.click(element);
        await userEvent.click(anchor);
        const stillOpen = popover.isOpen();
        await userEvent.click(outside);

        // Assert
        expect(stillOpen).toBe(true);
        expect(popover.isOpen()).toBe(false);
        expect(reasons).toEqual(['outside']);
    });

    it('should ignore Escape and an outside press while dismissible answers false, and still close by close()', async () => {
        // Arrange
        const { element, outside } = page();
        const reasons: PopoverDismissReason[] = [];
        let dismissible = false;
        const popover = createPopover({ element, dismissible: () => dismissible, onDismiss: (reason) => reasons.push(reason) });
        popover.open();

        // Act
        await userEvent.keyboard('{Escape}');
        await userEvent.click(outside);
        const stillOpen = popover.isOpen();
        dismissible = true;
        await userEvent.keyboard('{Escape}');
        const closedWhenDismissible = !popover.isOpen();
        popover.open();
        dismissible = false;
        popover.close();

        // Assert
        expect(stillOpen).toBe(true);
        expect(closedWhenDismissible).toBe(true);
        expect(popover.isOpen()).toBe(false);
        expect(reasons).toEqual(['escape']);
    });

    it('should not report a dismissal for close() and stop listening once closed', async () => {
        // Arrange
        const { element, outside } = page();
        const reasons: PopoverDismissReason[] = [];
        const popover = createPopover({ element, onDismiss: (reason) => reasons.push(reason) });
        popover.open();

        // Act
        popover.close();
        await userEvent.keyboard('{Escape}');
        await userEvent.click(outside);

        // Assert
        expect(reasons).toEqual([]);
    });

    it('should close and refuse to open after dispose', () => {
        // Arrange
        const { element } = page();
        const popover = createPopover({ element });
        popover.open();

        // Act
        popover.dispose();
        popover.open();

        // Assert
        expect(popover.isOpen()).toBe(false);
    });
});
