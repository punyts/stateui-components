import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { passwordStrength } from '../shared/password/strength.js';

/**
 * A single-line text field on the field base. With `inputType: "password"` a button beside the control shows and hides
 * what is typed (`reveal`, the runtime `revealed`, which a change of `inputType` turns off), and `strength` adds a hint
 * under the control: a bar of four steps and the `_strength` text for the reflected `level` (`weak`, `fair`, `good`,
 * `strong`), from `passwordStrength`. The hint describes the control. The password is measured, never kept or reported
 */
export default function controller(context: ControllerContext) {
    const { store, basePath } = context;
    const path = (name: string): string => `${basePath}.${name}`;
    const field = createField(context);

    const measure = (): void => {
        const value = store.get<unknown>(path('value'));
        const on = store.get<unknown>(path('strength')) === true && store.get<unknown>(path('inputType')) === 'password';
        const { score, level } = on && typeof value === 'string' ? passwordStrength(value) : { score: 0, level: '' };
        const texts = store.get<unknown>(path('_strength'));
        const text = level !== '' && typeof texts === 'object' && texts !== null ? (texts as Record<string, unknown>)[level] : '';
        store.set(path('score'), score);
        store.set(path('level'), level);
        store.set(path('levelText'), typeof text === 'string' ? text : '');
    };
    const conceal = (): void => {
        if (store.get<unknown>(path('revealed')) === true) store.set(path('revealed'), false);
    };
    const measured = [path('value'), path('strength'), path('inputType'), path('_strength'), path('_strength.$all')];
    store.on(measured, measure);
    store.on(path('inputType'), conceal);
    measure();

    return {
        ...field,
        onReveal: (): void => {
            store.set(path('revealed'), store.get<unknown>(path('revealed')) !== true);
        },
        /** The control's description: the strength hint when it shows, then the help and the error that are shown */
        strengthDescribedBy: (level: unknown, help: unknown, message: unknown): string | null => {
            const ids = [typeof level === 'string' && level !== '' ? 'strength' : '',field.describedBy(help, message) ?? ''].filter((id) => id !== '');
            return ids.length > 0 ? ids.join(' ') : null;
        },
        dispose: (): void => {
            store.off(measured, measure);
            store.off(path('inputType'), conceal);
            field.dispose();
        }
    };
}
