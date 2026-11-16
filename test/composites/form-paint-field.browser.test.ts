import { FileTransferError } from '@punyts/stateui-app';
import type { FileReference, ReleaseFile, TransferFile, TransferFileOptions } from '@punyts/stateui-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';
import type { MountedComponent, NodeState } from '../harness/createMountComponent.js';

/*
 * paintField in a form (G2.9 of the graphics epic 2): a submit waits for the field's pending save (through the field
 * base's `settle`), refuses after a failed one, never submits twice or the previous file, and a reset leaves no painting
 * behind. fileField takes part in the same mechanism: a submit waits for its transfers.
 */

const RED = '#ff0000';
/** The file the document holds before the field saves anything */
const STORED = { id: '3f0c8a52-1d3e-4b7a-9c61-0a2b4c6d8e10', name: 'before.png', size: 1234, type: 'image/png' };

interface Call {
    file: File;
    options: TransferFileOptions;
    resolve(reference: FileReference): void;
    reject(code: ConstructorParameters<typeof FileTransferError>[0]): void;
}

interface Hooks {
    calls: Call[];
    released: string[];
    transferFile: TransferFile;
    releaseFile: ReleaseFile;
}

/** A `transferFile` hook the test settles by hand, and a `releaseFile` hook that records the ids it is given */
function fakeHooks(): Hooks {
    const calls: Call[] = [];
    const released: string[] = [];
    const transferFile: TransferFile = (given, options = {}) =>
        new Promise<FileReference>((resolve, reject) => {
            calls.push({ file: given, options, resolve, reject: (code) => reject(new FileTransferError(code, 'rejected')) });
            options.signal?.addEventListener('abort', () => reject(new FileTransferError('cancelled', 'cancelled')));
        });
    const releaseFile: ReleaseFile = (id) => {
        released.push(id);
        return Promise.resolve();
    };
    return { calls, released, transferFile, releaseFile };
}

const reference = (id: string, size = 100): FileReference => ({ id, name: 'Signature.png', size, type: 'image/png' });

/** Every element with this tag under the node, through the shadow roots, in document order */
const deep = (root: ParentNode, tag: string): Element[] => {
    const found: Element[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
};
const paintOf = (mounted: MountedComponent): Element => deep(mounted.element.shadowRoot as ShadowRoot, 'ui-paint-field')[0] as Element;
const canvasOf = (element: Element): HTMLCanvasElement => element.shadowRoot?.querySelector('canvas') as HTMLCanvasElement;
const errorText = (element: Element): string => element.shadowRoot?.querySelector('.error')?.textContent ?? '';
/** A copy of the bound value: the store writes an object value into the one it holds */
const signature = (mounted: MountedComponent): unknown => JSON.parse(JSON.stringify(mounted.store.get('$.data.signature' as never) ?? null));
const fieldState = (mounted: MountedComponent, name: string): unknown => mounted.store.get(`$.app.children.signature.${name}` as never);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const command = (element: Element, name: string): void => {
    (element as Element & { commands: Record<string, () => void> }).commands[name]?.();
};
const record = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};
/** The `{ keys }` details of the form's own `invalid` (the fields' `invalid` bubbles through it with `{ rule }`) */
const formInvalid = (seen: unknown[]): unknown[] => seen.filter((detail) => typeof detail === 'object' && detail !== null && 'keys' in detail);

/** Raises one pointer event on the canvas at a point given in canvas pixels, mapped through its CSS scaling */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
    const box = canvas.getBoundingClientRect();
    const clientX = box.left + (x * box.width) / canvas.width;
    const clientY = box.top + (y * box.height) / canvas.height;
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse', clientX, clientY, bubbles: true, composed: true, cancelable: true, ...extra }));
}

/** A horizontal stroke across a 200 by 100 canvas at the height `y` */
function stroke(element: Element, y = 50): void {
    const canvas = canvasOf(element);
    pointer(canvas, 'pointerdown', 10, y);
    pointer(canvas, 'pointermove', 100, y);
    pointer(canvas, 'pointermove', 190, y);
    pointer(canvas, 'pointerup', 190, y, { buttons: 0 });
}

/** Whether the field's canvas has no painted pixel */
function blank(element: Element): boolean {
    const canvas = canvasOf(element);
    const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) return false;
    return true;
}

/** A form holding one paintField `signature` linked to `$.data.signature`, and a text field `name` */
async function mountForm(hooks: Hooks, extra: NodeState = {}, value: unknown = {}): Promise<MountedComponent> {
    const mounted = mountComponent(
        'form',
        {
            children: {
                name: { component: 'textField', value: 'Ada' },
                signature: { component: 'paintField', width: 200, height: 100, colors: [RED], sizes: [8], _label: 'Signature', '<-value': '$.data.signature', ...extra }
            }
        },
        { data: { signature: value }, hooks: { transferFile: hooks.transferFile, releaseFile: hooks.releaseFile } }
    );
    await flush();
    await flush();
    return mounted;
}

describe('paintField in a form in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
        vi.restoreAllMocks();
    });

    it('should save an unsaved painting at once on submit and submit only when the save is done', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        const submitted = record(mounted.element, 'submitted');
        stroke(paint);
        expect(fieldState(mounted, 'dirty')).toBe(true);

        // Act: submit without waiting for the pause
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));
        await flush();
        const before = [...submitted];
        const status = mounted.store.get('$.app.status');
        (hooks.calls[0] as Call).resolve(reference('a1'));
        await vi.waitFor(() => expect(submitted).toHaveLength(1));

        // Assert
        expect(before).toEqual([]);
        expect(status).toBe('submitting');
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: reference('a1') } }]);
        expect(mounted.store.get('$.app.status')).toBe('submitted');
        expect(fieldState(mounted, 'dirty')).toBe(false);
    });

    it('should wait for a save already under way when the submit comes', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        const submitted = record(mounted.element, 'submitted');
        stroke(paint);
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1), { timeout: 3000 });

        // Act
        command(mounted.element, 'submit');
        await flush();
        const before = [...submitted];
        (hooks.calls[0] as Call).resolve(reference('a1'));
        await vi.waitFor(() => expect(submitted).toHaveLength(1));

        // Assert
        expect(before).toEqual([]);
        expect(hooks.calls).toHaveLength(1);
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: reference('a1') } }]);
    });

    it('should refuse the submit with the field invalid when the save fails', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        const submitted = record(mounted.element, 'submitted');
        const invalid = record(mounted.element, 'invalid');
        stroke(paint);

        // Act
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));
        (hooks.calls[0] as Call).reject('quota');
        await vi.waitFor(() => expect(formInvalid(invalid)).toHaveLength(1));
        // a second submit after the failure does not try again and refuses at once
        command(mounted.element, 'submit');
        await flush();

        // Assert
        expect(submitted).toEqual([]);
        expect(formInvalid(invalid)).toEqual([{ keys: ['signature'] }, { keys: ['signature'] }]);
        expect(hooks.calls).toHaveLength(1);
        expect(fieldState(mounted, 'error')).toBe('quota');
        expect(errorText(paint)).toBe('The storage limit of this app is reached');
        expect(fieldState(mounted, 'dirty')).toBe(true);
        expect(mounted.store.get('$.app.status')).toBe('invalid');
        expect(mounted.store.get('$.app.errorCount')).toBe(1);
    });

    it('should submit once, with the new file and not the previous one, when submit is pressed twice during a save', async () => {
        // Arrange: a first painting saved as a1, then painted over
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        stroke(paint);
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));
        (hooks.calls[0] as Call).resolve(reference('a1'));
        await vi.waitFor(() => expect(signature(mounted)).toEqual(reference('a1')));
        await flush();
        const submitted = record(mounted.element, 'submitted');
        stroke(paint, 80);

        // Act
        command(mounted.element, 'submit');
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(2));
        command(mounted.element, 'submit');
        await flush();
        const before = [...submitted];
        (hooks.calls[1] as Call).resolve(reference('a2'));
        await vi.waitFor(() => expect(submitted).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Assert
        expect(before).toEqual([]);
        expect(hooks.calls).toHaveLength(2);
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: reference('a2') } }]);
        await vi.waitFor(() => expect(hooks.released).toEqual(['a1']));
    });

    it('should wait again when a stroke stops the save the submit waits for', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        const submitted = record(mounted.element, 'submitted');
        stroke(paint);
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));

        // Act: a stroke aborts the first save; the form asks again and the field saves the new painting at once
        stroke(paint, 80);
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(2));
        (hooks.calls[1] as Call).resolve(reference('a2'));
        await vi.waitFor(() => expect(submitted).toHaveLength(1));

        // Assert
        expect((hooks.calls[0] as Call).options.signal?.aborted).toBe(true);
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: reference('a2') } }]);
    });

    it('should give the required message to a required field with no painting, and submit a blank optional one as empty', async () => {
        // Arrange
        const required = await mountForm(fakeHooks(), { required: true });
        const invalid = record(required.element, 'invalid');

        // Act
        command(required.element, 'submit');

        // Assert
        expect(formInvalid(invalid)).toEqual([{ keys: ['signature'] }]);
        expect(errorText(paintOf(required))).toBe('Draw something here');
        mountComponent.unmountAll();

        // Arrange: optional, nothing painted
        const optional = await mountForm(fakeHooks());
        const submitted = record(optional.element, 'submitted');

        // Act
        command(optional.element, 'submit');

        // Assert: nothing to save, so the submit runs at once
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: {} } }]);
    });

    it('should collect the reference the document holds as one file of fileField does', async () => {
        // Arrange
        const mounted = await mountForm(fakeHooks(), { required: true }, STORED);
        const submitted = record(mounted.element, 'submitted');

        // Act
        command(mounted.element, 'submit');

        // Assert
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: STORED } }]);
        const value = (submitted[0] as { values: Record<string, unknown> }).values.signature;
        expect(Object.keys(value as object).sort()).toEqual(['id', 'name', 'size', 'type']);
    });

    it('should leave no painting behind on a form reset: empty, not dirty, the saved file given back', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        stroke(paint);
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));
        (hooks.calls[0] as Call).resolve(reference('a1'));
        await vi.waitFor(() => expect(signature(mounted)).toEqual(reference('a1')));
        stroke(paint, 80);

        // Act
        command(mounted.element, 'reset');
        await flush();

        // Assert
        expect(signature(mounted)).toEqual({});
        expect(fieldState(mounted, 'dirty')).toBe(false);
        expect(fieldState(mounted, 'error')).toBe('');
        expect(blank(paint)).toBe(true);
        expect(mounted.store.get('$.app.status')).toBe('pristine');
        await vi.waitFor(() => expect(hooks.released).toEqual(['a1']));
        await new Promise((resolve) => setTimeout(resolve, 1700));
        expect(hooks.calls).toHaveLength(1);
    });

    it('should drop a submit that waits for a save when the form is reset', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = await mountForm(hooks);
        const paint = paintOf(mounted);
        const submitted = record(mounted.element, 'submitted');
        const invalid = record(mounted.element, 'invalid');
        stroke(paint);
        command(mounted.element, 'submit');
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));

        // Act
        command(mounted.element, 'reset');
        await flush();
        await flush();

        // Assert
        expect((hooks.calls[0] as Call).options.signal?.aborted).toBe(true);
        expect(submitted).toEqual([]);
        expect(formInvalid(invalid)).toEqual([]);
        expect(signature(mounted)).toEqual({});
        expect(fieldState(mounted, 'dirty')).toBe(false);
        expect(blank(paint)).toBe(true);
        expect(mounted.store.get('$.app.status')).toBe('pristine');
        // a submit after the reset runs again
        command(mounted.element, 'submit');
        expect(submitted).toEqual([{ values: { name: 'Ada', signature: {} } }]);
    });
});

describe('fileField transfers and form submit in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should wait for a transfer under way and submit the file it adds', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = mountComponent('form', { children: { files: { component: 'fileField', '<-value': '$.data.files' } } }, { data: { files: [] }, hooks: { transferFile: hooks.transferFile } });
        await flush();
        const field = deep(mounted.element.shadowRoot as ShadowRoot, 'ui-file-field')[0] as Element;
        const submitted = record(mounted.element, 'submitted');
        const transfer = new DataTransfer();
        transfer.items.add(new File(['hello'], 'a.txt', { type: 'text/plain' }));
        const input = field.shadowRoot?.querySelector('.picker') as HTMLInputElement;
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));

        // Act
        command(mounted.element, 'submit');
        await flush();
        const before = [...submitted];
        const status = mounted.store.get('$.app.status');
        (hooks.calls[0] as Call).resolve({ id: 'f1', name: 'a.txt', size: 5, type: 'text/plain' });
        await vi.waitFor(() => expect(submitted).toHaveLength(1));

        // Assert
        expect(before).toEqual([]);
        expect(status).toBe('submitting');
        expect(submitted).toEqual([{ values: { files: [{ id: 'f1', name: 'a.txt', size: 5, type: 'text/plain' }] } }]);
    });

    it('should refuse the submit when the transfer fails', async () => {
        // Arrange
        const hooks = fakeHooks();
        const mounted = mountComponent('form', { children: { files: { component: 'fileField', '<-value': '$.data.files' } } }, { data: { files: [] }, hooks: { transferFile: hooks.transferFile } });
        await flush();
        const field = deep(mounted.element.shadowRoot as ShadowRoot, 'ui-file-field')[0] as Element;
        const submitted = record(mounted.element, 'submitted');
        const invalid = record(mounted.element, 'invalid');
        const transfer = new DataTransfer();
        transfer.items.add(new File(['hello'], 'a.txt', { type: 'text/plain' }));
        const input = field.shadowRoot?.querySelector('.picker') as HTMLInputElement;
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(hooks.calls).toHaveLength(1));

        // Act
        command(mounted.element, 'submit');
        (hooks.calls[0] as Call).reject('quota');
        await vi.waitFor(() => expect(formInvalid(invalid)).toHaveLength(1));

        // Assert
        expect(submitted).toEqual([]);
        expect(formInvalid(invalid)).toEqual([{ keys: ['files'] }]);
    });
});
