import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { JsonValue } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';

const catalog = catalogJson as unknown as Catalog;

const ID = '6a1f2c3d-4e5b-4a7c-8d9e-0f1a2b3c4d5e';

/** The errors of a document whose app is one paintField with this `background` */
function check(background: JsonValue): { code: string; statePath?: string }[] {
    const result = validateDocument({ locale: 'en', app: { component: 'paintField', background } }, catalog);
    return result.errors.map((error) => ({ code: error.code, statePath: error.statePath }));
}

describe('paintField background in the document check (G2.9b)', () => {
    it('should take a colour, a token, or the reference of an image file', () => {
        expect(check('#1976d2')).toEqual([]);
        expect(check('{color.surface.base}')).toEqual([]);
        for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(check({ id: ID, name: 'photo', size: 2048, type })).toEqual([]);
    });

    it('should refuse a file the store does not hold as an image as SUI-STATE-INVALID', () => {
        expect(check({ id: ID, name: 'notes.txt', size: 12, type: 'text/plain' })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.background' }]);
        expect(check({ id: ID, name: 'plan.pdf', size: 12, type: 'application/pdf' })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.background' }]);
    });

    it('should refuse a value that is neither a colour nor a file reference', () => {
        expect(check('not a colour')).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.background' }]);
        expect(check({ id: 'not-a-uuid', name: 'a.png', size: 1, type: 'image/png' })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.background' }]);
        expect(check('data:image/png;base64,iVBORw0KGgo=')).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.background' }]);
    });
});
