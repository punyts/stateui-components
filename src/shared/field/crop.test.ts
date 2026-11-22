import { clampZoom, cropRatio, cropRect, croppedName, croppedSize, croppedType } from './crop.js';

describe('crop', () => {
    it('should read the offered ratios and nothing else', () => {
        // Assert
        expect(cropRatio('1:1')).toBe(1);
        expect(cropRatio('16:9')).toBeCloseTo(16 / 9);
        expect(cropRatio('3:4')).toBe(0.75);
        expect(cropRatio('')).toBe(0);
        expect(cropRatio('5:1')).toBe(0);
        expect(cropRatio(1)).toBe(0);
    });

    it('should frame the largest rectangle of the ratio at zoom 1 and shrink it about the centre', () => {
        // Act
        const full = cropRect(400, 200, 1, 1, 200, 100);
        const zoomed = cropRect(400, 200, 1, 2, 200, 100);
        const tall = cropRect(400, 200, 0.5, 1, 0, 0);

        // Assert
        expect(full).toEqual({ x: 100, y: 0, width: 200, height: 200, centerX: 200, centerY: 100 });
        expect(zoomed).toEqual({ x: 150, y: 50, width: 100, height: 100, centerX: 200, centerY: 100 });
        expect(tall).toEqual({ x: 0, y: 0, width: 100, height: 200, centerX: 50, centerY: 100 });
    });

    it('should keep the frame inside the picture however far the centre is moved', () => {
        // Act
        const right = cropRect(400, 200, 1, 2, 1000, -50);
        const unknown = cropRect(400, 200, 1, Number.NaN, Number.NaN, Number.NaN);

        // Assert
        expect(right).toEqual({ x: 300, y: 0, width: 100, height: 100, centerX: 350, centerY: 50 });
        expect(unknown.width).toBe(200);
        expect(unknown.centerX).toBe(200);
        expect(clampZoom(9)).toBe(4);
        expect(clampZoom(0.2)).toBe(1);
    });

    it('should scale a large crop down to the longest edge and keep a small one', () => {
        // Assert
        expect(croppedSize({ width: 4000, height: 3000 })).toEqual({ width: 2048, height: 1536 });
        expect(croppedSize({ width: 120.4, height: 90.2 })).toEqual({ width: 120, height: 90 });
    });

    it('should keep PNG, JPEG and WebP, turn a GIF into a PNG and rename it', () => {
        // Assert
        expect(croppedType('image/jpeg')).toBe('image/jpeg');
        expect(croppedType('image/webp')).toBe('image/webp');
        expect(croppedType('image/gif')).toBe('image/png');
        expect(croppedName('me.jpg', 'image/jpeg', 'image/jpeg')).toBe('me.jpg');
        expect(croppedName('wave.gif', 'image/gif', 'image/png')).toBe('wave.png');
        expect(croppedName('wave', 'image/gif', 'image/png')).toBe('wave.png');
    });
});
