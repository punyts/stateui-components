import { describe, expect, it } from 'vitest';
import { formatValue, toNumber } from '../src/shared/format/format.ts';

const NBSP = ' ';

describe('formatValue', () => {
    it('should format a number in en and de', () => {
        // Act
        const en = formatValue(1234.5, { format: 'number', locale: 'en' });
        const de = formatValue(1234.5, { format: 'number', locale: 'de' });

        // Assert
        expect(en).toBe('1,234.5');
        expect(de).toBe('1.234,5');
    });

    it('should format a percent from a 0 to 1 value in en and de', () => {
        // Act
        const en = formatValue(0.256, { format: 'percent', locale: 'en' });
        const de = formatValue(0.5, { format: 'percent', locale: 'de' });

        // Assert
        expect(en).toBe('25.6%');
        expect(de).toBe(`50${NBSP}%`);
    });

    it('should format a currency with its code in en and de', () => {
        // Act
        const en = formatValue(1234.5, { format: 'currency', currency: 'EUR', locale: 'en' });
        const de = formatValue(1234.5, { format: 'currency', currency: 'EUR', locale: 'de' });

        // Assert
        expect(en).toBe('€1,234.50');
        expect(de).toBe(`1.234,50${NBSP}€`);
    });

    it('should format a currency as a plain number when there is no code', () => {
        // Act
        const text = formatValue(12, { format: 'currency', locale: 'en' });

        // Assert
        expect(text).toBe('12');
    });

    it('should format a duration in seconds as m:ss and, from one hour, h:mm:ss', () => {
        // Act
        const minutes = formatValue(125, { format: 'duration', locale: 'en' });
        const hour = formatValue(3725, { format: 'duration', locale: 'de' });
        const rounded = formatValue(59.6, { format: 'duration', locale: 'en' });
        const zero = formatValue(0, { format: 'duration', locale: 'en' });

        // Assert
        expect(minutes).toBe('2:05');
        expect(hour).toBe('1:02:05');
        expect(rounded).toBe('1:00');
        expect(zero).toBe('0:00');
    });

    it('should write the sign of a change when signed', () => {
        // Act
        const up = formatValue(5, { format: 'number', locale: 'en', signed: true });
        const down = formatValue(-0.1, { format: 'percent', locale: 'en', signed: true });
        const zero = formatValue(0, { format: 'number', locale: 'en', signed: true });
        const time = formatValue(-90, { format: 'duration', locale: 'en', signed: true });
        const later = formatValue(90, { format: 'duration', locale: 'en', signed: true });

        // Assert
        expect(up).toBe('+5');
        expect(down).toBe('-10%');
        expect(zero).toBe('0');
        expect(time).toBe('-1:30');
        expect(later).toBe('+1:30');
    });

    it('should give an empty string for a value that is not a number', () => {
        // Assert
        expect(formatValue(undefined)).toBe('');
        expect(formatValue(null)).toBe('');
        expect(formatValue('')).toBe('');
        expect(formatValue('abc')).toBe('');
        expect(formatValue(Number.NaN)).toBe('');
    });

    it('should accept a numeric string', () => {
        // Assert
        expect(formatValue('1234', { format: 'number', locale: 'de' })).toBe('1.234');
    });

    it('should fall back to en for an unusable locale and to a number for an unknown format', () => {
        // Act
        const text = formatValue(1234.5, { format: 'bogus', locale: 'not a locale!' });

        // Assert
        expect(text).toBe('1,234.5');
    });

    it('should fall back to a plain number for a currency code Intl refuses', () => {
        // Act
        const text = formatValue(3, { format: 'currency', currency: 'EURO', locale: 'en' });

        // Assert
        expect(text).toBe('3');
    });
});

describe('toNumber', () => {
    it('should read numbers and numeric text only', () => {
        // Assert
        expect(toNumber(3)).toBe(3);
        expect(toNumber(' 4.5 ')).toBe(4.5);
        expect(toNumber(Infinity)).toBeUndefined();
        expect(toNumber(true)).toBeUndefined();
    });
});

describe('formatValue fractionDigits', () => {
    it('should drop the cents of a currency with zero digits', () => {
        // Act
        const en = formatValue(12345.67, { format: 'currency', currency: 'USD', locale: 'en', fractionDigits: 0 });
        const de = formatValue(12345.67, { format: 'currency', currency: 'EUR', locale: 'de', fractionDigits: 0 });

        // Assert
        expect(en).toBe('$12,346');
        expect(de).toBe(`12.346${NBSP}€`);
    });

    it('should keep the currency cents when no digits are given', () => {
        // Act
        const text = formatValue(12345.67, { format: 'currency', currency: 'USD', locale: 'en' });

        // Assert
        expect(text).toBe('$12,345.67');
    });

    it('should fix the digits of a number and a percent', () => {
        // Act
        const number = formatValue(1234.5, { format: 'number', locale: 'en', fractionDigits: 2 });
        const percent = formatValue(0.256, { format: 'percent', locale: 'en', fractionDigits: 0 });

        // Assert
        expect(number).toBe('1,234.50');
        expect(percent).toBe('26%');
    });

    it('should ignore the digits of a duration and an invalid count', () => {
        // Act
        const duration = formatValue(75, { format: 'duration', locale: 'en', fractionDigits: 2 });
        const invalid = formatValue(1234.5, { format: 'number', locale: 'en', fractionDigits: -1 });

        // Assert
        expect(duration).toBe('1:15');
        expect(invalid).toBe('1,234.5');
    });
});
