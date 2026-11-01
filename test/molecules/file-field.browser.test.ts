import { FileTransferError, snapshotState } from '@punyts/stateui-app';
import type { FileReference, TransferFile, TransferFileOptions } from '@punyts/stateui-app';
import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

interface CommandElement extends Element {
    commands: { validate(): void; reset(): void; focus(): void; clear(): void };
}

interface Call {
    file: File;
    options: TransferFileOptions;
    resolve(reference: FileReference): void;
    reject(code: ConstructorParameters<typeof FileTransferError>[0]): void;
}

const part = <T extends Element>(element: Element, selector: string): T => element.shadowRoot?.querySelector(selector) as T;
const all = <T extends Element>(element: Element, selector: string): T[] => Array.from(element.shadowRoot?.querySelectorAll<T>(selector) ?? []);
const picker = (element: Element): HTMLInputElement => part<HTMLInputElement>(element, '.picker');
const names = (element: Element): string[] => all(element, '.name').map((name) => name.textContent ?? '');
const details = (element: Element): string[] => all(element, '.detail').map((detail) => detail.textContent ?? '');
const errorText = (element: Element): string => part<HTMLElement>(element, '.error')?.textContent ?? '';
const get = (mounted: { store: { get(path: string): unknown } }, name: string): unknown => mounted.store.get(`$.app.${name}`);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const commands = (element: Element): CommandElement['commands'] => (element as CommandElement).commands;
const events = (element: Element, name: string): unknown[] => {
    const seen: unknown[] = [];
    element.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
    return seen;
};

const file = (content: string, name = 'a.txt', type = 'text/plain'): File => new File([content], name, { type });
const reference = (name = 'a.txt', size = 1, type = 'text/plain', id = `id-${name}`): FileReference => ({ id, name, size, type });

/** A `transferFile` hook the test settles by hand */
function fakeHook(): { calls: Call[]; transferFile: TransferFile } {
    const calls: Call[] = [];
    const transferFile: TransferFile = (given, options = {}) =>
        new Promise<FileReference>((resolve, reject) => {
            calls.push({ file: given, options, resolve, reject: (code) => reject(new FileTransferError(code, 'rejected')) });
            options.signal?.addEventListener('abort', () => reject(new FileTransferError('cancelled', 'cancelled')));
        });
    return { calls, transferFile };
}

async function pick(element: Element, ...files: File[]): Promise<void> {
    const transfer = new DataTransfer();
    for (const item of files) transfer.items.add(item);
    const input = picker(element);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    await flush();
}

function dragEvent(type: string, files: File[]): DragEvent {
    const transfer = new DataTransfer();
    for (const item of files) transfer.items.add(item);
    return new DragEvent(type, { dataTransfer: transfer, bubbles: true, composed: true, cancelable: true });
}

function mountFiles(hook: { transferFile?: TransferFile } | undefined, extra: Record<string, unknown> = {}, value: unknown[] = []): ReturnType<typeof mountComponent> {
    return mountComponent('fileField', { '<-value': '$.data.files', ...extra }, { data: { files: value }, ...(hook?.transferFile ? { hooks: { transferFile: hook.transferFile } } : {}) });
}

describe('fileField in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should render a labelled field with a choose button, a single-file picker and no rows', () => {
        // Arrange
        const mounted = mountFiles(fakeHook(), { _label: 'Attachments' });

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Attachments');
        expect(part(mounted.element, '#control').textContent).toBe('Choose files');
        expect(picker(mounted.element).type).toBe('file');
        expect(picker(mounted.element).multiple).toBe(false);
        expect(picker(mounted.element).accept).toContain('image/png');
        expect(picker(mounted.element).accept).not.toContain('text/html');
        expect(all(mounted.element, '.file')).toHaveLength(0);
    });

    it('should open the picker when the button is pressed', () => {
        // Arrange
        const mounted = mountFiles(fakeHook());
        const clicked = vi.fn();
        picker(mounted.element).addEventListener('click', clicked);

        // Act
        part<HTMLButtonElement>(mounted.element, '#control').click();

        // Assert
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('should hand a picked file to the hook and write the reference it resolves with to $.data', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        const changes = events(mounted.element, 'change');
        const picked = file('hello');

        // Act
        await pick(mounted.element, picked);
        hook.calls[0]?.resolve(reference('a.txt', 5));
        await flush();

        // Assert
        expect(hook.calls).toHaveLength(1);
        expect(hook.calls[0]?.file.name).toBe('a.txt');
        expect(hook.calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
        expect(mounted.store.get('$.data.files')).toEqual([{ id: 'id-a.txt', name: 'a.txt', size: 5, type: 'text/plain' }]);
        expect(names(mounted.element)).toEqual(['a.txt']);
        expect(details(mounted.element)).toEqual(['5 B']);
        expect(changes).toEqual([{ value: [{ id: 'id-a.txt', name: 'a.txt', size: 5, type: 'text/plain' }] }]);
        expect(get(mounted, 'error')).toBe('');
    });

    it('should take a dropped file, show the drop state while dragging over and clear it on drop', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        const box = part<HTMLElement>(mounted.element, '.drop');
        const dropped = file('x', 'b.csv', 'text/csv');

        // Act
        const over = dragEvent('dragover', [dropped]);
        box.dispatchEvent(over);
        const draggingOver = box.hasAttribute('data-dragging');
        box.dispatchEvent(dragEvent('drop', [dropped]));
        await flush();
        hook.calls[0]?.resolve(reference('b.csv', 1, 'text/csv'));
        await flush();

        // Assert
        expect(over.defaultPrevented).toBe(true);
        expect(draggingOver).toBe(true);
        expect(box.hasAttribute('data-dragging')).toBe(false);
        expect(hook.calls[0]?.file.name).toBe('b.csv');
        expect(mounted.store.get('$.data.files')).toEqual([{ id: 'id-b.csv', name: 'b.csv', size: 1, type: 'text/csv' }]);
    });

    it('should ignore a drag that carries no files', () => {
        // Arrange
        const mounted = mountFiles(fakeHook());
        const box = part<HTMLElement>(mounted.element, '.drop');
        const over = new DragEvent('dragover', { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true });

        // Act
        box.dispatchEvent(over);

        // Assert
        expect(over.defaultPrevented).toBe(false);
        expect(box.hasAttribute('data-dragging')).toBe(false);
    });

    it('should reject a type outside the allowed list before any transfer, with the accept error', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        const invalid = events(mounted.element, 'invalid');

        // Act
        await pick(mounted.element, file('<b>x</b>', 'page.html', 'text/html'));
        const html = get(mounted, 'error');
        await pick(mounted.element, file('<svg/>', 'pic.svg', 'image/svg+xml'));
        await pick(mounted.element, file('MZ', 'tool.exe', 'application/octet-stream'));

        // Assert
        expect(html).toBe('accept');
        expect(errorText(mounted.element)).toBe('This type of file is not accepted');
        expect(hook.calls).toHaveLength(0);
        expect(invalid).toHaveLength(3);
        expect(mounted.store.get('$.data.files')).toEqual([]);
    });

    it('should narrow the types with accept, and ignore an accept entry outside the allowed list', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { accept: ['image/png', 'text/html'] });

        // Act
        await pick(mounted.element, file('x', 'a.txt', 'text/plain'));
        const refused = get(mounted, 'error');
        await pick(mounted.element, file('<b/>', 'a.html', 'text/html'));
        const html = get(mounted, 'error');
        await pick(mounted.element, file('png', 'a.png', 'image/png'));

        // Assert
        expect(refused).toBe('accept');
        expect(html).toBe('accept');
        expect(hook.calls.map((call) => call.file.name)).toEqual(['a.png']);
        expect(picker(mounted.element).accept).toContain('image/png');
        expect(picker(mounted.element).accept).not.toContain('text/plain');
        expect(picker(mounted.element).accept).not.toContain('text/html');
    });

    it('should reject a file over maxSize before any transfer, with the maxSize error', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { maxSize: 10 });

        // Act
        await pick(mounted.element, file('12345678901'));

        // Assert
        expect(get(mounted, 'error')).toBe('maxSize');
        expect(errorText(mounted.element)).toBe('The file is too large');
        expect(hook.calls).toHaveLength(0);
    });

    it('should report a maxSize over 10 MiB as a SUI-STATE error and accept 10 MiB', () => {
        // Act and Assert
        expect(() => mountFiles(fakeHook(), { maxSize: 10485761 })).toThrow(/SUI-STATE-INVALID.*maxSize/);
        expect(() => mountFiles(fakeHook(), { maxSize: 10485760 })).not.toThrow();
        expect(() => mountFiles(fakeHook(), { maxFiles: 0 })).toThrow(/SUI-STATE-INVALID.*maxFiles/);
    });

    it('should stop at maxFiles, counting stored files and transfers under way', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { maxFiles: 2 }, [reference('old.txt')]);

        // Act
        await pick(mounted.element, file('1', 'one.txt'), file('2', 'two.txt'));

        // Assert
        expect(picker(mounted.element).multiple).toBe(true);
        expect(hook.calls.map((call) => call.file.name)).toEqual(['one.txt']);
        expect(get(mounted, 'error')).toBe('maxFiles');
        expect(errorText(mounted.element)).toBe('Too many files');
        expect(names(mounted.element)).toEqual(['old.txt', 'one.txt']);
    });

    it('should refuse a second file with the default maxFiles of 1', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, {}, [reference('old.txt')]);

        // Act
        await pick(mounted.element, file('x', 'new.txt'));

        // Assert
        expect(hook.calls).toHaveLength(0);
        expect(get(mounted, 'error')).toBe('maxFiles');
    });

    it('should show the progress of a transfer and complete it on the result', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        await pick(mounted.element, file('x'.repeat(100), 'big.txt'));

        // Act
        hook.calls[0]?.options.onProgress?.({ loaded: 40, total: 100 });
        await flush();
        const bar = part<HTMLProgressElement>(mounted.element, '.bar');
        const during = { percent: details(mounted.element), value: bar.value, label: bar.getAttribute('aria-label'), state: part(mounted.element, '.file').getAttribute('data-state') };
        hook.calls[0]?.resolve(reference('big.txt', 100));
        await flush();

        // Assert
        expect(during).toEqual({ percent: ['40%'], value: 40, label: 'big.txt', state: 'uploading' });
        expect(part(mounted.element, '.bar')).toBeNull();
        expect(part(mounted.element, '.file').getAttribute('data-state')).toBe('done');
        expect(details(mounted.element)).toEqual(['100 B']);
    });

    it('should remove a stored file from the value, named by the remove label', async () => {
        // Arrange
        const mounted = mountFiles(fakeHook(), {}, [reference('a.txt'), reference('b.txt')]);
        const remove = all<HTMLButtonElement>(mounted.element, '.remove');
        const label = remove[0]?.getAttribute('aria-label');

        // Act
        remove[0]?.click();
        await flush();

        // Assert
        expect(label).toBe('Remove a.txt');
        expect(mounted.store.get('$.data.files')).toEqual([reference('b.txt')]);
        expect(names(mounted.element)).toEqual(['b.txt']);
    });

    it('should abort a transfer through the hook signal when its file is removed during the upload', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        await pick(mounted.element, file('x'));
        const signal = hook.calls[0]?.options.signal as AbortSignal;

        // Act
        const wasAborted = signal.aborted;
        part<HTMLButtonElement>(mounted.element, '.remove').click();
        await flush();

        // Assert
        expect(wasAborted).toBe(false);
        expect(signal.aborted).toBe(true);
        expect(all(mounted.element, '.file')).toHaveLength(0);
        expect(mounted.store.get('$.data.files')).toEqual([]);
        expect(get(mounted, 'error')).toBe('');
    });

    it('should abort the transfers under way when the clear command runs', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { maxFiles: 3 }, [reference('old.txt')]);
        await pick(mounted.element, file('x', 'one.txt'));
        const signal = hook.calls[0]?.options.signal as AbortSignal;

        // Act
        commands(mounted.element).clear();
        await flush();

        // Assert
        expect(signal.aborted).toBe(true);
        expect(mounted.store.get('$.data.files')).toEqual([]);
        expect(all(mounted.element, '.file')).toHaveLength(0);
    });

    it('should show the code of a rejected transfer as the field error and keep the value', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        await pick(mounted.element, file('x'));

        // Act
        hook.calls[0]?.reject('quota');
        await flush();

        // Assert
        expect(get(mounted, 'error')).toBe('quota');
        expect(errorText(mounted.element)).toBe('The storage limit of this app is reached');
        expect(part(mounted.element, '#control').getAttribute('aria-invalid')).toBe('true');
        expect(mounted.store.get('$.data.files')).toEqual([]);
        expect(all(mounted.element, '.file')).toHaveLength(0);
    });

    it('should name every transfer code with a message and clear the error on the next successful transfer', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        const codes = ['too_large', 'unsupported_type', 'quota', 'not_found', 'unauthorized', 'offline', 'internal'] as const;

        // Act and Assert
        for (const code of codes) {
            await pick(mounted.element, file('x'));
            hook.calls[hook.calls.length - 1]?.reject(code);
            await flush();
            expect(get(mounted, 'error')).toBe(code);
            expect(errorText(mounted.element)).not.toBe('');
        }
        await pick(mounted.element, file('x'));
        hook.calls[hook.calls.length - 1]?.resolve(reference());
        await flush();
        expect(get(mounted, 'error')).toBe('');
        expect(errorText(mounted.element)).toBe('');
    });

    it('should fail with offline when the host gives no transferFile hook', async () => {
        // Arrange
        const mounted = mountFiles(undefined);

        // Act
        await pick(mounted.element, file('x'));

        // Assert
        expect(get(mounted, 'error')).toBe('offline');
        expect(mounted.store.get('$.data.files')).toEqual([]);
        expect(all(mounted.element, '.file')).toHaveLength(0);
    });

    it('should send a file the browser gave no type with the type of its extension', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);

        // Act
        await pick(mounted.element, file('# title', 'notes.md', ''));

        // Assert
        expect(hook.calls[0]?.file.type).toBe('text/markdown');
        expect(hook.calls[0]?.file.name).toBe('notes.md');
    });

    it('should refuse a file with no type and no known extension', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);

        // Act
        await pick(mounted.element, file('x', 'blob', ''));

        // Assert
        expect(get(mounted, 'error')).toBe('accept');
        expect(hook.calls).toHaveLength(0);
    });

    it('should never put file bytes in $.data, the store or a snapshot', async () => {
        // Arrange
        const hook = fakeHook();
        const secret = 'SECRET-FILE-CONTENT-0123456789';
        const mounted = mountFiles(hook);
        await pick(mounted.element, file(secret, 'secret.txt'));
        hook.calls[0]?.options.onProgress?.({ loaded: 10, total: secret.length });

        // Act
        hook.calls[0]?.resolve(reference('secret.txt', secret.length));
        await flush();
        const snapshot = JSON.stringify(snapshotState(mounted.store));
        const whole = JSON.stringify(mounted.store.get('$'));
        const binary: string[] = [];
        const walk = (value: unknown, path: string): void => {
            if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) binary.push(path);
            else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
        };
        walk(mounted.store.get('$'), '$');

        // Assert
        expect(snapshotState(mounted.store).data).toEqual({ files: [{ id: 'id-secret.txt', name: 'secret.txt', size: secret.length, type: 'text/plain' }] });
        expect(snapshot).not.toContain(secret);
        expect(snapshot).not.toContain(btoa(secret));
        expect(whole).not.toContain(secret);
        expect(whole).not.toContain(btoa(secret));
        expect(binary).toEqual([]);
        expect(Object.keys((mounted.store.get('$.data.files') as Record<string, unknown>[])[0] ?? {}).sort()).toEqual(['id', 'name', 'size', 'type']);
    });

    it('should block picking, dropping and removing while disabled or read-only', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { disabled: true }, [reference('a.txt')]);
        const readOnly = mountFiles(hook, { readonly: true }, [reference('a.txt')]);

        // Act
        await pick(mounted.element, file('x'));
        part<HTMLElement>(mounted.element, '.drop').dispatchEvent(dragEvent('drop', [file('x')]));
        await flush();
        part<HTMLButtonElement>(readOnly.element, '.remove').click();
        await flush();

        // Assert
        expect(part<HTMLButtonElement>(mounted.element, '#control').disabled).toBe(true);
        expect(part<HTMLButtonElement>(mounted.element, '.remove').disabled).toBe(true);
        expect(hook.calls).toHaveLength(0);
        expect(readOnly.store.get('$.data.files')).toEqual([reference('a.txt')]);
    });

    it('should fail required validation for an empty list and pass with a file', () => {
        // Arrange
        const mounted = mountFiles(fakeHook(), { required: true });
        const mountedFull = mountFiles(fakeHook(), { required: true }, [reference()]);

        // Act
        commands(mounted.element).validate();
        commands(mountedFull.element).validate();

        // Assert
        expect(get(mounted, 'error')).toBe('required');
        expect(errorText(mounted.element)).toBe('Add a file');
        expect(get(mountedFull, 'error')).toBe('');
    });

    it('should fail validation of a stored list that breaks the rules', () => {
        // Arrange
        const tooMany = mountFiles(fakeHook(), { maxFiles: 1 }, [reference('a.txt'), reference('b.txt')]);
        const badType = mountFiles(fakeHook(), { accept: ['image/png'] }, [reference('a.txt')]);
        const tooBig = mountFiles(fakeHook(), { maxSize: 5 }, [reference('a.txt', 6)]);

        // Act
        commands(tooMany.element).validate();
        commands(badType.element).validate();
        commands(tooBig.element).validate();

        // Assert
        expect(get(tooMany, 'error')).toBe('maxFiles');
        expect(get(badType, 'error')).toBe('accept');
        expect(get(tooBig, 'error')).toBe('maxSize');
    });

    it('should show German labels and messages after the locale changes', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, {}, [reference('a.txt', 1536)]);
        await pick(mounted.element, file('x', 'b.html', 'text/html'));

        // Act
        mounted.setLocale('de');
        await flush();

        // Assert
        expect(part(mounted.element, 'label').textContent).toBe('Dateien');
        expect(part(mounted.element, '#control').textContent).toBe('Dateien wählen');
        expect(errorText(mounted.element)).toBe('Dieser Dateityp wird nicht akzeptiert');
        expect(part(mounted.element, '.remove').getAttribute('aria-label')).toBe('a.txt entfernen');
        expect(details(mounted.element)).toEqual(['1,5 KB']);
    });

    it('should report an accept entry outside the allowed list once as a SUI-STATE warning and keep ignoring it', async () => {
        // Arrange
        const warn = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
        const stateWarnings = (): unknown[][] => warn.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-STATE');
        const hook = fakeHook();
        const mounted = mountFiles(hook, { accept: ['image/png', 'text/html', 'text/html', 'image/svg+xml'] });

        // Assert
        expect(stateWarnings()).toHaveLength(2);
        expect(String(stateWarnings()[0]?.[0])).toContain('"text/html"');
        expect(String(stateWarnings()[1]?.[0])).toContain('"image/svg+xml"');
        expect(stateWarnings()[0]?.[1]).toMatchObject({ code: 'SUI-STATE', path: '$.app' });

        // Act
        await pick(mounted.element, file('<b/>', 'a.html', 'text/html'));
        mounted.store.set('$.app.accept', ['image/png', 'text/html', 'application/zip'] as never);
        await flush();
        mounted.store.set('$.app.accept', ['image/png'] as never);
        mounted.store.set('$.app.accept', ['image/png', 'application/zip'] as never);
        await flush();

        // Assert
        expect(hook.calls).toHaveLength(0);
        expect(get(mounted, 'error')).toBe('accept');
        expect(stateWarnings().map((call) => String(call[0]).match(/"([^"]+)"/)?.[1])).toEqual(['text/html', 'image/svg+xml', 'application/zip', 'application/zip']);
        warn.mockRestore();
    });

    it('should not warn for an accept list of allowed types', () => {
        // Arrange
        const warn = vi.spyOn(report, 'warning').mockImplementation(() => undefined);

        // Act
        mountFiles(fakeHook(), { accept: ['image/png', 'application/pdf'] });

        // Assert
        expect(warn.mock.calls.filter((call) => (call[1] as { code?: string } | undefined)?.code === 'SUI-STATE')).toHaveLength(0);
        warn.mockRestore();
    });

    it('should abort the transfers under way on the reset command so a late result cannot append a file', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook, { maxFiles: 3 }, [reference('old.txt')]);
        await pick(mounted.element, file('x', 'one.txt'));
        const signal = hook.calls[0]?.options.signal as AbortSignal;

        // Act
        commands(mounted.element).reset();
        hook.calls[0]?.resolve(reference('one.txt'));
        await flush();

        // Assert
        expect(signal.aborted).toBe(true);
        expect(mounted.store.get('$.data.files')).toEqual([reference('old.txt')]);
        expect(all(mounted.element, '.file')).toHaveLength(1);
        expect(get(mounted, 'error')).toBe('');
    });

    it('should abort the transfers under way when a form resets the field', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountComponent(
            'form',
            { children: { files: { component: 'fileField', '<-value': '$.data.files' } } },
            { data: { files: [] }, hooks: { transferFile: hook.transferFile } }
        );
        const field = (function find(root: ParentNode): Element | undefined {
            for (const child of Array.from(root.children)) {
                if (child.localName === 'ui-file-field') return child;
                const inner = (child.shadowRoot ? find(child.shadowRoot) : undefined) ?? find(child);
                if (inner) return inner;
            }
            return undefined;
        })(mounted.element.shadowRoot as ShadowRoot) as Element;
        await pick(field, file('x', 'one.txt'));
        const signal = hook.calls[0]?.options.signal as AbortSignal;

        // Act
        (mounted.element as CommandElement).commands.reset();
        hook.calls[0]?.resolve(reference('one.txt'));
        await flush();

        // Assert
        expect(signal.aborted).toBe(true);
        expect(mounted.store.get('$.data.files')).toEqual([]);
        expect(all(field, '.file')).toHaveLength(0);
    });

    it('should ignore a late result for a transfer that was removed', async () => {
        // Arrange
        const hook = fakeHook();
        const mounted = mountFiles(hook);
        await pick(mounted.element, file('x'));

        // Act
        part<HTMLButtonElement>(mounted.element, '.remove').click();
        hook.calls[0]?.resolve(reference());
        await flush();

        // Assert
        expect(mounted.store.get('$.data.files')).toEqual([]);
    });
});
