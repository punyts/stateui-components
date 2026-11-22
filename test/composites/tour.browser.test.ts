import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent } from '../harness/createMountComponent.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames = async (count = 3): Promise<void> => {
    for (let index = 0; index < count; index++) await new Promise((resolve) => requestAnimationFrame(resolve));
    await flush();
};

const steps = {
    name: { target: '$.app.children.name', _title: 'Your name', _text: 'Shown on invoices' },
    save: { target: '$.app.children.save', side: 'top', _title: 'Save', _text: 'Keeps your changes' },
    gone: { target: '$.app.children.nowhere', _title: 'Elsewhere', _text: 'Not on this screen' }
};

const tourOf = (mounted: MountedComponent): Element => {
    const node = mounted.element.shadowRoot?.querySelector('sui-node[state="$.app.children.tour"]') as Element;
    return node.firstElementChild as Element;
};
const part = (tour: Element, selector: string): HTMLElement => tour.shadowRoot?.querySelector(selector) as HTMLElement;
const target = (mounted: MountedComponent, key: string): Element =>
    (mounted.element.shadowRoot?.querySelector(`sui-node[state="$.app.children.${key}"]`) as Element).firstElementChild as Element;

const mountTour = async (tour: Record<string, unknown> = {}): Promise<MountedComponent> => {
    const mounted = mountComponent('panel', {
        children: {
            name: { component: 'textField', _label: 'Name' },
            save: { component: 'button', _title: 'Save' },
            tour: { component: 'tour', steps, ...tour }
        }
    });
    (mounted.element as HTMLElement).style.cssText = 'display: block; margin: 200px 80px; inline-size: 400px';
    await frames();
    return mounted;
};

describe('tour in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should not show before it starts, then show the first step beside its node with the focus on Next', async () => {
        // Arrange
        const mounted = await mountTour();
        const tour = tourOf(mounted);
        const before = part(tour, '.card').matches(':popover-open');

        // Act
        (tour as Element & { commands: Record<string, () => void> }).commands['start']?.();
        await frames();
        const ring = part(tour, '.ring').getBoundingClientRect();
        const field = target(mounted, 'name').getBoundingClientRect();
        const card = part(tour, '.card').getBoundingClientRect();

        // Assert
        expect(before).toBe(false);
        expect(part(tour, '.card').matches(':popover-open')).toBe(true);
        expect(part(tour, '.title').textContent).toBe('Your name');
        expect(part(tour, '.progress').textContent).toBe('1 of 3');
        expect(ring.left).toBeCloseTo(field.left - 4, 0);
        expect(ring.width).toBeCloseTo(field.width + 8, 0);
        expect(card.top).toBeGreaterThanOrEqual(ring.bottom);
        expect(tour.shadowRoot?.activeElement).toBe(part(tour, '.next'));
        expect(part(tour, '.back').hidden).toBe(true);
    });

    it('should move on with Next and back with Back, keeping the step in state and raising change', async () => {
        // Arrange
        const mounted = await mountTour({ step: 'name' });
        const tour = tourOf(mounted);
        const changes: unknown[] = [];
        tour.addEventListener('change', (event) => changes.push((event as CustomEvent).detail));
        await frames();

        // Act
        await userEvent.click(part(tour, '.next'));
        await frames();
        const card = part(tour, '.card').getBoundingClientRect();
        const ring = part(tour, '.ring').getBoundingClientRect();
        const atSave = mounted.store.get('$.app.children.tour.step');
        await userEvent.click(part(tour, '.back'));
        await frames();

        // Assert
        expect(atSave).toBe('save');
        expect(card.bottom).toBeLessThanOrEqual(ring.top + 1);
        expect(changes).toEqual(['save', 'name']);
        expect(part(tour, '.title').textContent).toBe('Your name');
    });

    it('should show a step whose node is not drawn in the middle, and finish with Done', async () => {
        // Arrange
        const mounted = await mountTour({ step: 'gone' });
        const tour = tourOf(mounted);
        const finished: unknown[] = [];
        tour.addEventListener('finish', (event) => finished.push((event as CustomEvent).detail));
        await frames(40);
        const card = part(tour, '.card').getBoundingClientRect();
        const label = part(tour, '.next').textContent;

        // Act
        await userEvent.click(part(tour, '.next'));
        await flush();

        // Assert
        expect(tour.hasAttribute('found')).toBe(false);
        expect(part(tour, '.ring').matches(':popover-open')).toBe(false);
        expect(Math.abs(card.left + card.width / 2 - window.innerWidth / 2)).toBeLessThan(2);
        expect(label).toBe('Done');
        expect(finished).toEqual([{ skipped: false }]);
        expect(mounted.store.get('$.app.children.tour.done')).toBe(true);
        expect(part(tour, '.card').matches(':popover-open')).toBe(false);
    });

    it('should skip on Escape and give the focus back to where it was', async () => {
        // Arrange
        const mounted = await mountTour();
        const tour = tourOf(mounted);
        const finished: unknown[] = [];
        tour.addEventListener('finish', (event) => finished.push((event as CustomEvent).detail));
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        (tour as Element & { commands: Record<string, () => void> }).commands['start']?.();
        await frames();

        // Act
        await userEvent.keyboard('{Escape}');
        await flush();

        // Assert
        expect(finished).toEqual([{ skipped: true }]);
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('should not run when done is set, and show German labels after switching language', async () => {
        // Arrange
        const done = await mountTour({ step: 'name', done: true });
        const running = await mountTour({ step: 'save' });

        // Act
        running.setLocale('de');
        await frames();

        // Assert
        expect(part(tourOf(done), '.card').matches(':popover-open')).toBe(false);
        expect(part(tourOf(running), '.back').textContent).toBe('Zurück');
        expect(part(tourOf(running), '.progress').textContent).toBe('2 von 3');
    });
});
