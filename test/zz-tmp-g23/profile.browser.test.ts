import { it } from 'vitest';
import { buildScene } from '../../src/shared/chart/chart.js';
import { formatOnce, readCategories, readValues } from '../../src/shared/chart/data.js';
import { interactiveMarks, sceneToTree } from '../../src/shared/chart/drawingTree.js';
import type { CanvasDrawingRenderer } from '../../src/shared/drawing/canvasRenderer.js';
import '../../src/shared/drawing/canvasRenderer.js';
import { createDrawingRenderer } from '../../src/shared/drawing/render.js';
import { formatValue } from '../../src/shared/format/format.js';

it('profile', async () => {
    const F = 'abcdefghij'.split('');
    const records = Array.from({ length: 5000 }, (_, at) => { const r: Record<string, unknown> = { x: at }; F.forEach((f, s) => (r[f] = Math.round(50 + 45 * Math.sin(at / 50 + s)))); return r; });
    for (let k = 0; k < 6; k++) {
        const host = document.createElement('div'); host.style.width = '960px'; host.style.height = '320px'; document.body.append(host);
        const r = createDrawingRenderer(host, { renderer: 'canvas', viewBox: { x: 0, y: 0, width: 960, height: 320 }, reducedMotion: () => false, readProperty: () => undefined, onEvent: () => undefined }) as CanvasDrawingRenderer;
        r.update([]); await r.drawn();
        const t0 = performance.now();
        const input = { type: 'line' as const, categories: readCategories(records, 'x'), series: F.map((f) => ({ key: f, label: f, values: readValues(records, f) })), stacked: false, width: 960, height: 320, format: formatOnce((v) => formatValue(v, { format: 'number' })), percent: String as never, hidden: new Set<string>(), texts: { total: '', category: '', value: '', share: '' } };
        const scene = buildScene(input); const t1 = performance.now();
        const { shapes } = sceneToTree(scene); const t2 = performance.now();
        const m = k % 2 === 0 ? interactiveMarks(shapes) : shapes; const t3 = performance.now();
        r.update(m); const t4 = performance.now();
        r.paint(); const t5 = performance.now();
        console.log(`${k % 2 === 0 ? "proxies" : "plain"} scene ${(t1 - t0) | 0} tree ${(t2 - t1) | 0} marks ${(t3 - t2) | 0} update ${(t4 - t3) | 0} paint ${(t5 - t4) | 0}`);
        r.dispose(); host.remove();
    }
}, 60000);
