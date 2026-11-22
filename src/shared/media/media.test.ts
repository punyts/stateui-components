import { captionTracks, formatTime, mediaSource } from './media.js';

describe('media', () => {
    it('should play https URLs and paths of the app and nothing else', () => {
        // Assert
        expect(mediaSource('https://example.com/talk.mp4')).toBe('https://example.com/talk.mp4');
        expect(mediaSource('/media/talk.mp4')).toBe('/media/talk.mp4');
        expect(mediaSource('media/talk.mp4')).toBe('media/talk.mp4');
        expect(mediaSource('data:audio/wav;base64,UklGR')).toBe('');
        expect(mediaSource('//example.com/talk.mp4')).toBe('');
        expect(mediaSource('https://user@example.com/talk.mp4')).toBe('');
        expect(mediaSource('http://example.com/talk.mp4')).toBe('');
        expect(mediaSource('data:text/html,<p>')).toBe('');
        expect(mediaSource('javascript:alert(1)')).toBe('');
        expect(mediaSource(42)).toBe('');
    });

    it('should keep caption tracks with a safe source and name each by its label, language or key', () => {
        // Act
        const tracks = captionTracks({
            en: { src: 'https://example.com/en.vtt', srclang: 'en', _label: 'English' },
            de: { src: '/captions/de.vtt', srclang: 'de' },
            bad: { src: 'http://example.com/x.vtt', srclang: 'fr' },
            bare: { src: 'https://example.com/x.vtt' }
        });

        // Assert
        expect(tracks).toEqual({
            en: { src: 'https://example.com/en.vtt', srclang: 'en', label: 'English' },
            de: { src: '/captions/de.vtt', srclang: 'de', label: 'de' },
            bare: { src: 'https://example.com/x.vtt', srclang: '', label: 'bare' }
        });
    });

    it('should write a time as minutes and seconds, with hours from an hour', () => {
        // Assert
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(65.9)).toBe('1:05');
        expect(formatTime(3725)).toBe('1:02:05');
        expect(formatTime(Number.NaN)).toBe('0:00');
        expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    });
});
