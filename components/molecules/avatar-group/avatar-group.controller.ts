import type { ControllerContext } from '@punyts/stateui';
import { initialsOf } from '../shared/avatar/initials.js';

/** One avatar the view draws: the person's name (its accessible name), the initials and the picture, if any */
interface Shown {
    readonly name: string;
    readonly initials: string;
    readonly src: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A picture address the group draws: `https:` or a `data:` image, as the shape's pattern allows; anything else draws the initials */
const pictureOf = (value: unknown): string => {
    const src = text(value);
    return src.startsWith('https:') || src.startsWith('data:image/') ? src : '';
};

/**
 * Keeps the runtime properties `shown` (the first `max` people, each with `name`, `initials` and `src`, keyed `a0`,
 * `a1`, ...) and `extra` (how many people are left over) in step with `people` (a list, or a map in key order, of
 * `{ name, src }`) and `max`. The view draws each shown person as `avatar` does, a picture or else the initials, named
 * by the name, and the left-over count as a `+N` avatar named by `_more` (`{count}`). When the people do not fill
 * `max`, all are shown and there is no `+N` avatar; when one more than `max` would show, `max - 1` are shown and the
 * `+N` avatar takes the last place, so the group is never wider than `max` avatars
 */
export default function controller({ store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const refresh = (): void => {
        const people = read('people');
        const entries: unknown[] = Array.isArray(people) ? people : typeof people === 'object' && people !== null ? Object.values(people) : [];
        const persons = entries.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
        const max = read('max');
        const limit = typeof max === 'number' && Number.isInteger(max) && max >= 1 ? max : 1;
        const count = persons.length > limit ? Math.max(0, limit - 1) : persons.length;
        const shown: Record<string, Shown> = {};
        persons.slice(0, count).forEach((person, index) => {
            const name = text(person['name']).trim();
            shown[`a${index}`] = { name, initials: initialsOf(name), src: pictureOf(person['src']) };
        });
        store.set(`${basePath}.shown`, shown);
        store.set(`${basePath}.extra`, persons.length - count);
    };
    const watched = [`${basePath}.people`, `${basePath}.people.$all`, `${basePath}.max`];
    store.on(watched, refresh);
    refresh();
    return {
        /** The accessible name of the `+N` avatar: `_more` with `{count}` replaced */
        moreLabel: (template: unknown, count: unknown): string => text(template).replaceAll('{count}', String(count)),
        dispose: () => {
            store.off(watched, refresh);
        }
    };
}
