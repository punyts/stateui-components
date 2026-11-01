import type { Primitive, Scene } from './scene.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYERS = ['grid', 'axes', 'marks'] as const;

interface Drawn {
    readonly element: SVGElement;
    readonly tag: Primitive['tag'];
    className: string;
    attrs: Record<string, string>;
    text: string;
}

/** A chart's SVG drawn from scenes: it remembers what it wrote, so a redraw writes only the differences and never reads the DOM */
export interface SvgScene {
    /** Draws a scene: creates the elements that are new, writes the attributes and text that changed, removes the elements that are gone */
    draw(scene: Scene): void;
    /** Removes every element, so the next draw builds them all again */
    clear(): void;
    /** The element drawn for a primitive id, when there is one */
    elementOf(id: string): SVGElement | undefined;
}

/** Draws into `svg` with `createElementNS`: one `<g>` per layer (`grid`, `axes`, `marks`), the elements of each inside it */
export function createSvgScene(svg: SVGSVGElement): SvgScene {
    const document = svg.ownerDocument;
    const layers = new Map<Primitive['layer'], SVGGElement>();
    for (const name of LAYERS) {
        const layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('class', `layer ${name}`);
        svg.append(layer);
        layers.set(name, layer);
    }
    const drawn = new Map<string, Drawn>();
    let viewBox = '';

    const create = (primitive: Primitive): Drawn => {
        const element = document.createElementNS(SVG_NS, primitive.tag);
        (layers.get(primitive.layer) as SVGGElement).append(element);
        const entry: Drawn = { element, tag: primitive.tag, className: '', attrs: {}, text: '' };
        drawn.set(primitive.id, entry);
        return entry;
    };

    return {
        draw: (scene) => {
            if (scene.viewBox !== viewBox) {
                viewBox = scene.viewBox;
                svg.setAttribute('viewBox', viewBox);
            }
            const seen = new Set<string>();
            for (const primitive of scene.primitives) {
                seen.add(primitive.id);
                const entry = drawn.get(primitive.id) ?? create(primitive);
                if (entry.className !== primitive.className) {
                    entry.className = primitive.className;
                    entry.element.setAttribute('class', primitive.className);
                }
                for (const [name, value] of Object.entries(primitive.attrs)) {
                    if (entry.attrs[name] === value) continue;
                    entry.attrs[name] = value;
                    entry.element.setAttribute(name, value);
                }
                const text = primitive.text ?? '';
                if (entry.text !== text) {
                    entry.text = text;
                    entry.element.textContent = text;
                }
            }
            for (const [id, entry] of drawn) {
                if (seen.has(id)) continue;
                entry.element.remove();
                drawn.delete(id);
            }
        },
        clear: () => {
            for (const entry of drawn.values()) entry.element.remove();
            drawn.clear();
            viewBox = '';
        },
        elementOf: (id) => drawn.get(id)?.element
    };
}
