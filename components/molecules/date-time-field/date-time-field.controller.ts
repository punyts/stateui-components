import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';
import { instantOf, isTimeZone, isoInZone, parseInstant, wallTimeOf, zoneLabel } from '../shared/dates/zone.js';

/** The zone of the viewer's own clock, for a field with no `timeZone` */
const ownZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * A date and time in a named zone. The control is a `datetime-local` input bound to the runtime `local` (the wall clock
 * in the zone); the controller turns it into `value`, an ISO date-time with the zone's offset at that instant
 * (`2026-11-21T14:30:00+01:00`), and turns a `value` written from outside (with any offset or `Z`) back into the zone's
 * wall clock. `timeZone` is an IANA name; empty, or one the runtime does not know, is the viewer's own zone, written to
 * the runtime `zone`. A wall time a clock change skips moves forward by the gap; a repeated hour takes the earlier
 * instant. `min` and `max` are ISO date-times with an offset, compared as instants and shown to the control in the zone
 * (`localMin`, `localMax`). The rules are `required`, `invalid` (a `value` that is not a date-time with an offset),
 * `min` and `max`. `zoneText` names the zone and its offset (`Europe/Berlin (GMT+1)`); `showZone` shows it under the
 * control and adds it to the control's description
 */
export default function controller(context: ControllerContext) {
    const { store, basePath } = context;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const zone = (): string => {
        const asked = read('timeZone');
        return isTimeZone(asked) ? asked : ownZone();
    };
    const locale = (): string => {
        const value = store.get<unknown>('$.locale');
        return typeof value === 'string' ? value : '';
    };
    const field = createField(context, 'value', {
        exclusive: true,
        empty: () => '',
        entryRule: () => {
            const value = read('value');
            if (value === '' || value === undefined || value === null) return read('required') === true ? 'required' : '';
            const instant = parseInstant(value);
            if (instant === undefined) return 'invalid';
            const min = parseInstant(read('min'));
            const max = parseInstant(read('max'));
            if (min !== undefined && instant < min) return 'min';
            if (max !== undefined && instant > max) return 'max';
            return '';
        }
    });

    /** `value` (and the bounds and zone) into the control's wall clock */
    const fromValue = (): void => {
        const current = zone();
        const value = read('value');
        const instant = parseInstant(value);
        const typed = read('local');
        if (value === '' || value === undefined) {
            if (typed !== '') store.set(path('local'), '');
        } else if (instant !== undefined && (typeof typed !== 'string' || instantOf(typed, current) !== instant)) {
            // The control keeps what was typed while it reads as the same instant
            store.set(path('local'), wallTimeOf(instant, current));
        }
        const bound = (name: string): string => {
            const at = parseInstant(read(name));
            return at === undefined ? '' : wallTimeOf(at, current);
        };
        store.set(path('localMin'), bound('min'));
        store.set(path('localMax'), bound('max'));
        store.set(path('zone'), current);
        store.set(path('zoneText'), zoneLabel(instant ?? Date.now(), current, locale()));
    };

    /** The control's wall clock into `value` */
    const fromLocal = (): void => {
        const typed = read('local');
        if (typeof typed !== 'string') return;
        const next = typed === '' ? '' : (() => {
            const instant = instantOf(typed, zone());
            return instant === undefined ? undefined : isoInZone(instant, zone());
        })();
        if (next === undefined) return;
        const before = parseInstant(read('value'));
        if (next === read('value') || (next !== '' && before !== undefined && before === parseInstant(next))) return;
        store.set(path('value'), next);
    };

    const valuePaths = [path('value'), path('timeZone'), path('min'), path('max'), '$.locale'];
    const localPath = path('local');
    store.on(valuePaths, fromValue);
    store.on(localPath, fromLocal);
    fromValue();

    return {
        ...field,
        /** The control's description: the zone (when shown), the help and the error that are shown */
        zoneDescribedBy: (showZone: unknown, help: unknown, message: unknown): string | null => {
            const ids = [showZone === true ? 'zone' : '', field.describedBy(help, message) ?? ''].filter((id) => id !== '');
            return ids.length > 0 ? ids.join(' ') : null;
        },
        dispose: () => {
            store.off(valuePaths, fromValue);
            store.off(localPath, fromLocal);
            field.dispose();
        }
    };
}
