import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

type Commanded = Element & { commands: Record<string, () => void> };

const part = <T extends Element>(element: Element, selector: string): T | null => element.shadowRoot?.querySelector<T>(selector) ?? null;
const all = (element: Element, selector: string): HTMLElement[] => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
const copyButton = (element: Element): HTMLButtonElement => part<HTMLButtonElement>(element, 'button.copy') as HTMLButtonElement;

const record = (element: Element, name: string): unknown[] => {
    const details: unknown[] = [];
    element.addEventListener(name, (event) => details.push((event as CustomEvent).detail));
    return details;
};

const CODE = 'const a = 1;\n\nconsole.log(a);';

describe('codeBlock in Chromium', () => {
    let written: string[];

    beforeEach(() => {
        written = [];
        vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text: string) => {
            written.push(text);
        });
    });

    afterEach(() => {
        mountComponent.unmountAll();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should show the code as given in a monospace pre and code, in a focusable region named by the language', () => {
        // Arrange and Act
        const mounted = mountComponent('codeBlock', { code: CODE, language: 'TypeScript' });
        const pre = part<HTMLPreElement>(mounted.element, 'pre') as HTMLPreElement;

        // Assert
        expect(pre.querySelector('code')?.textContent).toBe(CODE);
        expect(getComputedStyle(pre).whiteSpace).toBe('pre');
        expect(getComputedStyle(pre).fontFamily).toMatch(/mono/i);
        expect(pre.tabIndex).toBe(0);
        expect(pre.getAttribute('role')).toBe('region');
        expect(pre.getAttribute('aria-label')).toBe('TypeScript');
        expect(part(mounted.element, '.language')?.textContent).toBe('TypeScript');
    });

    it('should name the region by _label and draw no language label without a language', () => {
        // Arrange and Act
        const mounted = mountComponent('codeBlock', { code: 'ls' });

        // Assert
        expect(part(mounted.element, 'pre')?.getAttribute('aria-label')).toBe('Code');
        expect(part(mounted.element, '.language')).toBeNull();
    });

    it('should number every line, empty ones too, without putting the numbers in the text', () => {
        // Arrange and Act
        const mounted = mountComponent('codeBlock', { code: CODE, lineNumbers: true });
        const lines = all(mounted.element, '.line');

        // Assert
        expect(lines.map((line) => line.textContent)).toEqual(['const a = 1;', '', 'console.log(a);']);
        expect(lines[1]?.getBoundingClientRect().height).toBeGreaterThan(0);
        expect(getComputedStyle(lines[2] as Element, '::before').content).toContain('counter');
        expect(part(mounted.element, 'code')?.textContent).toBe('const a = 1;console.log(a);');
    });

    it('should wrap long lines only with wrap on', () => {
        // Arrange
        const long = 'x'.repeat(400);
        const plain = mountComponent('codeBlock', { code: long });
        const wrapped = mountComponent('codeBlock', { code: long, wrap: true });
        const pre = (element: Element): HTMLPreElement => part<HTMLPreElement>(element, 'pre') as HTMLPreElement;

        // Assert
        expect(pre(plain.element).scrollWidth).toBeGreaterThan(pre(plain.element).clientWidth);
        expect(getComputedStyle(pre(wrapped.element)).whiteSpace).toBe('pre-wrap');
        expect(pre(wrapped.element).scrollWidth).toBeLessThanOrEqual(pre(wrapped.element).clientWidth);
    });

    it('should copy the code on a press, say Copied and raise copy with the text', async () => {
        // Arrange
        const mounted = mountComponent('codeBlock', { code: CODE });
        const copies = record(mounted.element, 'copy');

        // Act
        await userEvent.click(copyButton(mounted.element));
        await vi.waitFor(() => expect(copies).toHaveLength(1));

        // Assert
        expect(written).toEqual([CODE]);
        expect(copies).toEqual([{ text: CODE }]);
        expect(copyButton(mounted.element).textContent?.trim()).toBe('Copied');
        expect(part(mounted.element, '[role=status]')?.textContent).toBe('Copied');
        expect(copyButton(mounted.element).querySelector('ui-icon')?.getAttribute('name')).toBe('check');
    });

    it('should say Copy again two seconds after the copy command', async () => {
        // Arrange
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const mounted = mountComponent('codeBlock', { code: 'npm test' });

        // Act
        (mounted.element as Commanded).commands.copy();
        // The clipboard answers in a microtask; the fake clock moves only when the test moves it
        for (let turn = 0; turn < 5; turn++) await Promise.resolve();
        vi.advanceTimersByTime(1999);
        const before = mounted.store.get('$.app.copied');
        vi.advanceTimersByTime(1);

        // Assert
        expect(written).toEqual(['npm test']);
        expect(before).toBe(true);
        expect(mounted.store.get('$.app.copied')).toBe(false);
        expect(copyButton(mounted.element).textContent?.trim()).toBe('Copy');
    });

    it('should raise nothing when the clipboard refuses', async () => {
        // Arrange
        vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
        const mounted = mountComponent('codeBlock', { code: 'x' });
        const copies = record(mounted.element, 'copy');

        // Act
        await userEvent.click(copyButton(mounted.element));
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Assert
        expect(copies).toEqual([]);
        expect(mounted.store.get('$.app.copied')).toBe(false);
    });

    it('should keep a native copy of a selection inside the block from reaching the host', () => {
        // Arrange
        const mounted = mountComponent('codeBlock', { code: 'x' });
        const copies = record(mounted.element, 'copy');

        // Act
        part(mounted.element, 'code')?.dispatchEvent(new Event('copy', { bubbles: true, composed: true }));

        // Assert
        expect(copies).toEqual([]);
    });

    it('should draw no copy button with copyable off', () => {
        // Arrange and Act
        const mounted = mountComponent('codeBlock', { code: 'x', copyable: false });

        // Assert
        expect(part(mounted.element, 'button')).toBeNull();
        expect(part(mounted.element, '.bar')).toBeNull();
    });

    it('should label the button in French after switching language', async () => {
        // Arrange
        const mounted = mountComponent('codeBlock', { code: 'x' });

        // Act
        mounted.setLocale('fr');
        const idle = copyButton(mounted.element).textContent?.trim();
        await userEvent.click(copyButton(mounted.element));
        await vi.waitFor(() => expect(mounted.store.get('$.app.copied')).toBe(true));

        // Assert
        expect(idle).toBe('Copier');
        expect(copyButton(mounted.element).textContent?.trim()).toBe('Copié');
    });
});
