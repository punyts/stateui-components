/** The wall clock of an instant in a time zone: `YYYY-MM-DDTHH:MM`, with `:SS` when the seconds are not zero, as a `datetime-local` input holds it */
export type WallTime = string;

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** True when the runtime knows the IANA time zone (`Europe/Berlin`, `UTC`) */
export function isTimeZone(zone: unknown): zone is string {
    if (typeof zone !== 'string' || zone === '') return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

const partsFormatter = (zone: string): Intl.DateTimeFormat => {
    let formatter = formatters.get(zone);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        formatters.set(zone, formatter);
    }
    return formatter;
};

/** The calendar fields of an instant in a zone */
function fieldsAt(instant: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const parts = Object.fromEntries(partsFormatter(zone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return { year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']), hour: Number(parts['hour']) % 24, minute: Number(parts['minute']), second: Number(parts['second']) };
}

/** The zone's offset from UTC at an instant, in minutes (Berlin in winter: 60) */
export function offsetAt(instant: number, zone: string): number {
    const f = fieldsAt(instant, zone);
    const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
    return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MS_PER_MINUTE);
}

const pad = (value: number, size = 2): string => String(Math.abs(value)).padStart(size, '0');

/** An offset in minutes as ISO 8601 writes it: `+01:00`, `-05:30`, `+00:00` */
export const offsetText = (minutes: number): string => `${minutes < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

/** The wall clock of an instant in a zone */
export function wallTimeOf(instant: number, zone: string): WallTime {
    const f = fieldsAt(instant, zone);
    return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}${f.second === 0 ? '' : `:${pad(f.second)}`}`;
}

/**
 * The instant a wall clock names in a zone, or `undefined` for text that is not a wall time. A wall time that a clock
 * change skips (a spring-forward gap) moves forward by the gap; one it repeats (the autumn hour) is the earlier instant
 */
export function instantOf(wall: string, zone: string): number | undefined {
    const match = WALL.exec(wall);
    if (match === null) return undefined;
    const [, y, mo, d, h, mi, s] = match;
    const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
    if (Number.isNaN(asUtc)) return undefined;
    // A clock changes at most once a day: the offsets a day before and after are the two the wall time can have
    const before = offsetAt(asUtc - MS_PER_DAY, zone);
    const after = offsetAt(asUtc + MS_PER_DAY, zone);
    const asked = s === undefined || s === '00' ? wall.slice(0, 16) : wall;
    const shown = [asUtc - before * MS_PER_MINUTE, asUtc - after * MS_PER_MINUTE].filter((instant) => wallTimeOf(instant, zone) === asked);
    // In a gap neither shows it: the offset from before the change moves the time forward by the gap
    return shown.length > 0 ? Math.min(...shown) : asUtc - before * MS_PER_MINUTE;
}

/** An instant as an ISO date-time with the zone's offset at that instant: `2026-11-21T14:30:00+01:00` */
export function isoInZone(instant: number, zone: string): string {
    return `${wallTimeOf(instant, zone).slice(0, 16)}:${pad(fieldsAt(instant, zone).second)}${offsetText(offsetAt(instant, zone))}`;
}

/** The instant of an ISO date-time that carries an offset or `Z`; a date-time without one is not an instant and is `undefined` */
export function parseInstant(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return undefined;
    const instant = Date.parse(value);
    return Number.isNaN(instant) ? undefined : instant;
}

/** The zone and its offset at an instant as the locale names it: `Europe/Berlin (GMT+1)` */
export function zoneLabel(instant: number, zone: string, locale: string): string {
    try {
        const name = new Intl.DateTimeFormat(locale || 'en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date(instant)).find((part) => part.type === 'timeZoneName')?.value;
        return name === undefined || name === '' ? zone : `${zone} (${name})`;
    } catch {
        return zone;
    }
}
