import { report } from '@punyts/core';
import type { ControllerContext } from '@punyts/stateui';
import { QR_LEVELS, encodeQr, qrPath } from '../shared/qr/qr.js';
import type { QrLevel } from '../shared/qr/qr.js';

/** The quiet zone around the code, in modules, as the standard asks */
const QUIET_ZONE = 4;

/**
 * Encodes `value` as a QR code at `level` (byte mode, UTF-8, the smallest version that holds it) and writes the runtime
 * `path` (the dark modules) and `extent` (the side in modules with the quiet zone) that the view's svg draws. An empty
 * value draws nothing; a value past version 40 sets the reflected `overflow`, draws nothing and is reported by its
 * length, never its text. No layout is read
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const value = read('value');
        const text = typeof value === 'string' ? value : '';
        const level = read('level');
        const code = text === '' ? undefined : encodeQr(text, QR_LEVELS.includes(level as QrLevel) ? (level as QrLevel) : 'medium');
        const overflow = text !== '' && code === undefined;
        if (overflow) report.warning('qrCode: the value is too long for a QR code', { code: 'SUI-RUN-BINDING', path: basePath, length: text.length });
        store.set(`${basePath}.path`, code === undefined ? '' : qrPath(code, QUIET_ZONE));
        store.set(`${basePath}.extent`, code === undefined ? 0 : code.size + QUIET_ZONE * 2);
        store.set(`${basePath}.overflow`, overflow);
    };
    const watched = [`${basePath}.value`, `${basePath}.level`];
    store.on(watched, refresh);
    refresh();
    return {
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
