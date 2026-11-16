import type { PathCommand } from '@punyts/stateui-app/core';

/**
 * The calls a path is built with: the drawing methods `Path2D` and the 2D context share. The canvas renderer passes a
 * `Path2D`; a test passes a recorder
 */
export interface PathSink {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    closePath(): void;
}

/**
 * The centre form of an SVG arc from `from` to `to` (SVG 2, appendix B.2.4), for `ellipse`: centre, radii (scaled up
 * when too small to reach), x-axis rotation and start angle in radians, and the signed sweep. Undefined when a radius is
 * 0, which SVG draws as a straight line
 */
export function arcCenter(
    from: readonly [number, number],
    to: readonly [number, number],
    rxIn: number,
    ryIn: number,
    rotation: number,
    largeArc: boolean,
    sweep: boolean
): { cx: number; cy: number; rx: number; ry: number; phi: number; start: number; delta: number } | undefined {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0) return undefined;
    const phi = ((rotation % 360) * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (from[0] - to[0]) / 2;
    const dy = (from[1] - to[1]) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        const scale = Math.sqrt(lambda);
        rx *= scale;
        ry *= scale;
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let factor = denominator === 0 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
    if (largeArc === sweep) factor = -factor;
    const cxp = (factor * rx * y1) / ry;
    const cyp = (-factor * ry * x1) / rx;
    const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
    const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1 - cxp) / rx;
    const uy = (y1 - cyp) / ry;
    const vx = (-x1 - cxp) / rx;
    const vy = (-y1 - cyp) / ry;
    const start = angle(1, 0, ux, uy);
    let delta = angle(ux, uy, vx, vy);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    else if (sweep && delta < 0) delta += 2 * Math.PI;
    return { cx, cy, rx, ry, phi, start, delta };
}

/**
 * Builds a path from the parsed command list of `parsePathData` (never from the raw string) into `sink`: relative
 * commands made absolute, `H` and `V` as lines, `S` and `T` with their reflected control point, `A` as an `ellipse`
 * segment (a line when a radius is 0), `Z` back to the subpath's start. A path that does not start with a move starts
 * at (0, 0), as the geometry does
 */
export function buildPath(commands: readonly PathCommand[], sink: PathSink): void {
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let lastCubic: [number, number] | undefined;
    let lastQuad: [number, number] | undefined;
    let open = false;
    const begin = (): void => {
        if (open) return;
        sink.moveTo(x, y);
        open = true;
    };
    for (const command of commands) {
        const ox = command.relative ? x : 0;
        const oy = command.relative ? y : 0;
        let cubic: [number, number] | undefined;
        let quad: [number, number] | undefined;
        switch (command.type) {
            case 'M':
                x = ox + command.x;
                y = oy + command.y;
                startX = x;
                startY = y;
                sink.moveTo(x, y);
                open = true;
                break;
            case 'L':
            case 'H':
            case 'V':
                begin();
                if (command.type === 'L') {
                    x = ox + command.x;
                    y = oy + command.y;
                } else if (command.type === 'H') {
                    x = ox + command.x;
                } else {
                    y = oy + command.y;
                }
                sink.lineTo(x, y);
                break;
            case 'C':
            case 'S': {
                begin();
                const [c1x, c1y] = command.type === 'C' ? [ox + command.x1, oy + command.y1] : lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
                const c2: [number, number] = [ox + command.x2, oy + command.y2];
                x = ox + command.x;
                y = oy + command.y;
                sink.bezierCurveTo(c1x, c1y, c2[0], c2[1], x, y);
                cubic = c2;
                break;
            }
            case 'Q':
            case 'T': {
                begin();
                const c: [number, number] = command.type === 'Q' ? [ox + command.x1, oy + command.y1] : lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
                x = ox + command.x;
                y = oy + command.y;
                sink.quadraticCurveTo(c[0], c[1], x, y);
                quad = c;
                break;
            }
            case 'A': {
                begin();
                const to: [number, number] = [ox + command.x, oy + command.y];
                if (to[0] !== x || to[1] !== y) {
                    const arc = arcCenter([x, y], to, command.rx, command.ry, command.rotation, command.largeArc, command.sweep);
                    if (arc === undefined) sink.lineTo(to[0], to[1]);
                    else sink.ellipse(arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.start, arc.start + arc.delta, arc.delta < 0);
                }
                [x, y] = to;
                break;
            }
            case 'Z':
                if (open) sink.closePath();
                x = startX;
                y = startY;
                // The next drawing command starts a new subpath at the start of this one
                open = false;
                break;
        }
        lastCubic = cubic;
        lastQuad = quad;
    }
}
