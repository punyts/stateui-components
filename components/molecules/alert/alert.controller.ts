import type { ControllerContext } from '@punyts/stateui';

interface CommandHost {
    commands?: Record<string, () => void>;
}

const TONE_ICONS: Readonly<Record<string, string>> = {
    danger: 'alert-circle',
    warning: 'alert-triangle',
    success: 'circle-check'
};
const DEFAULT_ICON = 'info-circle';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Keeps the runtime property `glyph` (the icon shown: `icon`, or the default of the tone) in step, and provides the
 * commands `open` and `close`. `close` (the command or the button) writes `open: false` and raises `close`; `open`
 * writes `open: true`. The view picks the role (`alert` for `danger` and `warning`, `status` otherwise)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const iconPath = `${basePath}.icon`;
    const tonePath = `${basePath}.tone`;
    const openPath = `${basePath}.open`;
    const watched = [iconPath, tonePath];

    const syncGlyph = (): void => {
        const icon = text(store.get<unknown>(iconPath));
        store.set(`${basePath}.glyph`, icon !== '' ? icon : (TONE_ICONS[text(store.get<unknown>(tonePath))] ?? DEFAULT_ICON));
    };
    const close = (): void => {
        if (store.get<unknown>(openPath) === false) return;
        store.set(openPath, false);
        element.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    };
    host.commands = {
        open: () => store.set(openPath, true),
        close
    };
    store.on(watched, syncGlyph);
    syncGlyph();
    return {
        onClose: close,
        dispose: () => {
            store.off(watched, syncGlyph);
            delete host.commands;
        }
    };
}
