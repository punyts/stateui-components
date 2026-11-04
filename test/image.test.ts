import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseShape, validateNode } from '@punyts/stateui-app/core';

const file = resolve(import.meta.dirname, '../components/atoms/image/image.state.json');
// The build passes library-relative paths with forward slashes; an absolute Windows path would not name the component
const parsed = parseShape(readFileSync(file, 'utf8'), 'components/atoms/image/image.state.json');
const shape = parsed.shape;
if (!shape) throw new Error(`image shape did not parse: ${JSON.stringify(parsed.errors)}`);

const PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const codes = (node: Record<string, unknown>): string[] =>
    validateNode(shape, node as never, '$.app').map((error) => error.code);

describe('image shape', () => {
    it('should accept a data image with an alt text', () => {
        // Act
        const result = codes({ component: 'image', src: PIXEL, _alt: 'A logo' });

        // Assert
        expect(result).toEqual([]);
    });

    it('should report SUI-STATE-CONDITION for an image with no _alt and no decorative', () => {
        // Act
        const result = codes({ component: 'image', src: PIXEL });

        // Assert
        expect(result).toEqual(['SUI-STATE-CONDITION']);
    });

    it('should accept an image with no _alt when it is decorative', () => {
        // Act
        const result = codes({ component: 'image', src: PIXEL, decorative: true });

        // Assert
        expect(result).toEqual([]);
    });

    it('should report SUI-STATE-CONDITION when decorative is false and _alt is missing', () => {
        // Act
        const result = codes({ component: 'image', decorative: false });

        // Assert
        expect(result).toEqual(['SUI-STATE-CONDITION']);
    });

    it.each(['http://example.com/a.png', 'https://example.com/a.png', '//example.com/a.png', 'javascript:alert(1)', '#top', 'images/a.png'])(
        'should report SUI-STATE-INVALID for the src %s',
        (src) => {
            // Act
            const result = codes({ component: 'image', src, _alt: 'x' });

            // Assert
            expect(result).toEqual(['SUI-STATE-INVALID']);
        }
    );

    it('should report SUI-STATE-INVALID for a value outside fit, ratio or radius', () => {
        // Act
        const result = codes({ component: 'image', _alt: 'x', fit: 'fill', ratio: '2:1', radius: 'xl' });

        // Assert
        expect(result).toEqual(['SUI-STATE-INVALID', 'SUI-STATE-INVALID', 'SUI-STATE-INVALID']);
    });
});
