import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

// A timing test: it runs on its own (`npm run test:perf`, files one at a time), not in the parallel browser run. Each
// card written on its own made drawing quadratic: 300 cards took 32 s, and now take about 1.3 s.

/** Statenet's card (magnetic/src/statenet/StatenetPage.ts): a card of linked texts and a + */
const CARD = {
    component: 'card',
    padding: 'sm',
    '<-corners': '$row.corners',
    '<-elevation': '$row.elevation',
    '<-selected': '$row.current',
    layout: { type: 'row', gap: 'md', align: 'center' },
    children: {
        body: {
            component: 'panel',
            padding: 'none',
            placement: { grow: 1 },
            layout: { type: 'column', gap: 'none' },
            children: {
                kind: { component: 'text', textRole: 'caption', tone: 'accent', caps: true, '<-_text': '$row.kind', '<-hidden': '$row.noKind' },
                label: { component: 'text', textRole: 'label', '<-_text': '$row.label', '<-muted': '$row.muted' },
                note: { component: 'text', textRole: 'caption', muted: true, '<-_text': '$row.note', '<-hidden': '$row.noNote' }
            }
        },
        add: { component: 'button', icon: 'plus', iconPosition: 'only', size: 'sm', variant: 'ghost', corners: 'pill', '<-_title': '$row.addLabel', '<-hidden': '$row.noAdd' }
    }
};

/** An owner's tree as Statenet draws it: 6 branches of 10 parts, each part with 4 fields: 300 cards */
function records(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [{ id: '$', parent: '', label: '$', kind: '', note: '', noKind: true, noNote: true, noAdd: true, addLabel: '', corners: 'pill', elevation: 'flat', current: false, muted: false, wrap: false }];
    for (const branch of ['apps', 'data', 'models', 'logic', 'themes', 'components']) {
        out.push({ id: `$.${branch}`, parent: '$', label: branch, kind: '', note: '', noKind: true, noNote: true, noAdd: false, addLabel: `Add to $.${branch}`, corners: 'pill', elevation: 'flat', current: false, muted: false, wrap: false });
        for (let part = 0; part < 10; part++) {
            const id = `$.${branch}.p${part}`;
            out.push({ id, parent: `$.${branch}`, label: `part-${part}`, kind: 'Model', note: 'Not used by this app', noKind: false, noNote: false, noAdd: false, addLabel: `Add to ${id}`, corners: 'rounded', elevation: 'raised', current: false, muted: false, wrap: false });
            for (const field of ['id', 'name', 'size', 'at']) {
                out.push({ id: `${id}.${field}`, parent: id, label: field, kind: 'Field', note: 'string', noKind: false, noNote: false, noAdd: true, addLabel: '', corners: 'rounded', elevation: 'flat', current: false, muted: false, wrap: true });
            }
        }
    }
    return out;
}

describe('treeDiagram of 300 cards', () => {
    afterEach(() => mountComponent.unmountAll());

    it('should draw and lay out 300 of Statenet\'s cards within 3,000 ms', async () => {
        // Arrange
        const nodes = records();
        const laidOut = (element: Element): Promise<void> =>
            new Promise((resolve) => element.addEventListener('layout', () => resolve(), { once: true }));

        // Act
        const started = performance.now();
        const mounted = mountComponent('treeDiagram', { twoSided: true, columns: 2, leafBlock: 420, card: CARD, '<-nodes': '$.data.nodes' }, { data: { nodes } });
        await laidOut(mounted.element);
        const elapsed = performance.now() - started;
        console.log(`treeDiagram: 300 cards laid out in ${Math.round(elapsed)} ms`);

        // Assert
        expect(mounted.element.shadowRoot?.querySelectorAll('.card[data-placed]').length).toBe(nodes.length);
        expect(elapsed).toBeLessThan(3000);
    });
});
