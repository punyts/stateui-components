import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import { readRichText, plainText } from '../../src/shared/richtext/model.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; clear(): void; focus(): void };
}

const part = <T extends Element = HTMLElement>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const editor = (element: Element): HTMLElement => part(element, '#control');
const tool = (element: Element, command: string): HTMLButtonElement => part<HTMLButtonElement>(element, `button[data-command="${command}"]`);
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** The blocks of a stored value as `type:text`, in order */
const shapes = (value: unknown): string[] => readRichText(value).map((block) => `${block.type}${block.level ?? ''}${block.indent ? `+${block.indent}` : ''}:${plainText(block.runs)}`);
const stored = (mounted: ReturnType<typeof mountComponent>, path = '$.app.value'): unknown => mounted.store.get(path);
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

/** Mounts the field and puts the caret at the end of its text */
const mountFocused = async (node: Record<string, unknown> = {}, state?: Record<string, unknown>): Promise<ReturnType<typeof mountComponent>> => {
    const mounted = mountComponent('richTextField', node, state);
    await flush();
    await userEvent.click(editor(mounted.element));
    await userEvent.keyboard('{Control>}{End}{/Control}');
    await flush();
    return mounted;
};

const VALUE = {
    blocks: {
        bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'first' }] },
        bTwo: { order: 'b', type: 'bullet', indent: 0, runs: [{ text: 'item' }] }
    }
};

describe('richTextField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should draw one block element per block, with its text', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { value: VALUE });

        // Act
        await flush();

        // Assert
        const blocks = Array.from(editor(mounted.element).querySelectorAll<HTMLElement>('.block'));
        expect(blocks.map((block) => [block.dataset['key'], block.dataset['type'], block.textContent])).toEqual([
            ['bOne', 'paragraph', 'first'],
            ['bTwo', 'bullet', 'item']
        ]);
        expect(editor(mounted.element).getAttribute('role')).toBe('textbox');
        expect(editor(mounted.element).getAttribute('contenteditable')).toBe('true');
    });

    it('should write typed text and Enter as blocks through a <-value link', async () => {
        // Arrange
        const mounted = await mountFocused({ '<-value': '$.data.note' }, { data: { note: {} } });

        // Act
        await userEvent.keyboard('one{Enter}two');
        await flush();

        // Assert
        expect(shapes(stored(mounted, '$.data.note'))).toEqual(['paragraph:one', 'paragraph:two']);
        expect(editor(mounted.element).textContent).toBe('onetwo');
    });

    it('should write only the block an edit changed', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        const written: string[] = [];
        mounted.store.on('$.app.value.blocks.$all', (path: string) => written.push(path));

        // Act
        await userEvent.keyboard('s');
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'bullet:items']);
        expect(written.every((path) => path.startsWith('$.app.value.blocks.bTwo'))).toBe(true);
    });

    it('should join a block onto the one before with Backspace at its start', async () => {
        // Arrange
        const mounted = await mountFocused({ value: { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'ab' }] }, bTwo: { order: 'b', type: 'paragraph', runs: [{ text: 'cd' }] } } } });

        // Act
        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{Backspace}');
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:abcd']);
    });

    it('should run Markdown shortcuts as they are typed', async () => {
        // Arrange
        const mounted = await mountFocused();

        // Act
        await userEvent.keyboard('## Title{Enter}- one{Enter}a **b** c');
        await flush();

        // Assert
        const blocks = readRichText(stored(mounted));
        expect(shapes(stored(mounted))).toEqual(['heading2:Title', 'bullet:one', 'bullet:a b c']);
        expect(blocks[2]?.runs).toEqual([{ text: 'a ' }, { text: 'b', marks: ['bold'] }, { text: ' c' }]);
    });

    it('should toggle a mark on the selection with Ctrl+B and press its tool', async () => {
        // Arrange
        const mounted = await mountFocused({ value: { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'word' }] } } } });

        // Act
        await userEvent.keyboard('{Shift>}{Home}{/Shift}{Control>}b{/Control}');
        await flush();

        // Assert
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'word', marks: ['bold'] }]);
        expect(tool(mounted.element, 'bold').getAttribute('aria-pressed')).toBe('true');
        expect(editor(mounted.element).querySelector('strong')?.textContent).toBe('word');
    });

    it('should type with a mark toggled at the caret', async () => {
        // Arrange
        const mounted = await mountFocused();

        // Act
        await userEvent.keyboard('a{Control>}i{/Control}b');
        await flush();

        // Assert
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'a' }, { text: 'b', marks: ['italic'] }]);
    });

    it('should undo and redo with the keyboard and the toolbar', async () => {
        // Arrange
        const mounted = await mountFocused();
        await userEvent.keyboard('abc');
        await flush();

        // Act
        await userEvent.keyboard('{Control>}z{/Control}');
        await flush();
        const undone = shapes(stored(mounted));
        const canRedo = mounted.store.get('$.app.canRedo');
        await userEvent.click(tool(mounted.element, 'redo'));
        await flush();

        // Assert
        expect(undone).toEqual(['paragraph:']);
        expect(canRedo).toBe(true);
        expect(shapes(stored(mounted))).toEqual(['paragraph:abc']);
    });

    it('should indent a list item with Tab and outdent it with Shift+Tab', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });

        // Act
        await userEvent.keyboard('{Tab}');
        await flush();
        const indented = shapes(stored(mounted));
        await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
        await flush();

        // Assert
        expect(indented).toEqual(['paragraph:first', 'bullet+1:item']);
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'bullet:item']);
    });

    it('should tick a check item from its box without moving the text', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { value: { blocks: { bTask: { order: 'a', type: 'check', indent: 0, checked: false, runs: [{ text: 'task' }] } } } });
        await flush();
        const box = editor(mounted.element).querySelector<HTMLInputElement>('.marker input') as HTMLInputElement;

        // Act
        await userEvent.click(box);
        await flush();

        // Assert
        expect(readRichText(stored(mounted))[0]?.checked).toBe(true);
        expect(box.getAttribute('aria-label')).toBe('Done');
        expect(editor(mounted.element).querySelector('.block')?.hasAttribute('data-checked')).toBe(true);
    });

    it('should set a block kind from the toolbar', async () => {
        // Arrange
        const mounted = await mountFocused({ value: { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'x' }] } } } });

        // Act
        await userEvent.click(tool(mounted.element, 'heading1'));
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['heading1:x']);
        expect(tool(mounted.element, 'heading1').getAttribute('aria-pressed')).toBe('true');
        expect(mounted.store.get('$.app.active')).toBe('heading1');
    });

    it('should show only the allowed block tools and refuse other shortcuts', async () => {
        // Arrange
        const mounted = await mountFocused({ blocks: ['bullet'] });

        // Act
        await userEvent.keyboard('# x');
        await flush();

        // Assert
        expect(tool(mounted.element, 'heading1')).toBeNull();
        expect(tool(mounted.element, 'bullet')).not.toBeNull();
        expect(shapes(stored(mounted))).toEqual(['paragraph:# x']);
    });

    it('should show the compact toolbar and none', async () => {
        // Arrange
        const compact = mountComponent('richTextField', { toolbar: 'compact' });
        const none = mountComponent('richTextField', { toolbar: 'none' });
        await flush();

        // Assert
        expect(Array.from(part(compact.element, '.toolbar').querySelectorAll('button')).map((button) => button.dataset['command'])).toEqual(['bold', 'italic', 'link', 'bullet', 'numbered']);
        expect(part(none.element, '.toolbar')).toBeNull();
    });

    it('should stop typing at maxLength', async () => {
        // Arrange
        const mounted = await mountFocused({ maxLength: 3 });

        // Act
        await userEvent.keyboard('abcdef');
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:abc']);
    });

    it('should show the required error on validate when empty and clear it once there is text', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { required: true });
        await flush();
        const invalid = events(mounted.element, 'invalid');

        // Act
        commands(mounted.element).validate();
        await flush();
        const error = mounted.store.get('$.app.error');
        await userEvent.click(editor(mounted.element));
        await userEvent.keyboard('x');
        await flush();
        commands(mounted.element).validate();
        await flush();

        // Assert
        expect(error).toBe('required');
        expect(invalid.length).toBeGreaterThan(0);
        expect(mounted.store.get('$.app.error')).toBe('');
        expect(editor(mounted.element).hasAttribute('aria-invalid')).toBe(false);
    });

    it('should raise change for an edit', async () => {
        // Arrange
        const mounted = await mountFocused();
        const changes = events(mounted.element, 'change');

        // Act
        await userEvent.keyboard('a');
        await flush();

        // Assert
        expect(changes.length).toBeGreaterThan(0);
    });

    it('should not be editable when readonly, and keep its text', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { value: VALUE, readonly: true });
        await flush();

        // Act
        await userEvent.click(editor(mounted.element));
        await userEvent.keyboard('zz');
        await flush();

        // Assert
        expect(editor(mounted.element).getAttribute('contenteditable')).toBe('false');
        expect(tool(mounted.element, 'bold').disabled).toBe(true);
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'bullet:item']);
    });

    it('should redraw a write made by someone else and keep the caret', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });

        // Act
        mounted.store.set('$.app.value.blocks.bOne.runs', [{ text: 'changed' }]);
        await flush();
        await userEvent.keyboard('!');
        await flush();

        // Assert
        expect(editor(mounted.element).textContent).toBe('changeditem!');
    });

    it('should reset to the empty value and clear the history', async () => {
        // Arrange
        const mounted = await mountFocused();
        await userEvent.keyboard('abc');
        await flush();

        // Act
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual([]);
        expect(mounted.store.get('$.app.canUndo')).toBe(false);
        expect(mounted.store.get('$.app.empty')).toBe(true);
    });

    it('should paste plain text as one paragraph per line', async () => {
        // Arrange
        const mounted = await mountFocused();
        const data = new DataTransfer();
        data.setData('text/plain', 'one\ntwo');

        // Act
        editor(mounted.element).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true, composed: true }));
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:one', 'paragraph:two']);
    });

    it('should paste HTML as blocks with marks and safe links only', async () => {
        // Arrange
        const mounted = await mountFocused();
        const data = new DataTransfer();
        data.setData('text/html', '<h2>Plan</h2><ul><li><b>first</b></li><li><a href="https://x.example">second</a></li></ul><p><a href="javascript:alert(1)">bad</a><img src="x.png" onerror="alert(1)"></p>');
        data.setData('text/plain', 'Plan first second bad');

        // Act
        editor(mounted.element).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true, composed: true }));
        await flush();

        // Assert
        const blocks = readRichText(stored(mounted));
        expect(shapes(stored(mounted))).toEqual(['heading2:Plan', 'bullet:first', 'bullet:second', 'paragraph:bad']);
        expect(blocks[1]?.runs).toEqual([{ text: 'first', marks: ['bold'] }]);
        expect(blocks[2]?.runs).toEqual([{ text: 'second', link: 'https://x.example' }]);
        expect(blocks[3]?.runs).toEqual([{ text: 'bad' }]);
        expect(editor(mounted.element).querySelector('img')).toBeNull();
    });

    it('should paste Markdown text as blocks, keeping only the types the field allows', async () => {
        // Arrange
        const mounted = await mountFocused({ blocks: ['bullet'] });
        const data = new DataTransfer();
        data.setData('text/plain', '# Title\n\n- **one**\n- two');

        // Act
        editor(mounted.element).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true, composed: true }));
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:Title', 'bullet:one', 'bullet:two']);
    });

    it('should paste lines into the middle of a block, splitting it around them', async () => {
        // Arrange
        const mounted = await mountFocused({ value: { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'startend' }] } } } });
        await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
        await flush();
        const data = new DataTransfer();
        data.setData('text/plain', 'one\ntwo');

        // Act
        editor(mounted.element).dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true, composed: true }));
        await flush();
        await userEvent.keyboard('!');
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:startone', 'paragraph:two!end']);
    });

    it('should drop text at the drop point', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        const text = editor(mounted.element).querySelector('.block[data-key="bOne"] .text')?.firstChild as Text;
        const range = new StaticRange({ startContainer: text, startOffset: 2, endContainer: text, endOffset: 2 });
        const data = new DataTransfer();
        data.setData('text/plain', 'XY');

        // Act
        const event = new InputEvent('beforeinput', { inputType: 'insertFromDrop', dataTransfer: data, targetRanges: [range], bubbles: true, cancelable: true, composed: true });
        editor(mounted.element).dispatchEvent(event);
        await flush();

        // Assert
        expect(event.defaultPrevented).toBe(true);
        expect(shapes(stored(mounted))).toEqual(['paragraph:fiXYrst', 'bullet:item']);
    });

    it('should link the selection from the panel Ctrl+K opens, reading a bare domain as https', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        await userEvent.keyboard('{Control>}{Home}{/Control}{Shift>}{End}{/Shift}');
        await flush();

        // Act
        await userEvent.keyboard('{Control>}k{/Control}');
        await flush();
        const panel = part(mounted.element, '#linkPanel');
        const opened = panel.matches(':popover-open');
        const focusedInput = mounted.element.shadowRoot?.activeElement?.id;
        await userEvent.keyboard('example.com/docs{Enter}');
        await flush();

        // Assert
        expect(opened).toBe(true);
        expect(focusedInput).toBe('linkInput');
        expect(panel.matches(':popover-open')).toBe(false);
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'first', link: 'https://example.com/docs' }]);
        expect(mounted.element.shadowRoot?.activeElement).toBe(editor(mounted.element));
        expect(editor(mounted.element).querySelector('.link')?.getAttribute('data-href')).toBe('https://example.com/docs');
    });

    it('should refuse an unsafe address and keep the panel open with its error', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        await userEvent.keyboard('{Control>}{Home}{/Control}{Shift>}{End}{/Shift}');
        await userEvent.click(tool(mounted.element, 'link'));
        await flush();

        // Act
        await userEvent.keyboard('javascript:alert(1){Enter}');
        await flush();

        // Assert
        expect(part(mounted.element, '#linkPanel').matches(':popover-open')).toBe(true);
        expect(part(mounted.element, '#linkInput').getAttribute('aria-invalid')).toBe('true');
        expect(part(mounted.element, '#linkError')?.textContent).toContain('https');
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'first' }]);
    });

    it('should edit and remove the link under the caret, and close on Escape', async () => {
        // Arrange
        const value = { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'see ' }, { text: 'docs', link: 'https://a.example' }] } } };
        const mounted = await mountFocused({ value });
        await userEvent.keyboard('{ArrowLeft}');
        await flush();

        // Act
        await userEvent.keyboard('{Control>}k{/Control}');
        await flush();
        const prefilled = part<HTMLInputElement>(mounted.element, '#linkInput').value;
        const buttons = part(mounted.element, '#linkPanel').querySelectorAll('button').length;
        await userEvent.keyboard('{Escape}');
        await flush();
        const closed = !part(mounted.element, '#linkPanel').matches(':popover-open');
        await userEvent.keyboard('{Control>}k{/Control}');
        await flush();
        await userEvent.click(part(mounted.element, '#linkPanel').querySelectorAll('button')[1] as HTMLButtonElement);
        await flush();

        // Assert
        expect(prefilled).toBe('https://a.example');
        expect(buttons).toBe(2);
        expect(closed).toBe(true);
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'see docs' }]);
    });

    it('should read the block back after an input method composes into it', async () => {
        // Arrange
        const mounted = await mountFocused({ value: { blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'ab' }] } } } });
        const root = editor(mounted.element);
        const text = root.querySelector('.text')?.firstChild as Text;

        // Act: what a browser does for an input method: compositionstart, its own write, compositionend
        root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
        text.data = 'ab日本';
        root.dispatchEvent(new CompositionEvent('compositionend', { data: '日本', bubbles: true, composed: true }));
        await flush();

        // Assert
        expect(shapes(stored(mounted))).toEqual(['paragraph:ab日本']);
    });
});
