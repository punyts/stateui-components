import { describe, expect, it } from 'vitest';
import { formatNumberInput, parseNumberInput } from './numberInput.js';

const NBSP = ' ';

describe('parseNumberInput', () => {
    it.each([
        ['1.234,5', 'de', 1234.5],
        ['1,234.5', 'en', 1234.5],
        ['1234,5', 'de', 1234.5],
        ['1234.5', 'en', 1234.5],
        ['-1.234,5', 'de', -1234.5],
        ['-1,234.5', 'en', -1234.5],
        ['−1.5', 'en', -1.5],
        ['+7', 'en', 7],
        [',5', 'de', 0.5],
        ['.5', 'en', 0.5],
        ['5.', 'en', 5],
        [' 12 345,6 ', 'de', 12345.6],
        ['1.234.567', 'de', 1234567]
    ] as const)('should read %s in %s as %d', (text, locale, expected) => {
        // Act
        const result = parseNumberInput(text, { locale });

        // Assert
        expect(result).toBe(expected);
    });

    it.each([
        ['', 'en'],
        ['abc', 'en'],
        ['12abc', 'en'],
        ['1.5', 'de'],
        ['1,23', 'en'],
        ['1,5', 'en'],
        ['--5', 'en'],
        ['-', 'en'],
        ['1.2.3', 'en'],
        ['5%', 'en'],
        ['1e3', 'en']
    ] as const)('should not read %s in %s', (text, locale) => {
        // Act
        const result = parseNumberInput(text, { locale });

        // Assert
        expect(result).toBeUndefined();
    });

    it('should read a percent entry as a fraction, with or without the sign', () => {
        // Act
        const results = [
            parseNumberInput('50', { locale: 'en', format: 'percent' }),
            parseNumberInput('12.3%', { locale: 'en', format: 'percent' }),
            parseNumberInput(`12,5${NBSP}%`, { locale: 'de', format: 'percent' }),
            parseNumberInput('7', { locale: 'en', format: 'percent' })
        ];

        // Assert
        expect(results).toEqual([0.5, 0.123, 0.125, 0.07]);
    });

    it('should read a currency entry with or without its symbol or code', () => {
        // Act
        const results = [
            parseNumberInput('€1,234.50', { locale: 'en', format: 'currency', currency: 'EUR' }),
            parseNumberInput(`1.234,50${NBSP}€`, { locale: 'de', format: 'currency', currency: 'EUR' }),
            parseNumberInput('1.234,50', { locale: 'de', format: 'currency', currency: 'EUR' }),
            parseNumberInput('EUR 12', { locale: 'en', format: 'currency', currency: 'EUR' }),
            parseNumberInput('-$5.25', { locale: 'en', format: 'currency', currency: 'USD' })
        ];

        // Assert
        expect(results).toEqual([1234.5, 1234.5, 1234.5, 12, -5.25]);
    });

    it('should refuse a currency symbol when the format is a plain number', () => {
        // Act
        const result = parseNumberInput('€5', { locale: 'en' });

        // Assert
        expect(result).toBeUndefined();
    });

    it('should fall back to en for an unusable locale', () => {
        // Act
        const result = parseNumberInput('1,234.5', { locale: 'not a locale' });

        // Assert
        expect(result).toBe(1234.5);
    });

    it('should read digits the locale writes with other characters', () => {
        // Act
        const result = parseNumberInput('١٢٣', { locale: 'ar-EG' });

        // Assert
        expect(result).toBe(123);
    });
});

describe('formatNumberInput', () => {
    it('should show a number the way the locale writes it', () => {
        // Act
        const en = formatNumberInput(1234.5, { locale: 'en' });
        const de = formatNumberInput(1234.5, { locale: 'de' });

        // Assert
        expect([en, de]).toEqual(['1,234.5', '1.234,5']);
    });

    it('should keep the digits of a value up to ten decimals', () => {
        // Act
        const result = formatNumberInput(0.123456789, { locale: 'en' });

        // Assert
        expect(result).toBe('0.123456789');
    });

    it('should show a percent from a fraction and a currency with its symbol', () => {
        // Act
        const percent = formatNumberInput(0.125, { locale: 'de', format: 'percent' });
        const currency = formatNumberInput(1234.5, { locale: 'en', format: 'currency', currency: 'EUR' });
        const plain = formatNumberInput(1234.5, { locale: 'en', format: 'currency' });

        // Assert
        expect(percent).toBe(`12,5${NBSP}%`);
        expect(currency).toBe('€1,234.50');
        expect(plain).toBe('1,234.5');
    });

    it('should give an empty string for a value that is not a finite number', () => {
        // Act
        const results = ['', 'x', null, undefined, Number.NaN, Infinity].map((value) => formatNumberInput(value, { locale: 'en' }));

        // Assert
        expect(new Set(results)).toEqual(new Set(['']));
    });

    it('should read back what it shows', () => {
        // Arrange
        const cases = [
            [1234.5, { locale: 'de' }],
            [-0.25, { locale: 'en', format: 'percent' }],
            [9876.54, { locale: 'de', format: 'currency', currency: 'EUR' }],
            [1234567.891, { locale: 'en' }]
        ] as const;

        // Act and Assert
        for (const [value, options] of cases) expect(parseNumberInput(formatNumberInput(value, options), options)).toBe(value);
    });
});
