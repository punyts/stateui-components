import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const PICTURE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';

const people = [
    { name: 'Ada Lovelace', src: PICTURE },
    { name: 'Grace Hopper', src: '' },
    { name: 'Alan Turing', src: '' },
    { name: 'Katherine Johnson', src: '' },
    { name: 'Edsger Dijkstra', src: '' },
    { name: 'Barbara Liskov', src: '' }
];

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const avatars = (element: Element): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('.avatar') ?? []);
const more = (element: Element): HTMLElement | null => element.shadowRoot?.querySelector<HTMLElement>('.more') ?? null;

describe('avatarGroup in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw a named group of pictures or initials, each named by the person', () => {
        // Arrange and Act
        const mounted = mountComponent('avatarGroup', { people: people.slice(0, 3) });
        const [first, second] = avatars(mounted.element);

        // Assert
        expect(part(mounted.element, '.group').getAttribute('role')).toBe('group');
        expect(part(mounted.element, '.group').getAttribute('aria-label')).toBe('People');
        expect(avatars(mounted.element).map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
        expect(avatars(mounted.element).every((avatar) => avatar.getAttribute('role') === 'img')).toBe(true);
        expect(first?.querySelector('img')?.getAttribute('alt')).toBe('');
        expect(second?.querySelector('.initials')?.textContent).toBe('GH');
        expect(more(mounted.element)).toBeNull();
    });

    it('should show max avatars at most, the last a +N avatar named by how many more', () => {
        // Arrange and Act
        const mounted = mountComponent('avatarGroup', { people, max: 4 });

        // Assert
        expect(avatars(mounted.element)).toHaveLength(4);
        expect(more(mounted.element)?.textContent?.trim()).toBe('+3');
        expect(more(mounted.element)?.getAttribute('aria-label')).toBe('3 more');
    });

    it('should show everyone with no +N avatar when the people fit max exactly', () => {
        // Arrange and Act
        const mounted = mountComponent('avatarGroup', { people: people.slice(0, 4), max: 4 });

        // Assert
        expect(avatars(mounted.element)).toHaveLength(4);
        expect(more(mounted.element)).toBeNull();
    });

    it('should follow linked people and a change of max, and read a map in key order', () => {
        // Arrange
        const mounted = mountComponent('avatarGroup', { '<-people': '$.data.team', max: 3 }, { data: { team: { b: { name: 'Bo' }, a: { name: 'Al' } } } });
        const before = avatars(mounted.element).map((avatar) => avatar.getAttribute('aria-label'));

        // Act
        mounted.store.set('$.data.team', { a: { name: 'Al' }, b: { name: 'Bo' }, c: { name: 'Cy' }, d: { name: 'Di' } });
        const crowded = more(mounted.element)?.getAttribute('aria-label');
        mounted.store.set('$.app.max', 5);

        // Assert
        expect(before).toEqual(['Bo', 'Al']);
        expect(crowded).toBe('2 more');
        expect(avatars(mounted.element)).toHaveLength(4);
        expect(more(mounted.element)).toBeNull();
    });

    it('should overlap the avatars and size them with the shared size', () => {
        // Arrange
        const small = mountComponent('avatarGroup', { people: people.slice(0, 2), size: 'sm' });
        const large = mountComponent('avatarGroup', { people: people.slice(0, 2), size: 'lg' });
        const [first, second] = avatars(large.element).map((avatar) => avatar.getBoundingClientRect());

        // Assert
        expect((second?.left ?? 0) < (first?.right ?? 0)).toBe(true);
        expect(first?.width ?? 0).toBeGreaterThan(avatars(small.element)[0]?.getBoundingClientRect().width ?? 0);
    });

    it('should say how many more in German after switching language', () => {
        // Arrange
        const mounted = mountComponent('avatarGroup', { people, max: 2 });

        // Act
        mounted.setLocale('de');

        // Assert
        expect(part(mounted.element, '.group').getAttribute('aria-label')).toBe('Personen');
        expect(more(mounted.element)?.getAttribute('aria-label')).toBe('5 weitere');
    });
});
