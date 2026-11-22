/**
 * The pure parts of `mediaPlayer`: which sources it plays, its caption tracks, and how it writes a time. A media file or
 * a caption track is an https URL with a host or a path of the app's own origin (a file that ships with the app). The
 * URL rule of `@punyts/stateui-app` allows no `data:` but pictures, and the runtime frame no `blob:`, so inline media
 * is not played; anything else is left out
 */

const HTTPS = /^https:\/\/[^/?#@\s]+(?:[/?#]|$)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE = /[\u0000- \u007f-\u009f\\]/;

/** Whether a media file or caption track may be loaded from `src` */
export function isMediaUrl(src: unknown): src is string {
    if (typeof src !== 'string' || src === '' || UNSAFE.test(src)) return false;
    if (HTTPS.test(src)) return true;
    return !SCHEME.test(src) && !src.startsWith('//') && !src.startsWith('#');
}

/** The source to play, or '' when `src` is not one the player plays */
export function mediaSource(src: unknown): string {
    return isMediaUrl(src) ? src : '';
}

/** A caption track as the view draws it */
export interface CaptionTrack {
    readonly src: string;
    readonly srclang: string;
    readonly label: string;
}

/** The caption tracks of a keyed map `{ <key>: { src, srclang, _label } }`, in order, those with an unsafe `src` left out */
export function captionTracks(tracks: unknown): Record<string, CaptionTrack> {
    const result: Record<string, CaptionTrack> = {};
    if (tracks === null || typeof tracks !== 'object' || Array.isArray(tracks)) return result;
    for (const [key, value] of Object.entries(tracks as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        if (!isMediaUrl(entry.src)) continue;
        const srclang = typeof entry.srclang === 'string' ? entry.srclang : '';
        result[key] = { src: entry.src, srclang, label: typeof entry._label === 'string' && entry._label !== '' ? entry._label : srclang || key };
    }
    return result;
}

/** A time in seconds as `m:ss`, or `h:mm:ss` from an hour; '0:00' for a time that is not a number */
export function formatTime(seconds: number): string {
    const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
