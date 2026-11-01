import { buildDonut } from './donut.js';
import { buildCartesian } from './geometry.js';
import type { ChartInput, Scene } from './scene.js';

/** The scene of a chart of any type: a donut has its own layout, the others share axes */
export function buildScene(input: ChartInput): Scene {
    return input.type === 'donut' ? buildDonut(input) : buildCartesian(input);
}
