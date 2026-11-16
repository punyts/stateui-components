import type { JsonValue } from '@punyts/stateui-app/core';
import type { FrameTask, Scheduler } from './scheduler.js';
import type { ShapeTree } from './tree.js';

/**
 * The named animations of `animate` (G1.8b of the graphics epic 1), played by the renderer and never written to the
 * store. The `motion` partial (`src/shared/shape/motion.json`) lists the same names, so any other is `SUI-STATE-INVALID`
 */
export const ANIMATION_NAMES = ['spin', 'pulse', 'fade', 'blink'] as const;

export type AnimationName = (typeof ANIMATION_NAMES)[number];

/** The length of one cycle in milliseconds when `animate` gives no `duration` */
export const DEFAULT_ANIMATION_DURATION = 1000;

/** How far `pulse` grows a shape at the middle of a cycle (a factor of the shape's own `scale`) */
export const PULSE_GROWTH = 0.15;

/** How far `fade` dims a shape at the middle of a cycle (a factor of the shape's own `opacity`) */
export const FADE_LOW = 0.3;

/** A shape's `animate`, read and checked */
export interface Animation {
    readonly name: AnimationName;
    /** One cycle in milliseconds */
    readonly duration: number;
    /** True (the default) to repeat the cycle until the shape loses its `animate`; false to play it once and rest */
    readonly loop: boolean;
    /** Milliseconds before the first cycle starts, during which the shape rests */
    readonly delay: number;
}

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value);

const nonNegative = (value: JsonValue | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);

/** The animation of an `animate` value; undefined when there is none or its name is not one of `ANIMATION_NAMES` */
export function readAnimation(value: JsonValue | undefined): Animation | undefined {
    if (!isRecord(value)) return undefined;
    const name = value.name;
    if (typeof name !== 'string' || !(ANIMATION_NAMES as readonly string[]).includes(name)) return undefined;
    return {
        name: name as AnimationName,
        duration: nonNegative(value.duration, DEFAULT_ANIMATION_DURATION),
        loop: value.loop !== false,
        delay: nonNegative(value.delay, 0)
    };
}

const numberOr = (value: JsonValue | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * The properties an animation gives a shape at progress `p` of a cycle (0 to 1), over the shape's own values: `spin`
 * turns `rotate` a full turn, `pulse` grows `scale` by `PULSE_GROWTH` and back, `fade` dims `opacity` to `FADE_LOW`
 * and back, and `blink` shows the shape in the first half of the cycle and hides it (`opacity` 0) in the second. Each
 * is at the shape's resting values at 0 and 1, and turns and grows about the shape's `origin` (its centre by default)
 */
export function animatedProperties(shape: ShapeTree, animation: Animation, p: number): Record<string, JsonValue> {
    const wave = Math.sin(Math.PI * p);
    switch (animation.name) {
        case 'spin':
            return { rotate: numberOr(shape.properties.rotate, 0) + 360 * p };
        case 'pulse': {
            const factor = 1 + PULSE_GROWTH * wave;
            const scale = shape.properties.scale;
            if (Array.isArray(scale) && scale.length === 2) return { scale: scale.map((part) => numberOr(part, 1) * factor) };
            return { scale: numberOr(scale, 1) * factor };
        }
        case 'fade':
            return { opacity: numberOr(shape.properties.opacity, 1) * (1 - (1 - FADE_LOW) * wave) };
        case 'blink':
            return { opacity: p < 0.5 ? numberOr(shape.properties.opacity, 1) : 0 };
    }
}

/** The animations of a scene */
export interface Animations {
    /**
     * Takes the tree of an update: a shape that gains `animate`, or whose `animate` changed, starts its animation in the
     * next frame; one that lost it (or is hidden or gone) stops. Gives the tree with each animation where it is now (the
     * resting tree while motion is reduced or nothing animates)
     */
    follow(tree: readonly ShapeTree[]): readonly ShapeTree[];
    /** The tree (the one `follow` took, tweened) with each animation where it is now; the same tree when none plays */
    decorate(tree: readonly ShapeTree[]): readonly ShapeTree[];
    /** The paths of the animated shapes, which a frame redraws */
    paths(): IterableIterator<string>;
    /** Stops every animation */
    dispose(): void;
}

interface Playing {
    readonly animation: Animation;
    readonly signature: string;
    /** The scheduler time the animation started at, set in its first frame; undefined until then */
    start: number | undefined;
}

/**
 * Follows the shapes with `animate` and plays them through one frame task of the scheduler (`request`), which asks for
 * frames only while an animation plays: none when no shape animates, none while motion is reduced (the scheduler runs
 * no tasks then, and every shape shows its resting values), and none after an animation with `loop: false` ended.
 * Turning reduced motion off starts each animation again from its beginning. Nothing is written to the store: the
 * values exist only in the tree the renderer draws
 */
export function createAnimations(scheduler: Scheduler): Animations {
    const playing = new Map<string, Playing>();
    let cancel: (() => void) | undefined;
    let disposed = false;

    /** True while an animation has frames left at `now` (its delay or a cycle to play, or it has not started) */
    const running = (entry: Playing, now: number): boolean =>
        entry.start === undefined || entry.animation.loop || now - entry.start - entry.animation.delay < entry.animation.duration;

    const task: FrameTask = (now) => {
        let any = false;
        for (const entry of playing.values()) {
            entry.start ??= now;
            if (running(entry, now)) any = true;
        }
        if (!any) cancel = undefined;
        return any;
    };

    const ensureTask = (): void => {
        if (disposed || cancel !== undefined) return;
        const now = scheduler.now();
        if ([...playing.values()].some((entry) => running(entry, now))) cancel = scheduler.request(task);
    };

    const collect = (shapes: readonly ShapeTree[], seen: Set<string>): void => {
        for (const shape of shapes) {
            if (shape.properties.hidden === true) continue;
            const animation = readAnimation(shape.properties.animate);
            if (animation !== undefined) {
                const signature = JSON.stringify(animation);
                seen.add(shape.path);
                if (playing.get(shape.path)?.signature !== signature) playing.set(shape.path, { animation, signature, start: undefined });
            }
            collect(shape.children, seen);
            if (shape.clip !== undefined) collect([shape.clip], seen);
        }
    };

    /** The progress in the cycle of an animation at `now`, or undefined when the shape rests */
    const progress = (entry: Playing, now: number): number | undefined => {
        if (entry.start === undefined) return undefined;
        const { duration, delay, loop } = entry.animation;
        const elapsed = now - entry.start - delay;
        if (elapsed < 0 || duration <= 0) return undefined;
        if (!loop && elapsed >= duration) return undefined;
        return (elapsed % duration) / duration;
    };

    const decorateShapes = (shapes: readonly ShapeTree[], now: number): readonly ShapeTree[] => {
        let changed = false;
        const result = shapes.map((shape) => {
            const entry = playing.get(shape.path);
            const p = entry === undefined ? undefined : progress(entry, now);
            const properties = p === undefined ? shape.properties : { ...shape.properties, ...animatedProperties(shape, entry!.animation, p) };
            const children = shape.children.length === 0 ? shape.children : decorateShapes(shape.children, now);
            const clip = shape.clip === undefined ? undefined : decorateShapes([shape.clip], now)[0];
            if (properties === shape.properties && children === shape.children && clip === shape.clip) return shape;
            changed = true;
            const next: ShapeTree = { ...shape, properties, children };
            return clip === undefined ? next : { ...next, clip };
        });
        return changed ? result : shapes;
    };

    const decorate = (tree: readonly ShapeTree[]): readonly ShapeTree[] =>
        disposed || playing.size === 0 || scheduler.reduced ? tree : decorateShapes(tree, scheduler.now());

    return {
        follow(tree) {
            if (disposed) return tree;
            const seen = new Set<string>();
            collect(tree, seen);
            for (const path of [...playing.keys()]) if (!seen.has(path)) playing.delete(path);
            // While motion is reduced every shape rests; when it is turned off each animation starts from its beginning
            if (scheduler.reduced) for (const entry of playing.values()) entry.start = undefined;
            if (playing.size === 0) {
                cancel?.();
                cancel = undefined;
            } else ensureTask();
            return decorate(tree);
        },
        decorate,
        paths() {
            return playing.keys();
        },
        dispose() {
            disposed = true;
            cancel?.();
            cancel = undefined;
            playing.clear();
        }
    };
}
