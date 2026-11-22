import type { ControllerContext } from '@punyts/stateui';
import { captionTracks, formatTime, mediaSource } from '../shared/media/media.js';

interface CommandHost {
    commands?: Record<string, () => void>;
}

/**
 * Plays `src` (an https URL or a path of the app's own origin; anything else plays nothing) in a `video` or `audio` element with
 * the player's own controls. The media's events write the runtime `playing`, `current`, `duration`, `timeText` and
 * `failed`, and raise `play`, `pause` and `ended`; the seek slider sets the time, the mute button writes `muted`, the
 * captions button shows the first caption track or hides them all (`captionsOn`) and the full-screen button asks for
 * the player full screen. Keys on the player: `k` plays or pauses, `m` mutes, `c` toggles captions, `f` goes full
 * screen, and the arrows (outside the slider) move five seconds. A play the browser refuses (no gesture) leaves
 * `playing` false
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const host = element as Element & CommandHost;
    const path = (name: string): string => `${basePath}.${name}`;
    const read = (name: string): unknown => store.get<unknown>(path(name));
    const media = (): HTMLMediaElement | null => element.shadowRoot?.querySelector<HTMLMediaElement>('.media') ?? null;
    const raise = (name: string): void => {
        element.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    };

    const refreshSource = (): void => {
        store.set(path('source'), mediaSource(read('src')));
        store.set(path('failed'), false);
        store.set(path('playing'), false);
        store.set(path('current'), 0);
        store.set(path('duration'), 0);
        writeTime();
    };
    const refreshTracks = (): void => {
        const tracks = captionTracks(read('tracks'));
        store.set(path('captions'), tracks);
        store.set(path('hasCaptions'), Object.keys(tracks).length > 0);
    };
    const writeTime = (): void => {
        const current = read('current');
        const duration = read('duration');
        store.set(path('timeText'), `${formatTime(typeof current === 'number' ? current : 0)} / ${formatTime(typeof duration === 'number' ? duration : 0)}`);
    };
    const showCaptions = (on: boolean): void => {
        const list = media()?.textTracks;
        if (list === undefined) return;
        for (let i = 0; i < list.length; i++) {
            const track = list[i] as TextTrack;
            track.mode = on && i === 0 ? 'showing' : 'hidden';
        }
        store.set(path('captionsOn'), on && list.length > 0);
    };
    const play = (): void => {
        const element = media();
        if (element === null || read('source') === '') return;
        element.play().catch(() => store.set(path('playing'), false));
    };
    const pause = (): void => media()?.pause();
    const toggle = (): void => {
        if (read('playing') === true) pause();
        else play();
    };
    const seekBy = (seconds: number): void => {
        const element = media();
        if (element === null || !Number.isFinite(element.duration)) return;
        element.currentTime = Math.min(element.duration, Math.max(0, element.currentTime + seconds));
    };
    const fullscreen = (): void => {
        const player = element.shadowRoot?.querySelector<HTMLElement>('.player');
        if (player === null || player === undefined) return;
        if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
        else void player.requestFullscreen?.().catch(() => undefined);
    };

    /** The muted attribute sets only the default; a change is written to the element */
    const applyMuted = (): void => {
        const element = media();
        if (element !== null) element.muted = read('muted') === true;
    };
    const mutedWatch = [path('muted')];
    store.on(mutedWatch, applyMuted);
    const sourceWatch = [path('src')];
    const trackWatch = [path('tracks'), path('tracks.$all')];
    store.on(sourceWatch, refreshSource);
    store.on(trackWatch, refreshTracks);
    refreshSource();
    refreshTracks();

    host.commands = { play, pause, toggle };

    return {
        onToggle: toggle,
        onPlay: (): void => {
            store.set(path('playing'), true);
            raise('play');
        },
        onPause: (): void => {
            store.set(path('playing'), false);
            raise('pause');
        },
        onEnded: (): void => {
            store.set(path('playing'), false);
            raise('ended');
        },
        onTime: (event: Event): void => {
            const target = event.currentTarget as HTMLMediaElement;
            store.set(path('current'), target.currentTime);
            store.set(path('duration'), Number.isFinite(target.duration) ? target.duration : 0);
            writeTime();
        },
        onLoaded: (event: Event): void => {
            const target = event.currentTarget as HTMLMediaElement;
            store.set(path('duration'), Number.isFinite(target.duration) ? target.duration : 0);
            writeTime();
            showCaptions(read('captionsOn') === true);
        },
        onVolume: (event: Event): void => {
            const target = event.currentTarget as HTMLMediaElement;
            if (target.muted !== (read('muted') === true)) store.set(path('muted'), target.muted);
        },
        onError: (): void => {
            if (read('source') !== '') store.set(path('failed'), true);
            store.set(path('playing'), false);
        },
        onSeek: (event: Event): void => {
            const element = media();
            const value = Number((event.currentTarget as HTMLInputElement).value);
            if (element !== null && Number.isFinite(value)) element.currentTime = value;
        },
        onMute: (): void => {
            store.set(path('muted'), read('muted') !== true);
        },
        onCaptions: (): void => showCaptions(read('captionsOn') !== true),
        onFullscreen: fullscreen,
        onKeyDown: (event: KeyboardEvent): void => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const fromSlider = event.target instanceof HTMLInputElement;
            let handled = true;
            if (event.key === 'k') toggle();
            else if (event.key === 'm') store.set(path('muted'), read('muted') !== true);
            else if (event.key === 'c' && read('hasCaptions') === true) showCaptions(read('captionsOn') !== true);
            else if (event.key === 'f' && read('kind') !== 'audio') fullscreen();
            else if (event.key === 'ArrowLeft' && !fromSlider) seekBy(-5);
            else if (event.key === 'ArrowRight' && !fromSlider) seekBy(5);
            else handled = false;
            if (handled) event.preventDefault();
        },
        dispose: (): void => {
            store.off(mutedWatch, applyMuted);
            store.off(sourceWatch, refreshSource);
            store.off(trackWatch, refreshTracks);
            delete host.commands;
        }
    };
}
