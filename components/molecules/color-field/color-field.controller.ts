import type { ControllerContext } from '@punyts/stateui';
import { COLOR_RULE, isHexColor, normalizeHex } from '../shared/color/color.js';
import { createField } from '../shared/field/field.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A preset colour as the view draws it: the colour and its accessible name */
interface Preset {
    readonly color: string;
    readonly label: string;
}

/**
 * A colour field on the field base. `value` is `#rrggbb` (empty for none). The hex text is the control: it writes as the
 * person types, and on commit (blur or Enter) what was typed is normalized (`1A2B3C` and `#abc` become `#1a2b3c` and
 * `#aabbcc`). The swatch before it is the native colour input, named by `_pick`, which writes the colour the picker
 * gives. Text that is not a colour fails the rule `pattern` (the field's own entry rule, so `required` still reports an
 * empty value). `swatches` lists preset colours, drawn as toggle buttons named by `_swatch` (`{color}`) in a group named
 * by `_swatches`; entries that are not `#rrggbb` colours are left out. The runtime property `presets` holds them,
 * kept in step with `swatches` and `_swatch`
 */
export default function controller(context: ControllerContext) {
    const { store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const field = createField(context, 'value', {
        entryRule: () => {
            const value = read('value');
            return value === '' || value === undefined || value === null || isHexColor(value) ? '' : COLOR_RULE;
        }
    });

    const refresh = (): void => {
        const swatches = read('swatches');
        const template = text(read('_swatch'));
        const presets: Record<string, Preset> = {};
        if (Array.isArray(swatches)) {
            swatches.filter(isHexColor).forEach((color, index) => {
                const lower = color.toLowerCase();
                presets[`p${index}`] = { color: lower, label: template.replaceAll('{color}', lower) };
            });
        }
        store.set(`${basePath}.presets`, presets);
    };
    const watched = [`${basePath}.swatches`, `${basePath}.swatches.$all`, `${basePath}._swatch`];
    store.on(watched, refresh);
    refresh();

    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;
    const write = (next: string): void => {
        if (read('value') !== next) store.set(valuePath, next);
    };

    return {
        ...field,
        /** The colour the native picker shows: the value when it is a colour, else black, the picker's own default */
        pickerColor: (value: unknown): string => (isHexColor(value) ? value.toLowerCase() : '#000000'),
        /** Whether there is a preset to draw, so an empty group is not announced */
        hasPresets: (presets: unknown): boolean => typeof presets === 'object' && presets !== null && Object.keys(presets).length > 0,
        /** Whether a preset is the current value, compared without case */
        isCurrent: (color: unknown, value: unknown): string => (typeof value === 'string' && color === value.toLowerCase() ? 'true' : 'false'),
        onCommit: (event: Event) => {
            const input = event.currentTarget as HTMLInputElement | null;
            if (!input || blocked()) return;
            write(normalizeHex(input.value));
        },
        onPick: (event: Event) => {
            const input = event.currentTarget as HTMLInputElement | null;
            if (!input || blocked()) return;
            write(input.value.toLowerCase());
        },
        onPreset: (event: Event) => {
            const color = (event.currentTarget as HTMLElement | null)?.dataset['color'];
            if (color === undefined || blocked()) return;
            store.set(`${basePath}.touched`, true);
            write(color);
        },
        dispose: () => {
            store.off(watched, refresh);
            field.dispose();
        }
    };
}
