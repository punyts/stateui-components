import { describe, expect, it } from 'vitest';
import { instantOf, isTimeZone, isoInZone, offsetAt, offsetText, parseInstant, wallTimeOf } from './zone.js';

describe('time zones', () => {
    it('should know real zones and refuse made-up ones', () => {
        // Act and Assert
        expect(isTimeZone('Europe/Berlin')).toBe(true);
        expect(isTimeZone('UTC')).toBe(true);
        expect(isTimeZone('Mars/Olympus')).toBe(false);
        expect(isTimeZone('')).toBe(false);
    });

    it('should give the offset of a zone in winter and summer', () => {
        // Act and Assert
        expect(offsetAt(Date.UTC(2026, 0, 15, 12), 'Europe/Berlin')).toBe(60);
        expect(offsetAt(Date.UTC(2026, 6, 15, 12), 'Europe/Berlin')).toBe(120);
        expect(offsetAt(Date.UTC(2026, 6, 15, 12), 'America/New_York')).toBe(-240);
        expect(offsetText(-330)).toBe('-05:30');
        expect(offsetText(0)).toBe('+00:00');
    });

    it('should turn a wall clock in a zone into an instant and back', () => {
        // Act
        const instant = instantOf('2026-11-21T14:30', 'Europe/Berlin') as number;

        // Assert
        expect(new Date(instant).toISOString()).toBe('2026-11-21T13:30:00.000Z');
        expect(wallTimeOf(instant, 'Europe/Berlin')).toBe('2026-11-21T14:30');
        expect(isoInZone(instant, 'Europe/Berlin')).toBe('2026-11-21T14:30:00+01:00');
        expect(isoInZone(instant, 'Asia/Kolkata')).toBe('2026-11-21T19:00:00+05:30');
    });

    it('should move a wall time in a spring-forward gap forward and take the earlier of a repeated hour', () => {
        // Act
        const gap = instantOf('2026-03-29T02:30', 'Europe/Berlin') as number;
        const repeated = instantOf('2026-10-25T02:30', 'Europe/Berlin') as number;

        // Assert
        expect(wallTimeOf(gap, 'Europe/Berlin')).toBe('2026-03-29T03:30');
        expect(new Date(repeated).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    });

    it('should read only ISO date-times that carry an offset', () => {
        // Act and Assert
        expect(parseInstant('2026-11-21T14:30:00+01:00')).toBe(Date.UTC(2026, 10, 21, 13, 30));
        expect(parseInstant('2026-11-21T13:30Z')).toBe(Date.UTC(2026, 10, 21, 13, 30));
        expect(parseInstant('2026-11-21T14:30')).toBeUndefined();
        expect(parseInstant('soon')).toBeUndefined();
    });
});
