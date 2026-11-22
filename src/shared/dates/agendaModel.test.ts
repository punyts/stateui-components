import { describe, expect, it } from 'vitest';
import { buildAgenda, buildTimeline } from './agendaModel.js';
import { readEvents, toEvent } from './events.js';
import type { EventFields } from './events.js';

const fields: EventFields = { key: 'id', startField: 'start', endField: 'end', titleField: 'title', resourceField: 'room' };
const events = readEvents(
    {
        a: { id: 'a', title: 'Standup', start: '2026-03-10T09:30', end: '2026-03-10T10:00', room: 'north' },
        b: { id: 'b', title: 'Planning', start: '2026-03-10T09:45', end: '2026-03-10T11:00', room: 'north' },
        c: { id: 'c', title: 'Trip', start: '2026-03-10', end: '2026-03-11', room: 'south' },
        d: { id: 'd', title: 'Late', start: '2026-03-09T23:00', end: '2026-03-10T01:00', room: 'south' },
        e: { id: 'e', title: 'April', start: '2026-04-02' }
    },
    fields
);
const input = { focus: '2026-03-10', events, locale: 'en-US', today: '2026-03-11' };

describe('toEvent resource', () => {
    it('should read the resource from the resource field, empty when the field is absent or not set', () => {
        // Act
        const named = toEvent('a', { start: '2026-03-10', room: 7 }, fields, 0);
        const none = toEvent('a', { start: '2026-03-10' }, { ...fields, resourceField: undefined }, 0);

        // Assert
        expect(named?.resource).toBe('7');
        expect(none?.resource).toBe('');
    });
});

describe('buildAgenda', () => {
    it('should list only the days of the month that have records, all-day records first', () => {
        // Act
        const agenda = buildAgenda(input);

        // Assert
        expect(agenda.heading).toBe('March 2026');
        expect(agenda.days.map((day) => day.iso)).toEqual(['2026-03-09', '2026-03-10', '2026-03-11']);
        expect(agenda.days[1]?.records.map((record) => record.title)).toEqual(['Trip', 'Late', 'Standup', 'Planning']);
        expect(agenda.days[1]?.active).toBe(true);
        expect(agenda.days[2]?.today).toBe(true);
        expect(agenda.range).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    });

    it('should leave out the time of a record on a day after its first and of an all-day record', () => {
        // Act
        const day = buildAgenda(input).days[1];

        // Assert
        expect(day?.records[0]).toMatchObject({ time: '', label: 'Trip' });
        expect(day?.records[1]?.time).toBe('');
        expect(day?.records[2]?.time).toMatch(/^9:30\sAM – 10:00\sAM$/);
    });
});

describe('buildTimeline', () => {
    it('should give each resource a row and lanes to overlapping records', () => {
        // Act
        const timeline = buildTimeline({ ...input, resources: [{ key: 'north', label: 'North' }, { key: 'south', label: 'South' }] });

        // Assert
        expect(timeline.rows.map((row) => row.label)).toEqual(['North', 'South']);
        expect(timeline.rows[0]?.records.map((record) => [record.key, record.start, record.lane, record.lanes])).toEqual([
            ['a', 570, 0, 2],
            ['b', 585, 1, 2]
        ]);
        expect(timeline.rows[1]?.allDay).toEqual([{ key: 'c', title: 'Trip' }]);
        expect(timeline.hours).toHaveLength(24);
    });

    it('should clip a record that began the day before to midnight and leave out its time', () => {
        // Act
        const late = buildTimeline({ ...input, resources: [] }).rows[0]?.records.find((record) => record.key === 'd');

        // Assert
        expect(late).toMatchObject({ start: 0, span: 60, time: '' });
    });

    it('should take the rows from the resources the records name, in the order of the day, when none are given', () => {
        // Act
        const timeline = buildTimeline({ ...input, resources: [] });

        // Assert
        expect(timeline.rows.map((row) => row.key)).toEqual(['south', 'north']);
    });
});
