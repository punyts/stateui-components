import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

const root = (element: Element): ShadowRoot => element.shadowRoot as ShadowRoot;
const part = <T extends HTMLElement>(element: Element, selector: string): T => root(element).querySelector(selector) as T;
const until = async (check: () => boolean, timeout = 3000): Promise<void> => {
    const start = performance.now();
    while (!check()) {
        if (performance.now() - start > timeout) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

/** A silent 4 second WAV and an English caption file that the browser test server serves from the project */
const SILENCE = '/test/fixtures/silence-4s.wav';
const CAPTIONS = '/test/fixtures/captions.en.vtt';
/** A path the test server does not serve, as a file URL whose grant ran out answers */
const MISSING = '/test/fixtures/missing-clip.wav';
/** A stored file's reference, as a fileField writes it */
const CLIP = { id: '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10', name: 'briefing.wav', size: 64044, type: 'audio/wav' };

describe('mediaPlayer in Chromium', () => {
    afterEach(() => {
        mountComponent.unmountAll();
    });

    it('should load the duration, play and pause from its own button and raise play and pause', async () => {
        // Arrange
        const mounted = mountComponent('mediaPlayer', { kind: 'audio', src: SILENCE, _label: 'Briefing' });
        const events: string[] = [];
        for (const name of ['play', 'pause']) mounted.element.addEventListener(name, () => events.push(name));
        await until(() => mounted.store.get('$.app.duration') === 4);

        // Act
        await userEvent.click(part(mounted.element, '.play'));
        await until(() => mounted.store.get('$.app.playing') === true);
        const playingLabel = part(mounted.element, '.play').getAttribute('aria-label');
        await userEvent.click(part(mounted.element, '.play'));
        await until(() => mounted.store.get('$.app.playing') === false);

        // Assert
        expect(events).toEqual(['play', 'pause']);
        expect(playingLabel).toBe('Pause');
        expect(part(mounted.element, '.time').textContent).toMatch(/^0:0\d \/ 0:04$/);
        expect(part(mounted.element, '.player').getAttribute('aria-label')).toBe('Briefing');
        expect(part(mounted.element, '.fullscreen')).toBeNull();
    });

    it('should seek with the slider and mute with the button, writing muted', async () => {
        // Arrange
        const mounted = mountComponent('mediaPlayer', { kind: 'audio', src: SILENCE });
        await until(() => mounted.store.get('$.app.duration') === 4);
        const seek = part<HTMLInputElement>(mounted.element, '.seek');

        // Act
        seek.value = '2';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => mounted.store.get('$.app.current') === 2);
        await userEvent.click(part(mounted.element, '.mute'));

        // Assert
        expect(part(mounted.element, '.time').textContent).toBe('0:02 / 0:04');
        expect(seek.getAttribute('aria-valuetext')).toBe('0:02 / 0:04');
        expect(mounted.store.get('$.app.muted')).toBe(true);
        expect(part<HTMLMediaElement>(mounted.element, 'audio').muted).toBe(true);
        expect(part(mounted.element, '.mute').getAttribute('aria-pressed')).toBe('true');
    });

    it('should draw a video with caption tracks, and show and hide the captions with the button', async () => {
        // Arrange
        const mounted = mountComponent('mediaPlayer', {
            src: SILENCE,
            tracks: { en: { src: CAPTIONS, srclang: 'en', _label: 'English' } }
        });
        const video = part<HTMLVideoElement>(mounted.element, 'video');
        await until(() => video.textTracks.length === 1);

        // Act
        await userEvent.click(part(mounted.element, '.captions'));
        const shown = video.textTracks[0]?.mode;
        await userEvent.click(part(mounted.element, '.captions'));

        // Assert
        expect(shown).toBe('showing');
        expect(video.textTracks[0]?.mode).toBe('hidden');
        expect(root(mounted.element).querySelectorAll('track')).toHaveLength(1);
        expect(part(mounted.element, '.fullscreen')).not.toBeNull();
    });

    it('should play nothing from a source that is not https or a path of the app', () => {
        // Arrange and Act
        const mounted = mountComponent('mediaPlayer', { src: 'data:image/png;base64,iVBOR' });

        // Assert
        expect(mounted.store.get('$.app.source')).toBe('');
        expect(part<HTMLVideoElement>(mounted.element, 'video').hasAttribute('src')).toBe(false);
        expect(part<HTMLButtonElement>(mounted.element, '.play').disabled).toBe(true);
    });

    it('should play a stored file at the URL the host gives, and play nothing without a host that gives one', async () => {
        // Arrange
        const asked: string[] = [];
        const fileUrl = (id: string): string | undefined => {
            asked.push(id);
            return id === CLIP.id ? SILENCE : undefined;
        };

        // Act
        const mounted = mountComponent('mediaPlayer', { kind: 'audio', file: CLIP, src: 'https://example.com/other.mp3' }, { hooks: { fileUrl } });
        await until(() => mounted.store.get('$.app.duration') === 4);
        const bare = mountComponent('mediaPlayer', { kind: 'audio', file: CLIP });

        // Assert
        expect(asked).toEqual([CLIP.id]);
        expect(mounted.store.get('$.app.source')).toBe(SILENCE);
        expect(bare.store.get('$.app.source')).toBe('');
        expect(part<HTMLButtonElement>(bare.element, '.play').disabled).toBe(true);
    });

    it('should ask for a failed file URL once more and play on, and show the failure when the URL stays the same', async () => {
        // Arrange
        let answer = MISSING;
        const fileUrl = (): string => answer;
        const mounted = mountComponent('mediaPlayer', { kind: 'audio', file: CLIP }, { hooks: { fileUrl } });
        const stuck = mountComponent('mediaPlayer', { kind: 'audio', file: CLIP }, { hooks: { fileUrl: () => MISSING } });

        // Act
        answer = SILENCE;
        await until(() => mounted.store.get('$.app.duration') === 4);
        await until(() => stuck.store.get('$.app.failed') === true);

        // Assert
        expect(mounted.store.get('$.app.source')).toBe(SILENCE);
        expect(mounted.store.get('$.app.failed')).toBe(false);
        expect(part(stuck.element, '.failed').textContent).toBe('This media cannot be played');
    });
});
