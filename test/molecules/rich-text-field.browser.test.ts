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
    it('should open the slash menu at the start of a block, filter it as you type and insert a table from it', async () => {
        // Arrange
        const mounted = await mountFocused();
        const picker = part(mounted.element, '#picker');

        // Act
        await userEvent.keyboard('/');
        await flush();
        const opened = picker.matches(':popover-open');
        const all = Array.from(picker.querySelectorAll('[role=option]')).map((option) => option.textContent);
        await userEvent.keyboard('tab');
        await flush();
        const filtered = Array.from(picker.querySelectorAll('[role=option]')).map((option) => option.textContent);
        await userEvent.keyboard('{Enter}');
        await flush();
        await userEvent.keyboard('x');
        await flush();

        // Assert
        expect(opened).toBe(true);
        expect(all).toContain('Heading 1');
        expect(all).toContain('Table');
        expect(filtered).toEqual(['Table']);
        expect(picker.matches(':popover-open')).toBe(false);
        const [table] = readRichText(stored(mounted));
        expect(table?.type).toBe('table');
        expect(table?.rows?.map((row) => row.cells.map((cell) => plainText(cell.runs)))).toEqual([['x', '', ''], ['', '', ''], ['', '', '']]);
        expect(mounted.store.get('$.app.picker')).toBe('');
    });

    it('should move through the slash menu with the arrows, and close it with Escape keeping the text', async () => {
        // Arrange
        const mounted = await mountFocused();
        const picker = part(mounted.element, '#picker');

        // Act
        await userEvent.keyboard('/');
        await flush();
        await userEvent.keyboard('{ArrowDown}');
        await flush();
        const active = picker.querySelector('[aria-selected=true]')?.textContent;
        const described = editor(mounted.element).getAttribute('aria-activedescendant');
        await userEvent.keyboard('{Escape}');
        await flush();
        await userEvent.keyboard('{Enter}/');
        await flush();
        await userEvent.keyboard('{ArrowDown}{Enter}');
        await flush();

        // Assert
        expect(active).toBe('Heading 2');
        expect(described).toBe('pick-1');
        expect(shapes(stored(mounted))).toEqual(['paragraph:/', 'heading2:']);
    });

    it('should not open the slash menu inside a word', async () => {
        // Arrange
        const mounted = await mountFocused();

        // Act
        await userEvent.keyboard('a/b');
        await flush();

        // Assert
        expect(part(mounted.element, '#picker').matches(':popover-open')).toBe(false);
        expect(shapes(stored(mounted))).toEqual(['paragraph:a/b']);
    });

    it('should type into table cells, move with Tab, add a row with Tab in the last cell and go down with Enter', async () => {
        // Arrange
        const value = { blocks: { bTab: { order: 'a', type: 'table', runs: [], rows: [{ cells: [{ runs: [{ text: 'A' }] }, { runs: [] }] }] }, bEnd: { order: 'b', type: 'paragraph', runs: [] } } };
        const mounted = mountComponent('richTextField', { value });
        await flush();
        const first = editor(mounted.element).querySelector('th .text') as HTMLElement;

        // Act
        await userEvent.click(first);
        await userEvent.keyboard('{End}1{Tab}B{Tab}c{Enter}d');
        await flush();

        // Assert
        const [table] = readRichText(stored(mounted));
        expect(table?.rows?.map((row) => row.cells.map((cell) => plainText(cell.runs)))).toEqual([['A1', 'B'], ['c', ''], ['d', '']]);
        expect(editor(mounted.element).querySelectorAll('th').length).toBe(2);
        expect(editor(mounted.element).querySelectorAll('td').length).toBe(4);
    });

    it('should show the table tools in a table and add a column and remove the table with them', async () => {
        // Arrange
        const value = { blocks: { bTab: { order: 'a', type: 'table', runs: [], rows: [{ cells: [{ runs: [{ text: 'A' }] }, { runs: [] }] }] }, bEnd: { order: 'b', type: 'paragraph', runs: [{ text: 'after' }] } } };
        const mounted = mountComponent('richTextField', { value });
        await flush();
        const outside = tool(mounted.element, 'addColumn');

        // Act
        await userEvent.click(editor(mounted.element).querySelector('th .text') as HTMLElement);
        await flush();
        await userEvent.click(tool(mounted.element, 'addColumn'));
        await flush();
        const columns = readRichText(stored(mounted))[0]?.rows?.[0]?.cells.length;
        await userEvent.click(tool(mounted.element, 'removeTable'));
        await flush();

        // Assert
        expect(outside).toBeNull();
        expect(columns).toBe(3);
        expect(shapes(stored(mounted))).toEqual(['paragraph:after']);
        expect(tool(mounted.element, 'addColumn')).toBeNull();
    });

    it('should offer mentions from its records as @ is typed, raise mentionQuery and put the chosen one in whole', async () => {
        // Arrange
        const mentions = [{ value: 'u1', label: 'Ada Lovelace' }, { value: 'u2', label: 'Bo Diddley' }];
        const mounted = await mountFocused({ mentions });
        const asked = events(mounted.element, 'mentionQuery');
        const picker = part(mounted.element, '#picker');

        // Act
        await userEvent.keyboard('hi @ad');
        await flush();
        const offered = Array.from(picker.querySelectorAll('[role=option]')).map((option) => option.textContent);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await userEvent.keyboard('{Enter}');
        await flush();
        const runs = readRichText(stored(mounted))[0]?.runs;
        const chip = editor(mounted.element).querySelector<HTMLElement>('.mention');
        await userEvent.keyboard('{Backspace}{Backspace}');
        await flush();

        // Assert
        expect(offered).toEqual(['Ada Lovelace']);
        expect(asked).toContain('ad');
        expect(runs).toEqual([{ text: 'hi ' }, { text: '@Ada Lovelace', mention: 'u1' }, { text: ' ' }]);
        expect(chip?.dataset['mention']).toBe('u1');
        expect(chip?.getAttribute('contenteditable')).toBe('false');
        expect(shapes(stored(mounted))).toEqual(['paragraph:hi ']);
    });

    it('should show mentions the app writes after mentionQuery', async () => {
        // Arrange
        const mounted = await mountFocused();
        mounted.element.addEventListener('mentionQuery', () => mounted.store.set('$.app.mentions', [{ value: 'u9', label: 'Grace Hopper' }] as never));
        const picker = part(mounted.element, '#picker');

        // Act
        await userEvent.keyboard('@gr');
        await new Promise((resolve) => setTimeout(resolve, 400));
        await flush();

        // Assert
        expect(picker.matches(':popover-open')).toBe(true);
        expect(Array.from(picker.querySelectorAll('[role=option]')).map((option) => option.textContent)).toEqual(['Grace Hopper']);
        expect(mounted.store.get('$.app.picker')).toBe('mention');
    });
});

describe('richTextField comments in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    const ADA = { id: 'u1', label: 'Ada' };
    const BO = { id: 'u2', label: 'Bo' };
    const commentPanel = (element: Element): HTMLElement => part(element, '#commentPanel');
    const panelButton = (element: Element, action: string, thread?: string): HTMLButtonElement =>
        commentPanel(element).querySelector(`button[data-action="${action}"]${thread === undefined ? '' : `[data-thread="${thread}"]`}`) as HTMLButtonElement;
    const COMMENTED = {
        blocks: { bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'see ' }, { text: 'this', comments: ['cOne'] }, { text: ' here' }] } }
    };
    const THREAD = { cOne: { author: BO, text: 'Why this?', at: '2026-11-20T10:00:00.000Z' } };

    it('should write a thread into the linked map and anchor it on the selection as one undo step', async () => {
        // Arrange
        const mounted = await mountFocused({ '<-value': '$.data.note', '<-comments': '$.data.comments', commentAuthor: ADA }, { data: { note: VALUE, comments: {} } });
        const raised = events(mounted.element, 'comment');
        await userEvent.keyboard('{Control>}{Home}{/Control}{Shift>}{End}{/Shift}');
        await flush();

        // Act
        await userEvent.keyboard('{Control>}{Alt>}m{/Alt}{/Control}');
        await flush();
        const opened = commentPanel(mounted.element).matches(':popover-open');
        await userEvent.keyboard('Check the name');
        await userEvent.click(panelButton(mounted.element, 'add'));
        await flush();
        const threads = mounted.store.get('$.data.comments') as Record<string, { author: unknown; text: string; at: string }>;
        const [id] = Object.keys(threads);
        const runs = readRichText(mounted.store.get('$.data.note'))[0]?.runs;
        const highlighted = editor(mounted.element).querySelector<HTMLElement>('.commented')?.dataset['comments'];
        await userEvent.keyboard('{Control>}z{/Control}');
        await flush();

        // Assert
        expect(opened).toBe(true);
        expect(id).toMatch(/^c[0-9A-Za-z]{8}$/);
        expect(threads[id as string]).toMatchObject({ author: ADA, text: 'Check the name' });
        expect(runs).toEqual([{ text: 'first', comments: [id] }]);
        expect(highlighted).toBe(id);
        expect(raised).toEqual([{ thread: id, kind: 'add' }]);
        expect(readRichText(mounted.store.get('$.data.note'))[0]?.runs).toEqual([{ text: 'first' }]);
        expect(Object.keys(mounted.store.get('$.data.comments') as object)).toEqual([id]);
        expect(editor(mounted.element).querySelector('.commented')).toBeNull();
    });

    it('should open the threads of pressed text, and reply, resolve and reopen there', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { '<-comments': '$.data.comments', commentAuthor: ADA, value: COMMENTED }, { data: { comments: structuredClone(THREAD) } });
        const raised = events(mounted.element, 'comment');
        await flush();

        // Act
        await userEvent.click(editor(mounted.element).querySelector('.commented') as HTMLElement);
        await flush();
        const shown = commentPanel(mounted.element).querySelector('.thread .body')?.textContent;
        const active = editor(mounted.element).querySelector('.commented')?.classList.contains('active');
        const anchoredUnder = editor(mounted.element).querySelector<HTMLElement>('.block.anchored')?.dataset['key'];
        await userEvent.keyboard('Because{Control>}{Enter}{/Control}');
        await flush();
        const replies = Object.values((mounted.store.get('$.data.comments.cOne.replies') ?? {}) as Record<string, { author: unknown; text: string }>);
        const drawnReplies = Array.from(commentPanel(mounted.element).querySelectorAll('.reply .body')).map((one) => one.textContent);
        const leftInBox = commentPanel(mounted.element).querySelector<HTMLTextAreaElement>('textarea[data-thread="cOne"]')?.value;
        await userEvent.click(panelButton(mounted.element, 'resolve', 'cOne'));
        await flush();
        const resolved = mounted.store.get('$.data.comments.cOne.resolved');
        const hidden = editor(mounted.element).querySelector('.commented') === null;
        const underResolved = commentPanel(mounted.element).querySelector('.resolvedHeading') !== null;
        await userEvent.click(panelButton(mounted.element, 'reopen', 'cOne'));
        await flush();

        // Assert
        expect(shown).toBe('Why this?');
        expect(active).toBe(true);
        expect(anchoredUnder).toBe('bOne');
        expect(replies).toEqual([expect.objectContaining({ author: ADA, text: 'Because' })]);
        expect(drawnReplies).toEqual(['Because']);
        expect(leftInBox).toBe('');
        expect(resolved).toBe(true);
        expect(hidden).toBe(true);
        expect(underResolved).toBe(true);
        expect(mounted.store.get('$.data.comments.cOne.resolved')).toBeUndefined();
        expect(editor(mounted.element).querySelector('.commented')).not.toBeNull();
        expect(raised).toEqual([{ thread: 'cOne', kind: 'reply' }, { thread: 'cOne', kind: 'resolve' }, { thread: 'cOne', kind: 'reopen' }]);
    });

    it('should let only the author delete a thread, taking its anchor off the text', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { commentAuthor: ADA, value: COMMENTED, comments: structuredClone(THREAD) });
        await flush();
        await userEvent.click(editor(mounted.element).querySelector('.commented') as HTMLElement);
        await flush();
        const othersDelete = panelButton(mounted.element, 'delete', 'cOne');

        // Act
        mounted.store.set('$.app.commentAuthor', BO as never);
        await flush();
        await userEvent.click(panelButton(mounted.element, 'delete', 'cOne'));
        await flush();

        // Assert
        expect(othersDelete).toBeNull();
        expect(mounted.store.get('$.app.comments')).toEqual({});
        expect(readRichText(stored(mounted))[0]?.runs).toEqual([{ text: 'see this here' }]);
        expect(commentPanel(mounted.element).matches(':popover-open')).toBe(false);
    });

    it('should show no comment tool or highlight without an author, and let a readonly field reply but not add', async () => {
        // Arrange
        const without = mountComponent('richTextField', { value: COMMENTED, comments: structuredClone(THREAD) });
        const readonly = mountComponent('richTextField', { commentAuthor: ADA, readonly: true, value: COMMENTED, comments: structuredClone(THREAD) });
        await flush();

        // Act
        await userEvent.click(editor(readonly.element).querySelector('.commented') as HTMLElement);
        await flush();
        const adding = commentPanel(readonly.element).querySelector('.thread.new');
        const replyBox = commentPanel(readonly.element).querySelector('textarea[data-thread="cOne"]');

        // Assert
        expect(tool(without.element, 'comment')).toBeNull();
        expect(editor(without.element).querySelector('.commented')).toBeNull();
        expect(adding).toBeNull();
        expect(replyBox).not.toBeNull();
        expect(tool(readonly.element, 'comment').disabled).toBe(false);
    });
});

/** A one-pixel PNG, as the host's URL for a stored picture */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PHOTO = { id: 'f1', name: 'photo.png', size: 2048, type: 'image/png' };
const WITH_IMAGE = {
    blocks: {
        bOne: { order: 'a', type: 'paragraph', runs: [{ text: 'first' }] },
        bPic: { order: 'b', type: 'image', file: PHOTO, alt: 'A chart', caption: 'Sales' },
        bTwo: { order: 'c', type: 'paragraph', runs: [{ text: 'last' }] }
    }
};

/** Answers `ui-file-url` with the pixel for every id */
const serveFiles = (element: Element): void => {
    element.addEventListener('ui-file-url', (event) => (event as CustomEvent<{ respond: (url: string) => void }>).detail.respond(PIXEL));
};

/** Answers `ui-file-transfer` with a reference once `finish` is called, reporting a quarter done first */
const takeUploads = (element: Element): { names: string[]; finish: () => void } => {
    const names: string[] = [];
    const waiting: Array<() => void> = [];
    element.addEventListener('ui-file-transfer', (event) => {
        const detail = (event as CustomEvent).detail as { file: File; onProgress: (progress: { loaded: number; total: number }) => void; respond: (result: Promise<unknown>) => void };
        names.push(detail.file.name);
        const id = `f${names.length}`;
        detail.onProgress({ loaded: 1, total: 4 });
        detail.respond(new Promise((resolve) => waiting.push(() => resolve({ id, name: detail.file.name, size: detail.file.size, type: detail.file.type }))));
    });
    return { names, finish: () => waiting.splice(0).forEach((resolve) => resolve()) };
};
const png = (name: string): File => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('richTextField images in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it("should draw an image from the host's URL with its alt text and caption, and a box with the alt text without one", async () => {
        // Arrange
        const served = mountComponent('richTextField', { value: WITH_IMAGE });
        serveFiles(served.element);
        const unserved = mountComponent('richTextField', { value: WITH_IMAGE });

        // Act
        await flush();

        // Assert
        const figure = editor(served.element).querySelector<HTMLElement>('.block[data-type="image"] figure.image');
        expect(figure?.closest('.block')?.getAttribute('contenteditable')).toBe('false');
        expect(figure?.querySelector('img')?.getAttribute('src')).toBe(PIXEL);
        expect(figure?.querySelector('img')?.getAttribute('alt')).toBe('A chart');
        expect(figure?.querySelector('figcaption')?.textContent).toBe('Sales');
        expect(editor(unserved.element).querySelector('figure.image .missing')?.textContent).toBe('A chart');
        expect(editor(unserved.element).querySelector('figure.image img')).toBeNull();
    });

    it('should upload a chosen picture with its progress shown and put the image after the caret as one undo step', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        const uploads = takeUploads(mounted.element);
        await userEvent.click(editor(mounted.element).querySelector('.block[data-key="bOne"] .text') as HTMLElement);
        await flush();

        // Act
        tool(mounted.element, 'image').click();
        await userEvent.upload(part<HTMLInputElement>(mounted.element, '#imageFile'), png('photo.png'));
        await flush();
        const during = part(mounted.element, '.upload')?.textContent;
        uploads.finish();
        await flush();
        await flush();
        const blocks = readRichText(stored(mounted));
        await userEvent.click(editor(mounted.element).querySelector('.block[data-key="bOne"] .text') as HTMLElement);
        await userEvent.keyboard('{Control>}z{/Control}');
        await flush();

        // Assert
        expect(uploads.names).toEqual(['photo.png']);
        expect(during).toBe('Uploading photo.png 25%');
        expect(part(mounted.element, '.upload')).toBeNull();
        expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'image', 'bullet']);
        expect(blocks[1]?.file).toEqual({ id: 'f1', name: 'photo.png', size: 4, type: 'image/png' });
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'bullet:item']);
    });

    it('should upload a pasted screenshot and dropped pictures, but paste the text of a copy that carries a picture too', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        const uploads = takeUploads(mounted.element);
        const screenshot = new DataTransfer();
        screenshot.items.add(png('shot.png'));
        const copied = new DataTransfer();
        copied.setData('text/plain', 'words');
        copied.items.add(png('render.png'));
        const dropped = new DataTransfer();
        dropped.items.add(png('a.png'));
        dropped.items.add(png('b.png'));

        // Act
        const paste = new ClipboardEvent('paste', { clipboardData: screenshot, bubbles: true, cancelable: true, composed: true });
        editor(mounted.element).dispatchEvent(paste);
        const textPaste = new ClipboardEvent('paste', { clipboardData: copied, bubbles: true, cancelable: true, composed: true });
        editor(mounted.element).dispatchEvent(textPaste);
        const drop = new DragEvent('drop', { dataTransfer: dropped, bubbles: true, cancelable: true, composed: true });
        editor(mounted.element).querySelector('.block[data-key="bOne"] .text')?.dispatchEvent(drop);
        uploads.finish();
        await flush();
        await flush();

        // Assert
        expect(paste.defaultPrevented).toBe(true);
        expect(textPaste.defaultPrevented).toBe(false);
        expect(drop.defaultPrevented).toBe(true);
        expect(uploads.names).toEqual(['shot.png', 'a.png', 'b.png']);
        expect(readRichText(stored(mounted)).map((block) => block.file?.name ?? block.type)).toEqual(['paragraph', 'a.png', 'b.png', 'bullet', 'shot.png', 'paragraph']);
    });

    it('should refuse a file that is not a picture with a notice naming it, and offer no images when the field leaves them out', async () => {
        // Arrange
        const mounted = await mountFocused({ value: VALUE });
        const uploads = takeUploads(mounted.element);
        const limited = mountComponent('richTextField', { blocks: ['paragraph', 'bullet'] });
        await flush();

        // Act
        tool(mounted.element, 'image').click();
        await userEvent.upload(part<HTMLInputElement>(mounted.element, '#imageFile'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }));
        await flush();

        // Assert
        expect(uploads.names).toEqual([]);
        expect(part(mounted.element, '.upload')?.textContent).toBe('notes.pdf is not a PNG, JPEG, GIF or WebP image of at most 10 MB');
        expect(part(mounted.element, '.upload')?.getAttribute('data-failed')).toBe('true');
        expect(tool(limited.element, 'image')).toBeNull();
    });

    it('should open the image panel on a press and write alt text, caption and width, and remove the image with undo bringing it back', async () => {
        // Arrange
        const mounted = await mountFocused({ value: WITH_IMAGE });
        serveFiles(mounted.element);

        // Act
        await userEvent.click(editor(mounted.element).querySelector('figure.image') as HTMLElement);
        await flush();
        const opened = mounted.store.get('$.app.image');
        const filled = part<HTMLInputElement>(mounted.element, 'input[data-image="caption"]').value;
        const alt = part<HTMLInputElement>(mounted.element, 'input[data-image="alt"]');
        await userEvent.fill(alt, 'Sales by month');
        alt.dispatchEvent(new Event('change', { bubbles: true }));
        part<HTMLButtonElement>(mounted.element, 'button[data-width="small"]').click();
        await flush();
        const changed = mounted.store.get('$.app.value.blocks.bPic');
        const pressed = part<HTMLButtonElement>(mounted.element, 'button[data-width="small"]').getAttribute('aria-pressed');
        part<HTMLButtonElement>(mounted.element, '#imagePanel button[data-action="remove"]').click();
        await flush();
        const removed = shapes(stored(mounted));
        await userEvent.keyboard('{Control>}z{/Control}');
        await flush();

        // Assert
        expect(opened).toBe('open');
        expect(filled).toBe('Sales');
        expect(changed).toMatchObject({ alt: 'Sales by month', caption: 'Sales', width: 'small' });
        expect(pressed).toBe('true');
        expect(removed).toEqual(['paragraph:first', 'paragraph:last']);
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'image:', 'paragraph:last']);
    });

    it('should select the image on Backspace after it, opening its panel, and remove it on the next Backspace', async () => {
        // Arrange
        const mounted = await mountFocused({ value: WITH_IMAGE });
        await userEvent.click(editor(mounted.element).querySelector('.block[data-key="bTwo"] .text') as HTMLElement);
        await userEvent.keyboard('{Home}');
        await flush();

        // Act
        await userEvent.keyboard('{Backspace}');
        await flush();
        const selected = { panel: mounted.store.get('$.app.image'), blocks: shapes(stored(mounted)) };
        await userEvent.keyboard('{Backspace}');
        await flush();

        // Assert
        expect(selected).toEqual({ panel: 'open', blocks: ['paragraph:first', 'image:', 'paragraph:last'] });
        expect(shapes(stored(mounted))).toEqual(['paragraph:first', 'paragraph:last']);
        expect(mounted.store.get('$.app.image')).toBe('');
    });

    it('should draw images but open no panel when readonly', async () => {
        // Arrange
        const mounted = mountComponent('richTextField', { value: WITH_IMAGE, readonly: true });
        await flush();

        // Act
        await userEvent.click(editor(mounted.element).querySelector('figure.image') as HTMLElement);
        await flush();

        // Assert
        expect(editor(mounted.element).querySelector('figure.image')).not.toBeNull();
        expect(mounted.store.get('$.app.image')).toBe('');
    });
});
