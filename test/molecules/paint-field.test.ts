import { describe, expect, it } from 'vitest';
import { validateDocument } from '@punyts/stateui-app/core';
import type { JsonValue } from '@punyts/stateui-app/core';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { PAINT_TOOLS } from '../../src/shared/paint/strokes.js';

const catalog = catalogJson as unknown as Catalog;

/** The errors of a document whose app is one paintField with these properties */
function check(properties: Record<string, JsonValue>): { code: string; statePath?: string }[] {
    const result = validateDocument({ locale: 'en', app: { component: 'paintField', ...properties } }, catalog);
    return result.errors.map((error) => ({ code: error.code, statePath: error.statePath }));
}

describe('paintField tools in the document check (G2.6b)', () => {
    it('should take every tool of the engine, in tools and as the current tool', () => {
        expect(check({ tools: [...PAINT_TOOLS] })).toEqual([]);
        for (const tool of PAINT_TOOLS) expect(check({ tools: [tool], tool })).toEqual([]);
    });

    it('should refuse a tools list naming a tool the engine lacks as SUI-STATE-INVALID', () => {
        expect(check({ tools: ['brush', 'spray'] })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.tools' }]);
        expect(check({ tools: ['brush', 3] })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.tools' }]);
        expect(check({ tool: 'spray' })).toEqual([{ code: 'SUI-STATE-INVALID', statePath: '$.app.tool' }]);
    });

    it('should list the same tools in the shape as the engine has', () => {
        const entry = catalog.components.find((component) => component.name === 'paintField');
        const shape = entry !== undefined && 'shape' in entry ? entry.shape : undefined;
        expect(shape?.properties.tools?.validators.eachOf).toEqual([...PAINT_TOOLS]);
        expect(shape?.properties.tool?.values).toEqual([...PAINT_TOOLS]);
        expect(shape?.properties.tools?.default).toEqual(['brush', 'eraser']);
    });
});
