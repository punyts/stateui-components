/** The key names a `scene3d` may take (`keys`): the arrows, Space, Enter, Escape, the letters and the digits */
export const SCENE_KEYS: readonly string[] = [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Space',
    'Enter',
    'Escape',
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    ...'0123456789'.split('')
];

/** The keys a press on a proxy button keeps for itself */
const BUTTON_KEYS = new Set(['Space', 'Enter']);

/** The parts of a key press the scene reads */
export interface KeyPress {
    readonly key: string;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
}

/** The listed names of `value`, in order, without repeats; anything else is left out */
export function readSceneKeys(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const names: string[] = [];
    for (const item of value) if (typeof item === 'string' && SCENE_KEYS.includes(item) && !names.includes(item)) names.push(item);
    return names;
}

/** The name of a key press (`' '` is `Space`, a letter is lower case with or without Shift) */
export function keyName(key: string): string {
    if (key === ' ') return 'Space';
    return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * The name the scene raises `key` with for a press, or undefined when the press is not taken: its key is not listed,
 * Alt, Control or Meta is held (the host's and the browser's chords), or it is Enter or Space on a proxy button
 */
export function takenKey(press: KeyPress, keys: readonly string[], onButton: boolean): string | undefined {
    if (press.altKey || press.ctrlKey || press.metaKey) return undefined;
    const name = keyName(press.key);
    if (!keys.includes(name)) return undefined;
    if (onButton && BUTTON_KEYS.has(name)) return undefined;
    return name;
}
