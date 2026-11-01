/** The weekdays a week can start on, as `Date.getDay` counts them: 0 is Sunday, 1 Monday, 6 Saturday */
export type FirstDay = 0 | 1 | 5 | 6;

/**
 * The first day of the week by region, from the CLDR `weekData` (the same data `Intl` has). It is the fallback for a
 * browser that does not answer `Intl.Locale.prototype.getWeekInfo` (before Chromium 130); a region that is not here starts
 * its week on Monday, as CLDR's world default does
 */
export const FIRST_DAY_BY_REGION: Readonly<Record<string, FirstDay>> = Object.freeze(
    Object.fromEntries<FirstDay>([
        ...'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(' ').map((region): [string, FirstDay] => [region, 0]),
        ...'AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' ').map((region): [string, FirstDay] => [region, 6]),
        ['MV', 5]
    ])
);

const DEFAULT_FIRST_DAY: FirstDay = 1;
const FALLBACK_LOCALE = 'en';

interface WeekInfoLocale {
    getWeekInfo?: () => { firstDay: number };
    maximize(): { region?: string; getWeekInfo?: () => { firstDay: number } };
    region?: string;
}

/** The locale as `Intl` reads it, or the fallback locale for a tag `Intl` refuses */
function localeOf(tag: string): WeekInfoLocale {
    try {
        return new Intl.Locale(tag === '' ? FALLBACK_LOCALE : tag) as unknown as WeekInfoLocale;
    } catch {
        return new Intl.Locale(FALLBACK_LOCALE) as unknown as WeekInfoLocale;
    }
}

/** The first day of the week from the fallback table: the region of the tag, or the region the language most likely has (`de` is `DE`, `ar` is `EG`) */
export function firstDayFromTable(tag: string): FirstDay {
    const locale = localeOf(tag);
    const region = locale.region ?? locale.maximize().region;
    return region !== undefined && Object.hasOwn(FIRST_DAY_BY_REGION, region) ? (FIRST_DAY_BY_REGION[region] as FirstDay) : DEFAULT_FIRST_DAY;
}

/** The first day of the week from `Intl.Locale.prototype.getWeekInfo()` (Chromium 130 and later); `undefined` where the browser has no such method */
export function firstDayFromIntl(tag: string): number | undefined {
    const locale = localeOf(tag);
    if (typeof locale.getWeekInfo !== 'function') return undefined;
    const info = (locale.maximize() as unknown as WeekInfoLocale).getWeekInfo?.();
    return typeof info?.firstDay === 'number' ? info.firstDay % 7 : undefined;
}

/**
 * The weekday a week starts on in a locale, as `Date.getDay` counts (0 is Sunday): `Intl` first, the CLDR table where the
 * browser cannot say. A tag `Intl` refuses is read as `en`
 */
export function firstDayOf(tag: string): number {
    return firstDayFromIntl(tag) ?? firstDayFromTable(tag);
}
