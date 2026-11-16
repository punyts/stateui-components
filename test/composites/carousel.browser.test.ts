import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const all = (element: Element, selector: string): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
const part = (element: Element, selector: string): HTMLElement => element.shadowRoot?.querySelector<HTMLElement>(selector) as HTMLElement;
const slide = (text: string, placement: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', _text: text, placement });
const three = { one: slide('First'), two: slide('Second', { _slide: 'Pricing' }), three: slide('Third') };
const visible = (element: Element): string[] => all(element, '.slide').filter((item) => !item.hidden).map((item) => item.id);
const current = (element: Element): string[] => all(element, '.dot[aria-current=true]').map((dot) => dot.dataset['key'] ?? '');
const command = (element: Element, name: string, value?: unknown): void => {
    (element as Element & { commands: Record<string, (value?: unknown) => void> }).commands[name]?.(value);
};

const changes = (element: Element): string[] => {
    const seen: string[] = [];
    element.addEventListener('change', (event) => seen.push((event as CustomEvent<string>).detail));
    return seen;
};

describe('carousel in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.useRealTimers();
    });

    it('should show the first child as a slide of a named carousel, the others hidden, with the roles of the WAI pattern', () => {
        // Arrange and Act
        const mounted = mountComponent('carousel', { children: three, _label: 'Highlights' });
        const region = part(mounted.element, 'section');
        const slides = all(mounted.element, '.slide');

        // Assert
        expect(region.getAttribute('aria-roledescription')).toBe('carousel');
        expect(region.getAttribute('aria-label')).toBe('Highlights');
        expect(slides.map((item) => [item.getAttribute('role'), item.getAttribute('aria-roledescription'), item.getAttribute('aria-label')])).toEqual([
            ['group', 'slide', '1 of 3'],
            ['group', 'slide', '2 of 3'],
            ['group', 'slide', '3 of 3']
        ]);
        expect(visible(mounted.element)).toEqual(['slide-one']);
        expect(current(mounted.element)).toEqual(['one']);
        expect(part(mounted.element, '.slides').getAttribute('aria-live')).toBe('polite');
    });

    it('should name each dot by the slide placement _slide or else by its number', () => {
        // Arrange and Act
        const mounted = mountComponent('carousel', { children: three });

        // Assert
        expect(all(mounted.element, '.dot').map((dot) => dot.getAttribute('aria-label'))).toEqual(['Show slide 1', 'Pricing', 'Show slide 3']);
        expect(part(mounted.element, '.dots').getAttribute('role')).toBe('group');
    });

    it('should move with the next button and a dot, raise change once per move and stop at the ends without loop', async () => {
        // Arrange
        const mounted = mountComponent('carousel', { children: three });
        const seen = changes(mounted.element);
        const previous = part(mounted.element, 'button.previous') as HTMLButtonElement;
        const next = part(mounted.element, 'button.next') as HTMLButtonElement;
        const atStart = previous.disabled;

        // Act
        await userEvent.click(next);
        await userEvent.click(all(mounted.element, '.dot')[2] as HTMLElement);
        command(mounted.element, 'next');

        // Assert
        expect(atStart).toBe(true);
        expect(seen).toEqual(['two', 'three']);
        expect(mounted.store.get('$.app.active')).toBe('three');
        expect(visible(mounted.element)).toEqual(['slide-three']);
        expect(next.disabled).toBe(true);
        expect(previous.disabled).toBe(false);
    });

    it('should go round from the first slide to the last with loop', async () => {
        // Arrange
        const mounted = mountComponent('carousel', { children: three, loop: true });

        // Act
        await userEvent.click(part(mounted.element, 'button.previous'));

        // Assert
        expect(mounted.store.get('$.app.active')).toBe('three');
        expect((part(mounted.element, 'button.next') as HTMLButtonElement).disabled).toBe(false);
    });

    it('should move with the arrow keys, Home and End while a dot has focus, and keep focus on the shown dot', async () => {
        // Arrange
        const mounted = mountComponent('carousel', { children: three });
        (all(mounted.element, '.dot')[0] as HTMLElement).focus();

        // Act
        await userEvent.keyboard('{ArrowRight}');
        const afterRight = [mounted.store.get('$.app.active'), (mounted.element.shadowRoot?.activeElement as HTMLElement | null)?.dataset['key']];
        await userEvent.keyboard('{End}');
        const afterEnd = mounted.store.get('$.app.active');
        await userEvent.keyboard('{ArrowLeft}');
        const afterLeft = mounted.store.get('$.app.active');
        await userEvent.keyboard('{Home}');

        // Assert
        expect(afterRight).toEqual(['two', 'two']);
        expect(afterEnd).toBe('three');
        expect(afterLeft).toBe('two');
        expect(mounted.store.get('$.app.active')).toBe('one');
    });

    it('should select through the commands and ignore an unknown key', () => {
        // Arrange
        const mounted = mountComponent('carousel', { children: three });
        const seen = changes(mounted.element);

        // Act
        command(mounted.element, 'select', 'three');
        command(mounted.element, 'select', 'nope');
        command(mounted.element, 'previous');

        // Assert
        expect(seen).toEqual(['three', 'two']);
        expect(visible(mounted.element)).toEqual(['slide-two']);
    });

    it('should play on its own every autoplay seconds, pause while the pointer is over it and stop with the rotation button', async () => {
        // Arrange
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const mounted = mountComponent('carousel', { children: three, autoplay: 2 });
        const region = part(mounted.element, 'section');
        const live = part(mounted.element, '.slides');

        // Act
        vi.advanceTimersByTime(2000);
        const played = [mounted.store.get('$.app.shown'), live.getAttribute('aria-live')];
        region.dispatchEvent(new PointerEvent('pointerenter'));
        vi.advanceTimersByTime(5000);
        const hovered = mounted.store.get('$.app.shown');
        region.dispatchEvent(new PointerEvent('pointerleave'));
        vi.advanceTimersByTime(2000);
        const resumed = mounted.store.get('$.app.shown');
        const rotate = part(mounted.element, 'button.rotate');
        const stopLabel = rotate.getAttribute('aria-label');
        rotate.click();
        vi.advanceTimersByTime(5000);

        // Assert
        expect(played).toEqual(['two', 'off']);
        expect(hovered).toBe('two');
        expect(resumed).toBe('three');
        expect(stopLabel).toBe('Stop the slide show');
        expect(mounted.store.get('$.app.shown')).toBe('three');
        expect(rotate.getAttribute('aria-label')).toBe('Start the slide show');
        expect(live.getAttribute('aria-live')).toBe('polite');
    });

    it('should go round to the first slide after the last while it plays, and pause while focus is inside', () => {
        // Arrange
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const mounted = mountComponent('carousel', { children: three, active: 'three', autoplay: 1 });

        // Act
        vi.advanceTimersByTime(1000);
        const wrapped = mounted.store.get('$.app.shown');
        (part(mounted.element, 'button.next') as HTMLButtonElement).focus();
        vi.advanceTimersByTime(3000);

        // Assert
        expect(wrapped).toBe('one');
        expect(mounted.store.get('$.app.shown')).toBe('one');
        expect(mounted.store.get('$.app.playing')).toBe(false);
    });

    it('should not play under the reduced motion overlay', () => {
        // Arrange
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const mounted = mountComponent('carousel', { children: three, autoplay: 1 }, { motion: 'reduced' });

        // Act
        vi.advanceTimersByTime(3000);

        // Assert
        expect(mounted.store.get('$.app.playing')).toBe(false);
        expect(mounted.store.get('$.app.shown')).toBe('one');
    });

    it('should draw no controls for a single slide', () => {
        // Arrange and Act
        const mounted = mountComponent('carousel', { children: { only: slide('Alone') } });

        // Assert
        expect(part(mounted.element, '.controls')).toBeNull();
        expect(visible(mounted.element)).toEqual(['slide-only']);
    });

    it('should speak French after switching language', () => {
        // Arrange
        const mounted = mountComponent('carousel', { children: three });

        // Act
        mounted.setLocale('fr');

        // Assert
        expect(part(mounted.element, 'section').getAttribute('aria-label')).toBe('Carrousel');
        expect(all(mounted.element, '.slide')[0]?.getAttribute('aria-label')).toBe('1 sur 3');
        expect(part(mounted.element, 'button.next').getAttribute('aria-label')).toBe('Diapositive suivante');
        expect(all(mounted.element, '.dot')[0]?.getAttribute('aria-label')).toBe('Afficher la diapositive 1');
    });
});
