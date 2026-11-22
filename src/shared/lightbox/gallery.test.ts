import { galleryImages, galleryIndex, galleryStep, isSafeImageSrc, zoomStep } from './gallery.js';

describe('gallery', () => {
    it('should read a keyed map in its order and leave out a picture whose src is not https or picture data', () => {
        // Arrange
        const images = {
            dock: { src: 'https://example.com/dock.jpg', _alt: 'The dock', _caption: 'Morning' },
            bad: { src: 'javascript:alert(1)', _alt: 'No' },
            svg: { src: 'data:image/svg+xml,<svg/>' },
            pier: { src: 'data:image/png;base64,iVBOR', _alt: 'The pier' }
        };

        // Act
        const result = galleryImages(images);

        // Assert
        expect(result).toEqual([
            { key: 'dock', src: 'https://example.com/dock.jpg', alt: 'The dock', caption: 'Morning' },
            { key: 'pier', src: 'data:image/png;base64,iVBOR', alt: 'The pier', caption: '' }
        ]);
        expect(isSafeImageSrc('http://example.com/a.jpg')).toBe(false);
    });

    it('should read a data array, keyed by id or position', () => {
        // Act
        const result = galleryImages([{ id: 'a1', src: 'https://example.com/a.jpg', alt: 'A', caption: 'First' }, { src: 'https://example.com/b.jpg' }, 'nope']);

        // Assert
        expect(result.map((image) => [image.key, image.alt, image.caption])).toEqual([
            ['a1', 'A', 'First'],
            ['1', '', '']
        ]);
    });

    it('should find the active picture, fall back to the first, and step with or without wrapping', () => {
        // Arrange
        const images = galleryImages({ a: { src: 'https://e.com/a' }, b: { src: 'https://e.com/b' }, c: { src: 'https://e.com/c' } });

        // Assert
        expect(galleryIndex(images, 'b')).toBe(1);
        expect(galleryIndex(images, 'zz')).toBe(0);
        expect(galleryIndex([], 'a')).toBe(-1);
        expect(galleryStep(images, 2, 1, false)).toBeUndefined();
        expect(galleryStep(images, 2, 1, true)).toBe('a');
        expect(galleryStep(images, 0, -1, true)).toBe('c');
        expect(galleryStep(images, 0, 1, false)).toBe('b');
    });

    it('should zoom in and out through the steps and stay within them', () => {
        // Assert
        expect(zoomStep(1, 1)).toBe(1.5);
        expect(zoomStep(1.5, 1)).toBe(2);
        expect(zoomStep(4, 1)).toBe(4);
        expect(zoomStep(2, -1)).toBe(1.5);
        expect(zoomStep(1, -1)).toBe(1);
        expect(zoomStep(2.5, -1)).toBe(2);
        expect(zoomStep(2.5, 1)).toBe(3);
    });
});
