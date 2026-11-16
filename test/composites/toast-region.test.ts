import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

const check = (value: string): string[] =>
    validateDocument(
        {
            locale: 'en',
            app: { component: 'app', toasts: { component: 'toastRegion', messages: { saved: { tone: 'success', _text: 'Saved' } } } },
            screens: {
                home: {
                    root: {
                        component: 'panel',
                        children: { save: { component: 'button', _title: 'Save', on: { press: { command: 'show', target: '$.app.toasts', value } } } }
                    }
                }
            },
            start: 'home'
        },
        catalog
    ).errors.map((error) => error.code);

describe('toastRegion validation', () => {
    it('should accept a show value that names a message', () => {
        expect(check('saved')).toEqual([]);
    });

    it('should report a show value that names no message as SUI-ON-VALUE', () => {
        expect(check('missing')).toEqual(['SUI-ON-VALUE']);
    });
});
