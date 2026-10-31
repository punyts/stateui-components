import type { ControllerContext } from '@punyts/stateui';
import { toneIcon } from '../shared/tone/toneGlyph.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Keeps the runtime property `glyph` (the icon shown: `icon`, or the default of the tone) in step. The close button
 * only raises `close`: the owner of the toast (`toastRegion`) removes the node, so the toast keeps no `open` state.
 * The view picks the role (`alert` for `danger` and `warning`, `status` otherwise)
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const iconPath = `${basePath}.icon`;
    const tonePath = `${basePath}.tone`;
    const watched = [iconPath, tonePath];

    const syncGlyph = (): void => {
        const icon = text(store.get<unknown>(iconPath));
        store.set(`${basePath}.glyph`, icon !== '' ? icon : toneIcon(store.get<unknown>(tonePath)));
    };
    store.on(watched, syncGlyph);
    syncGlyph();
    return {
        onClose: () => element.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })),
        dispose: () => store.off(watched, syncGlyph)
    };
}
