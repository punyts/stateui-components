import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { ratingForKey, ratingOf, starsOf } from '../shared/rating/rating.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A star rating on the field base. `value` is a whole number from 0 (not rated) to `max`; the stars are one
 * `role="slider"` element, so a screen reader hears the rating as `_valueText` (`{value}` and `{max}`) or `_empty` at 0.
 * The arrows step by one (Left and Right swap in right-to-left text), Home gives 0, End gives `max` and a digit key
 * gives that rating; a press on a star gives its number. While the pointer is over the stars they preview the rating it
 * points at (`preview`, 0 for none). `readonly` shows the rating and takes no input; `disabled` also takes the stars
 * out of the tab order. `required` fails at 0, since 0 is not a rating. The runtime properties `stars` (`max` read as 1
 * to 10), `rating` (`value` read as a whole number in range), `preview` and `valueText` are kept in step with `value`,
 * `max`, `_valueText` and `_empty`
 */
export default function controller(context: ControllerContext) {
    const { element, store, basePath } = context;
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const valuePath = `${basePath}.value`;
    const stars = (): number => starsOf(read('max'));
    const rating = (): number => ratingOf(read('value'), stars());
    const field = createField(context, 'value', {
        entryRule: () => (read('required') === true && rating() === 0 ? 'required' : ''),
        empty: () => 0
    });

    const blocked = (): boolean => read('disabled') === true || read('locked') === true || read('readonly') === true;
    const refresh = (): void => {
        const count = stars();
        const current = rating();
        store.set(`${basePath}.stars`, count);
        store.set(`${basePath}.rating`, current);
        store.set(`${basePath}.valueText`, current === 0 ? text(read('_empty')) : text(read('_valueText')).replaceAll('{value}', String(current)).replaceAll('{max}', String(count)));
    };
    const watched = [valuePath, `${basePath}.max`, `${basePath}._valueText`, `${basePath}._empty`];
    store.on(watched, refresh);
    refresh();

    const commit = (next: number): void => {
        if (read('value') === next) return;
        store.set(valuePath, next);
    };
    /** The number of the star an event happened on, or 0 when it was not on a star */
    const starOf = (event: Event): number => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-star]') : null;
        const number = Number(target?.dataset['star']);
        return Number.isInteger(number) && number > 0 ? number : 0;
    };
    const setPreview = (number: number): void => {
        if (read('preview') !== number) store.set(`${basePath}.preview`, number);
    };

    return {
        ...field,
        onKeyDown: (event: KeyboardEvent) => {
            if (blocked()) return;
            const next = ratingForKey(event.key, rating(), stars(), getComputedStyle(element).direction === 'rtl');
            if (next === undefined) return;
            event.preventDefault();
            commit(next);
        },
        onPointerMove: (event: PointerEvent) => {
            setPreview(blocked() ? 0 : starOf(event));
        },
        onPointerLeave: () => {
            setPreview(0);
        },
        onClick: (event: MouseEvent) => {
            const number = starOf(event);
            if (blocked() || number === 0) return;
            commit(number);
        },
        dispose: () => {
            store.off(watched, refresh);
            field.dispose();
        }
    };
}
