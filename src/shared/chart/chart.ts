import { buildDonut } from './donut.js';
import { buildCartesian } from './geometry.js';
import { buildHeatmap, buildRadar, buildScatter } from './polar.js';
import type { ChartInput, Scene } from './scene.js';

/** The scene of a chart of any type: bar, line and area share a category axis, the others have their own layout */
export function buildScene(input: ChartInput): Scene {
    switch (input.type) {
        case 'donut':
            return buildDonut(input);
        case 'scatter':
            return buildScatter(input);
        case 'radar':
            return buildRadar(input);
        case 'heatmap':
            return buildHeatmap(input);
        default:
            return buildCartesian(input);
    }
}
