import { describe, expect, it, vi } from 'vitest';
import { clampMove, createShapeDrag, dragAxes, dragTo, lockUnlinkedCopies, replaceShape, stepMove, withPosition } from './drag.js';
import type { ShapeEvent, ShapeMove } from './render.js';
import { bindRows } from './rows.js';
import type { ShapeKind, ShapeTree } from './tree.js';

const ROOT = '$.app.children.map.children';

const shape = (kind: ShapeKind, key: string, properties: ShapeTree['properties'], children: ShapeTree[] = [], path = `${ROOT}.${key}`): ShapeTree => ({
    kind,
    key,
    path,
    properties,
    children
});

/** A 10 by 10 square at (20, 30) that drags on both axes */
const square = shape('rect', 'a', { x: 20, y: 30, width: 10, height: 10, interactive: true, draggable: 'both' });

describe('dragAxes', () => {
    it('should give the axes of draggable for an interactive shape, and none for one that is not interactive or not draggable', () => {
        // Act
        const both = dragAxes(square);
        const x = dragAxes(withPosition({ ...square, properties: { ...square.properties, draggable: 'x' } }, {}));
        const y = dragAxes({ ...square, properties: { ...square.properties, draggable: 'y' } });
        const plain = dragAxes({ ...square, properties: { ...square.properties, interactive: false } });
        const fixed = dragAxes({ ...square, properties: { ...square.properties, draggable: null } });
        const hidden = dragAxes({ ...square, properties: { ...square.properties, hidden: true } });

        // Assert
        expect([both, x, y, plain, fixed, hidden]).toEqual([['x', 'y'], ['x'], ['y'], [], [], []]);
    });
});

describe('dragTo', () => {
    it('should move a shape by the pointer distance, on its own axes only', () => {
        // Arrange
        const onlyX = { ...square, properties: { ...square.properties, draggable: 'x' } };

        // Act
        const both = dragTo([square], square.path, { x: 20, y: 30 }, 5, -7);
        const x = dragTo([onlyX], square.path, { x: 20, y: 30 }, 5, -7);

        // Assert
        expect(both).toEqual({ x: 25, y: 23 });
        expect(x).toEqual({ x: 25 });
    });

    it("should take the pointer distance into the parent group's coordinates (scaled by 2 there, so half the units)", () => {
        // Arrange
        const circle = shape('circle', 'dot', { cx: 0, cy: 0, r: 2, interactive: true, draggable: 'both' }, [], `${ROOT}.g.children.dot`);
        const group = shape('drawGroup', 'g', { scale: 2, origin: [0, 0] }, [circle]);

        // Act
        const values = dragTo([group], circle.path, { x: 0, y: 0 }, 10, 4);

        // Assert
        expect(values).toEqual({ x: 5, y: 2 });
    });

    it('should give nothing for a shape that is not in the tree or not draggable', () => {
        // Act
        const missing = dragTo([square], `${ROOT}.nope`, { x: 0, y: 0 }, 1, 1);
        const fixed = dragTo([{ ...square, properties: { ...square.properties, draggable: null } }], square.path, { x: 0, y: 0 }, 1, 1);

        // Assert
        expect([missing, fixed]).toEqual([undefined, undefined]);
    });

    it("should keep the shape's bounds inside its bounds", () => {
        // Arrange
        const bounded = { ...square, properties: { ...square.properties, bounds: { x: 0, y: 0, width: 100, height: 50 } } };

        // Act
        const right = dragTo([bounded], square.path, { x: 20, y: 30 }, 500, 500);
        const left = dragTo([bounded], square.path, { x: 20, y: 30 }, -500, -500);
        const inside = dragTo([bounded], square.path, { x: 20, y: 30 }, 10, 5);

        // Assert
        expect(right).toEqual({ x: 90, y: 40 });
        expect(left).toEqual({ x: 0, y: 0 });
        expect(inside).toEqual({ x: 30, y: 35 });
    });
});

describe('clampMove', () => {
    it('should put a shape wider than its bounds at their start, and keep a circle (an offset kind) inside by its bounds', () => {
        // Arrange
        const wide = { ...square, properties: { ...square.properties, width: 200, bounds: { x: 5, y: 0, width: 100, height: 100 } } };
        const circle = shape('circle', 'c', { cx: 10, cy: 10, r: 5, interactive: true, draggable: 'both', bounds: { x: 0, y: 0, width: 50, height: 50 } });

        // Act
        const clampedWide = clampMove(wide, { x: 50 });
        const clampedCircle = clampMove(circle, { x: 100, y: -100 });

        // Assert
        expect(clampedWide).toEqual({ x: 5 });
        // The circle's own bounds are 5..15, so its offset may go from -5 to 35
        expect(clampedCircle).toEqual({ x: 35, y: -5 });
    });

    it('should give the values as they are without usable bounds', () => {
        // Act
        const values = clampMove({ ...square, properties: { ...square.properties, bounds: { x: 0, y: 0, width: -1, height: 2 } } }, { x: 999 });

        // Assert
        expect(values).toEqual({ x: 999 });
    });
});

describe('stepMove', () => {
    it('should move by step along the arrow key axis, ten times with Shift, and 1 without a step', () => {
        // Arrange
        const stepped = { ...square, properties: { ...square.properties, step: 2 } };

        // Act
        const moves = [
            stepMove(stepped, 'ArrowRight', false),
            stepMove(stepped, 'ArrowLeft', false),
            stepMove(stepped, 'ArrowUp', true),
            stepMove(square, 'ArrowDown', false)
        ];

        // Assert
        expect(moves).toEqual([{ x: 22 }, { x: 18 }, { y: 10 }, { y: 31 }]);
    });

    it('should give nothing for another key or an axis the shape does not move on, and clamp by bounds', () => {
        // Arrange
        const onlyX = { ...square, properties: { ...square.properties, draggable: 'x', bounds: { x: 0, y: 0, width: 31, height: 50 } } };

        // Act
        const up = stepMove(onlyX, 'ArrowUp', false);
        const enter = stepMove(onlyX, 'Enter', false);
        const right = stepMove(onlyX, 'ArrowRight', true);

        // Assert
        expect([up, enter, right]).toEqual([undefined, undefined, { x: 21 }]);
    });
});

describe('replaceShape', () => {
    it('should replace a shape inside a group and keep the shapes not on the way', () => {
        // Arrange
        const inner = shape('circle', 'dot', { r: 1 }, [], `${ROOT}.g.children.dot`);
        const other = shape('rect', 'b', { width: 1, height: 1 });
        const group = shape('drawGroup', 'g', {}, [inner]);
        const next = withPosition(inner, { x: 4 });

        // Act
        const tree = replaceShape([group, other], inner.path, next);

        // Assert
        expect(tree[0]?.children[0]).toBe(next);
        expect(tree[1]).toBe(other);
        expect(group.children[0]).toBe(inner);
        expect(replaceShape([other], inner.path, next)).toEqual([other]);
    });
});

describe('lockUnlinkedCopies', () => {
    it('should keep copies with $row-linked x and y draggable, and lock copies with a literal y, naming the repeat once', () => {
        // Arrange
        const records = { s1: { x: 1, y: 2 }, s2: { x: 3, y: 4 } };
        const linked = bindRows({ component: 'rect', width: 2, height: 2, interactive: true, draggable: 'both', '<-x': '$row.x', '<-y': '$row.y' }, records, {
            path: `${ROOT}.linked`,
            renderer: 'svg'
        });
        const literal = bindRows({ component: 'rect', width: 2, height: 2, y: 5, interactive: true, draggable: 'both', '<-x': '$row.x' }, records, {
            path: `${ROOT}.literal`,
            renderer: 'svg'
        });
        const onlyX = bindRows({ component: 'rect', width: 2, height: 2, y: 5, interactive: true, draggable: 'x', '<-x': '$row.x' }, records, {
            path: `${ROOT}.onlyX`,
            renderer: 'svg'
        });
        const tree = [
            shape('drawRepeat', 'linked', {}, [...linked.copies]),
            shape('drawRepeat', 'literal', {}, [...literal.copies]),
            shape('drawRepeat', 'onlyX', {}, [...onlyX.copies])
        ];

        // Act
        const { shapes, unlinked } = lockUnlinkedCopies(tree);

        // Assert
        expect(unlinked).toEqual([{ path: `${ROOT}.literal`, axis: 'y' }]);
        expect(shapes[0]).toBe(tree[0]);
        expect(shapes[2]).toBe(tree[2]);
        expect(shapes[1]?.children.map((copy) => copy.properties.draggable)).toEqual([undefined, undefined]);
        expect(shapes[1]?.children.map((copy) => dragAxes(copy))).toEqual([[], []]);
    });

    it('should give the same tree when nothing is locked', () => {
        // Arrange
        const tree = [square];

        // Act
        const result = lockUnlinkedCopies(tree);

        // Assert
        expect(result.shapes).toBe(tree);
        expect(result.unlinked).toEqual([]);
    });
});

describe('createShapeDrag', () => {
    /** A drag over a fake host: the pointer's client pixels are drawing units, the trees shown are kept */
    const setup = () => {
        const moves: ShapeMove[] = [];
        const events: ShapeEvent[] = [];
        const order: string[] = [];
        const shown: { tree: readonly ShapeTree[]; path: string }[] = [];
        const drag = createShapeDrag({
            options: {
                onMove: (move) => {
                    moves.push(move);
                    order.push('move');
                },
                onEvent: (event) => {
                    events.push(event);
                    order.push(event.name);
                }
            },
            toDrawing: (event) => ({ x: event.clientX, y: event.clientY }),
            show: (tree, path) => shown.push({ tree, path })
        });
        const listen = new EventTarget() as unknown as Element;
        const keys = new EventTarget();
        Object.defineProperty(listen, 'ownerDocument', { value: keys });
        const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn() } as unknown as Element;
        const pointer = (type: string, x: number, y: number): PointerEvent =>
            Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1, button: 0 }) as unknown as PointerEvent;
        return { drag, moves, events, order, shown, listen, keys, capture, pointer };
    };

    it('should show the moved shape on every move, write nothing until the release, then move once and raise dragEnd after it', () => {
        // Arrange
        const { drag, moves, order, events, shown, listen, capture, pointer } = setup();
        drag.apply([square]);

        // Act
        const started = drag.pointerDown(pointer('pointerdown', 25, 35), square, capture, listen);
        listen.dispatchEvent(pointer('pointermove', 26, 35));
        listen.dispatchEvent(pointer('pointermove', 35, 40));
        listen.dispatchEvent(pointer('pointermove', 45, 50));
        const duringDrag = moves.length;
        listen.dispatchEvent(pointer('pointerup', 45, 50));

        // Assert
        expect(started).toBe(true);
        expect(duringDrag).toBe(0);
        // The first move is within the threshold, so the shape is shown twice, then put back where the tree has it
        expect(shown.map(({ tree }) => [tree[0]?.properties.x, tree[0]?.properties.y])).toEqual([
            [30, 35],
            [40, 45],
            [20, 30]
        ]);
        expect(moves).toEqual([{ shape: square.path, key: 'a', x: 40, y: 45 }]);
        expect(order).toEqual(['move', 'dragEnd']);
        expect(events[0]).toMatchObject({ name: 'dragEnd', shape: square.path, x: 45, y: 50 });
        expect(drag.swallowClick()).toBe(true);
        expect(drag.swallowClick()).toBe(false);
    });

    it('should write nothing for a release within the threshold, which stays a press', () => {
        // Arrange
        const { drag, moves, events, listen, capture, pointer } = setup();
        drag.apply([square]);

        // Act
        drag.pointerDown(pointer('pointerdown', 25, 35), square, capture, listen);
        listen.dispatchEvent(pointer('pointermove', 26, 36));
        listen.dispatchEvent(pointer('pointerup', 26, 36));

        // Assert
        expect(moves).toEqual([]);
        expect(events).toEqual([]);
        expect(drag.swallowClick()).toBe(false);
    });

    it('should put the shape back and write nothing for Escape or a pointer cancel', () => {
        // Arrange
        const { drag, moves, events, shown, listen, keys, capture, pointer } = setup();
        drag.apply([square]);

        // Act: Escape during a drag, then the release
        drag.pointerDown(pointer('pointerdown', 25, 35), square, capture, listen);
        listen.dispatchEvent(pointer('pointermove', 45, 35));
        keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
        listen.dispatchEvent(pointer('pointermove', 55, 35));
        listen.dispatchEvent(pointer('pointerup', 55, 35));
        const afterEscape = shown.map(({ tree }) => tree[0]?.properties.x);
        // A pointer cancel during another drag
        drag.pointerDown(pointer('pointerdown', 25, 35), square, capture, listen);
        listen.dispatchEvent(pointer('pointermove', 45, 35));
        listen.dispatchEvent(pointer('pointercancel', 45, 35));

        // Assert
        expect(afterEscape).toEqual([40, 20]);
        expect(shown.at(-1)?.tree[0]?.properties.x).toBe(20);
        expect(moves).toEqual([]);
        expect(events).toEqual([]);
    });

    it('should keep a drag on a new base tree, and end it with no write when its shape is gone', () => {
        // Arrange
        const { drag, moves, listen, capture, pointer } = setup();
        drag.apply([square]);
        drag.pointerDown(pointer('pointerdown', 25, 35), square, capture, listen);
        listen.dispatchEvent(pointer('pointermove', 45, 35));

        // Act
        const kept = drag.apply([{ ...square, properties: { ...square.properties, fill: '#000' } }]);
        const gone = drag.apply([]);
        listen.dispatchEvent(pointer('pointerup', 45, 35));

        // Assert
        expect([kept[0]?.properties.x, kept[0]?.properties.fill]).toEqual([40, '#000']);
        expect(gone).toEqual([]);
        expect(moves).toEqual([]);
    });

    it('should move by an arrow key at once and raise dragEnd at the moved centre, and ignore other keys', () => {
        // Arrange
        const { drag, moves, order, events } = setup();
        drag.apply([square]);
        const key = (name: string, shiftKey = false): KeyboardEvent => Object.assign(new Event('keydown', { cancelable: true }), { key: name, shiftKey }) as unknown as KeyboardEvent;

        // Act
        const right = drag.key(key('ArrowRight', true), square);
        const enter = drag.key(key('Enter'), square);

        // Assert
        expect([right, enter]).toEqual([true, false]);
        expect(moves).toEqual([{ shape: square.path, key: 'a', x: 30 }]);
        expect(order).toEqual(['move', 'dragEnd']);
        expect(events[0]).toMatchObject({ name: 'dragEnd', x: 35, y: 35 });
    });

    it('should start no drag without onMove, for another button, or for a shape that is not draggable', () => {
        // Arrange
        const { listen, capture, pointer } = setup();
        const noMove = createShapeDrag({ options: { onEvent: () => undefined }, toDrawing: () => ({ x: 0, y: 0 }), show: () => undefined });
        const { drag } = setup();
        const right = Object.assign(pointer('pointerdown', 0, 0), { button: 2 });

        // Act
        const results = [
            noMove.pointerDown(pointer('pointerdown', 0, 0), square, capture, listen),
            drag.pointerDown(right, square, capture, listen),
            drag.pointerDown(pointer('pointerdown', 0, 0), { ...square, properties: { ...square.properties, draggable: null } }, capture, listen)
        ];

        // Assert
        expect(results).toEqual([false, false, false]);
    });
});
