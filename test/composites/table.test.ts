import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

const check = (app: Record<string, unknown>): string[] =>
    validateDocument({ locale: 'en', app: { component: 'table', ...app } }, catalog).errors.map((error) => error.code);

describe('table shape', () => {
    it('should accept auto, fr, px and % widths and every format', () => {
        // Act
        const codes = check({
            columns: {
                a: { _title: 'A', field: 'a', width: 'auto', format: 'number' },
                b: { _title: 'B', field: 'b', width: '2fr', format: 'percent' },
                c: { _title: 'C', field: 'c', width: '120px', format: 'currency', currency: 'EUR' },
                d: { _title: 'D', field: 'd.e', width: '20%', format: 'duration', align: 'end', sortable: true }
            }
        });

        // Assert
        expect(codes).toEqual([]);
    });

    it.each(['2em', 'calc(10px + 1fr)', '-1px', ''])('should report the width %j as SUI-STATE-INVALID', (width) => {
        // Act
        const codes = check({ columns: { a: { _title: 'A', field: 'a', width } } });

        // Assert
        expect(codes).toContain('SUI-STATE-INVALID');
    });

    it('should report an unknown format as SUI-STATE-INVALID', () => {
        // Act
        const codes = check({ columns: { a: { _title: 'A', field: 'a', format: 'date' } } });

        // Assert
        expect(codes).toContain('SUI-STATE-INVALID');
    });

    it('should accept a cell node whose button deletes its $row', () => {
        // Act
        const codes = check({
            columns: {
                remove: {
                    _title: 'Actions',
                    cell: { component: 'button', _title: 'Delete', on: { press: { command: 'delete', target: '$row' } } }
                }
            }
        });

        // Assert
        expect(codes).toEqual([]);
    });

    it('should report a $row target outside a cell node', () => {
        // Act
        const codes = check({ empty: { component: 'button', _title: 'Delete', on: { press: { command: 'delete', target: '$row' } } } });

        // Assert
        expect(codes.length).toBeGreaterThan(0);
    });
});
