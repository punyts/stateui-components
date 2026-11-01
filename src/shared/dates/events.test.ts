import { describe, expect, it } from 'vitest';
import { MIN_SPAN, eventsOnDay, layoutOverlaps, readEvents, segmentOn, toEvent } from './events.js';
import type { CalendarEvent, EventFields } from './events.js';
import { dayOf } from './isoDate.js';

const fields: EventFields = { key: 'id', startField: 'start', endField: 'end', titleField: 'title' };
const day = (iso: string): number => dayOf(iso) as number;
const event = (record: Record<string, unknown>, position = 0): CalendarEvent => toEvent(String(record['id']), record, fields, position) as CalendarEvent;

describe('toEvent', () => {
    it('should make an all-day record cover its days, both ends included', () => {
        // Act
        const found = event({ id: 'a', title: 'Trip', start: '2026-03-10', end: '2026-03-12' });

        // Assert
        expect(found).toMatchObject({ allDay: true, firstDay: day('2026-03-10'), lastDay: day('2026-03-12') });
    });

    it('should make a record with no end, or an end before the start, last one day', () => {
        // Assert
        expect(event({ id: 'a', start: '2026-03-10' }).lastDay).toBe(day('2026-03-10'));
        expect(event({ id: 'a', start: '2026-03-10', end: '2026-03-01' }).lastDay).toBe(day('2026-03-10'));
    });

    it('should keep the minutes of a timed record and end it on the day before when it ends at midnight', () => {
        // Act
        const found = event({ id: 'a', start: '2026-03-10T22:00', end: '2026-03-11T00:00' });

        // Assert
        expect(found).toMatchObject({ allDay: false, startMinute: 1320, endMinute: 1440, firstDay: day('2026-03-10'), lastDay: day('2026-03-10') });
    });

    it('should run a record that crosses midnight over both days', () => {
        // Act
        const found = event({ id: 'a', start: '2026-03-10T22:00', end: '2026-03-11T02:30' });

        // Assert
        expect(found.lastDay).toBe(day('2026-03-11'));
        expect(segmentOn(found, day('2026-03-10'))).toMatchObject({ start: 1320, span: 120 });
        expect(segmentOn(found, day('2026-03-11'))).toMatchObject({ start: 0, span: 150 });
        expect(segmentOn(found, day('2026-03-12'))).toBeUndefined();
    });

    it('should leave out a record with no readable start', () => {
        // Assert
        expect(toEvent('a', { start: 'soon' }, fields, 0)).toBeUndefined();
    });
});

describe('readEvents', () => {
    it('should read an array by its key field and a keyed map by its keys', () => {
        // Act
        const fromArray = readEvents([{ id: 'a', start: '2026-03-10' }, { id: '', start: '2026-03-10' }, { id: 'b', start: 'x' }, null], fields);
        const fromMap = readEvents({ x: { start: '2026-03-10', title: 'X' }, y: { start: 'bad' } }, fields);

        // Assert
        expect(fromArray.map((found) => found.key)).toEqual(['a']);
        expect(fromMap.map((found) => [found.key, found.title])).toEqual([['x', 'X']]);
        expect(readEvents(undefined, fields)).toEqual([]);
    });

    it('should ignore the end when there is no end field', () => {
        // Act
        const found = readEvents([{ id: 'a', start: '2026-03-10', end: '2026-03-14' }], { ...fields, endField: '' });

        // Assert
        expect(found[0]?.lastDay).toBe(day('2026-03-10'));
    });
});

describe('eventsOnDay', () => {
    it('should list all-day records first, then by start, then in data order', () => {
        // Arrange
        const events = [
            event({ id: 'late', start: '2026-03-10T15:00' }, 0),
            event({ id: 'early', start: '2026-03-10T08:00' }, 1),
            event({ id: 'whole', start: '2026-03-09', end: '2026-03-10' }, 2),
            event({ id: 'other', start: '2026-03-11' }, 3)
        ];

        // Assert
        expect(eventsOnDay(events, day('2026-03-10')).map((found) => found.key)).toEqual(['whole', 'early', 'late']);
    });
});

describe('layoutOverlaps', () => {
    const at = (id: string, start: string, end: string, position = 0) => segmentOn(event({ id, start: `2026-03-10T${start}`, end: `2026-03-10T${end}` }, position), day('2026-03-10')) as NonNullable<ReturnType<typeof segmentOn>>;
    const columnsOf = (segments: ReturnType<typeof at>[]): Record<string, string> =>
        Object.fromEntries(layoutOverlaps(segments).map((placed) => [placed.event.key, `${placed.column}/${placed.columns}`]));

    it('should give records that do not overlap the whole width', () => {
        // Assert
        expect(columnsOf([at('a', '09:00', '10:00'), at('b', '10:00', '11:00')])).toEqual({ a: '0/1', b: '0/1' });
    });

    it('should put records that overlap side by side', () => {
        // Assert
        expect(columnsOf([at('a', '09:00', '11:00'), at('b', '10:00', '12:00'), at('c', '10:30', '11:30')])).toEqual({ a: '0/3', b: '1/3', c: '2/3' });
    });

    it('should reuse a column that is free and count each group on its own', () => {
        // Assert
        expect(columnsOf([at('a', '09:00', '12:00'), at('b', '09:30', '10:00'), at('c', '10:00', '11:00'), at('d', '14:00', '15:00')])).toEqual({
            a: '0/2',
            b: '1/2',
            c: '1/2',
            d: '0/1'
        });
    });

    it('should treat a record shorter than the minimum as that long', () => {
        // Assert
        expect(MIN_SPAN).toBe(15);
        expect(columnsOf([at('a', '09:00', '09:00'), at('b', '09:10', '10:00')])).toEqual({ a: '0/2', b: '1/2' });
    });
});
