import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const ROLES = ['display', 'title', 'heading', 'body', 'label', 'caption', 'code'] as const;

/** The element inside the component's shadow root that carries the text */
const inner = (element: Element): HTMLElement => element.shadowRoot?.querySelector('.text') as HTMLElement;

/** What the `text.<role>.size` token computes to, read through a probe inside the component's shadow root */
function tokenSize(element: Element, role: string): string {
    const probe = document.createElement('span');
    probe.style.fontSize = `var(--ui-text-${role}-size)`;
    element.shadowRoot?.appendChild(probe);
    const size = getComputedStyle(probe).fontSize;
    probe.remove();
    return size;
}

describe('text in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render its content in a span and follow a state write', () => {
        // Arrange
        const mounted = mountComponent('text', { _text: 'Before' });

        // Act
        mounted.store.set('$.app._text', 'After');

        // Assert
        expect(inner(mounted.element).localName).toBe('span');
        expect(inner(mounted.element).textContent).toBe('After');
    });

    it('should show content linked to $.data and update when the data changes', () => {
        // Arrange
        const mounted = mountComponent('text', { '<-_text': '$.data.title' }, { data: { title: 'First' } });

        // Act
        mounted.store.set('$.data.title', 'Second');

        // Assert
        expect(inner(mounted.element).textContent).toBe('Second');
    });

    it.each(ROLES)('should give textRole %s the font size of its text token', (role) => {
        // Arrange
        const mounted = mountComponent('text', { textRole: role });

        // Act
        const size = getComputedStyle(inner(mounted.element)).fontSize;

        // Assert
        expect(size).toBe(tokenSize(mounted.element, role));
    });

    it('should use the body role by default and change size with a runtime write', () => {
        // Arrange
        const mounted = mountComponent('text');
        const body = getComputedStyle(inner(mounted.element)).fontSize;

        // Act
        mounted.store.set('$.app.textRole', 'display');

        // Assert
        expect(body).toBe(tokenSize(mounted.element, 'body'));
        expect(getComputedStyle(inner(mounted.element)).fontSize).toBe(tokenSize(mounted.element, 'display'));
    });

    it('should render an h2 whatever the textRole', () => {
        // Arrange and Act
        const mounted = mountComponent('text', { element: 'h2', textRole: 'caption' });

        // Assert
        expect(inner(mounted.element).localName).toBe('h2');
        expect(getComputedStyle(inner(mounted.element)).fontSize).toBe(tokenSize(mounted.element, 'caption'));
    });

    it('should swap the tag when element changes at runtime and keep the text', () => {
        // Arrange
        const mounted = mountComponent('text', { element: 'h2', _text: 'Heading' });

        // Act
        mounted.store.set('$.app.element', 'p');
        const afterP = inner(mounted.element).localName;
        mounted.store.set('$.app.element', 'span');

        // Assert
        expect(afterP).toBe('p');
        expect(inner(mounted.element).localName).toBe('span');
        expect(inner(mounted.element).textContent).toBe('Heading');
        expect(mounted.element.shadowRoot?.querySelectorAll('.text')).toHaveLength(1);
    });

    it.each(['h1', 'h3', 'h4', 'h5', 'h6', 'p'])('should render element %s as that tag', (tag) => {
        // Arrange and Act
        const mounted = mountComponent('text', { element: tag });

        // Assert
        expect(inner(mounted.element).localName).toBe(tag);
    });

    it('should clamp to two lines with truncate 2 and not clamp with 0', () => {
        // Arrange
        const mounted = mountComponent('text', { _text: 'word '.repeat(200), element: 'p' });
        mounted.host.style.width = '200px';
        const unclamped = inner(mounted.element).getBoundingClientRect().height;

        // Act
        mounted.store.set('$.app.truncate', 2);
        const style = getComputedStyle(inner(mounted.element));
        const lineClamp = style.getPropertyValue('-webkit-line-clamp');
        const overflow = style.overflow;
        const lineHeight = Number.parseFloat(style.lineHeight);
        const clamped = inner(mounted.element).getBoundingClientRect().height;
        mounted.store.set('$.app.truncate', 0);

        // Assert
        expect(lineClamp).toBe('2');
        expect(overflow).toBe('hidden');
        expect(clamped).toBeLessThan(unclamped);
        expect(clamped).toBeCloseTo(2 * lineHeight, 0);
        expect(inner(mounted.element).getBoundingClientRect().height).toBe(unclamped);
    });

    it('should align the text', () => {
        // Arrange
        const mounted = mountComponent('text', { element: 'p' });

        // Act
        mounted.store.set('$.app.align', 'center');

        // Assert
        expect(getComputedStyle(inner(mounted.element)).textAlign).toBe('center');
    });

    it('should change the text colour in the dark overlay, with and without a tone', () => {
        // Arrange
        const toned = mountComponent('text', { tone: 'danger' });
        const plain = mountComponent('text');
        const tonedLight = getComputedStyle(inner(toned.element)).color;
        const plainLight = getComputedStyle(inner(plain.element)).color;

        // Act
        toned.setTheme('mode', 'dark');
        plain.setTheme('mode', 'dark');

        // Assert
        expect(getComputedStyle(inner(plain.element)).color).not.toBe(plainLight);
        expect(getComputedStyle(inner(toned.element)).color).not.toBe(tonedLight);
    });

    it('should show the German content after the locale switches', () => {
        // Arrange
        const mounted = mountComponent('text');

        // Act
        mounted.setLocale('de');

        // Assert
        expect(inner(mounted.element).textContent).toBe('Beispieltext');
    });

    it('should reject an element outside the list as SUI-STATE', () => {
        // Arrange and Act
        const mount = (): unknown => mountComponent('text', { element: 'div' });

        // Assert
        expect(mount).toThrow(/SUI-STATE/);
    });
});
