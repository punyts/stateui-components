import { report } from '@punyts/core';
import { registerMixin } from '@punyts/stateui';
import { buildError } from '@punyts/stateui-app';
import { CORE_ICON_ALIASES, CORE_ICONS } from '../icons/core.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const RUNTIME_ICONS = '$.runtime.icons';

interface StyledPath {
    d: string;
    fill?: true;
    stroke?: false;
    opacity?: number;
}

type IconPath = string | StyledPath;

interface IconData {
    outline: readonly IconPath[];
    filled?: readonly IconPath[];
}

interface Store {
    get(path: string): unknown;
    on(path: string, listener: () => void): void;
    off(path: string, listener: () => void): void;
}

interface IconScope {
    store: Store;
    basePath: string;
    subscribe(variables: string[], listener: () => void): { dispose(): void };
}

/** The `ui-icon` element of each icon scope: the view is instantiated detached, so the mixin cannot find its host by walking up */
const HOSTS = new WeakMap<object, Element>();

/**
 * The attribute-given icon: an icon that shares its parent's scope (no `state` attribute) and carries a `name`
 * attribute is `<ui-icon name="chevron-left">`, so the attribute is its name and `filled` its flag; the parent's own
 * `name` or `filled` property is not the icon's. Undefined when the icon has its own state or no `name` attribute
 */
function attributeHost(host: Element | undefined): Element | undefined {
    if (!host || host.hasAttribute('state') || !host.hasAttribute('name')) return undefined;
    return host;
}

function isPath(value: unknown): value is IconPath {
    if (typeof value === 'string') return true;
    return typeof value === 'object' && value !== null && typeof (value as StyledPath).d === 'string';
}

function isPathList(value: unknown): value is readonly IconPath[] {
    return Array.isArray(value) && value.length > 0 && value.every(isPath);
}

function asIcon(value: unknown): IconData | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const { outline, filled } = value as { outline?: unknown; filled?: unknown };
    if (!isPathList(outline)) return undefined;
    return isPathList(filled) ? { outline, filled } : { outline };
}

/** The path data of a name: the app's icons first, then the core set, each by the name and then by its alias target */
function findIcon(store: Store, name: string): IconData | undefined {
    const runtime = store.get(RUNTIME_ICONS);
    const own = (table: unknown, key: string): unknown =>
        typeof table === 'object' && table !== null && Object.hasOwn(table, key) ? (table as Record<string, unknown>)[key] : undefined;
    const keys = [name];
    if (Object.hasOwn(CORE_ICON_ALIASES, name)) keys.push((CORE_ICON_ALIASES as Record<string, string>)[name] as string);
    for (const table of [runtime, CORE_ICONS]) {
        for (const key of keys) {
            const icon = asIcon(own(table, key));
            if (icon) return icon;
        }
    }
    return undefined;
}

/** One path element: a string is the path data; the object form carries the few styles Tabler sets on a path itself */
function drawPath(document: Document, path: IconPath): SVGPathElement {
    const element = document.createElementNS(SVG_NAMESPACE, 'path');
    if (typeof path === 'string') {
        element.setAttribute('d', path);
        return element;
    }
    element.setAttribute('d', path.d);
    if (path.fill === true) element.setAttribute('fill', 'currentColor');
    if (path.stroke === false) element.setAttribute('stroke', 'none');
    if (path.opacity !== undefined) element.setAttribute('opacity', String(path.opacity));
    return element;
}

/** An outline icon is stroked with the `icon.stroke` token (set in the stylesheet); a filled icon is filled */
function drawIcon(document: Document, paths: readonly IconPath[], filled: boolean): SVGSVGElement {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (filled) {
        svg.setAttribute('class', 'filled');
        svg.setAttribute('fill', 'currentColor');
    } else {
        svg.setAttribute('class', 'outline');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    }
    for (const path of paths) svg.append(drawPath(document, path));
    return svg;
}

/**
 * The `icon-paths` attribute of the icon's view: draws the node's icon into the element with `createElementNS` and
 * redraws when the name property, `filled` or the app's icon map change. The attribute value may name another
 * property that holds the icon name (`icon-paths="icon"` on a button); empty means `name`. Path data only, never
 * markup. An unknown name draws nothing and is reported once as `SUI-RUN-ICON`
 */
function drawInto(element: Element, attributes: Record<string, unknown>, scope: IconScope): () => void {
    const { store, basePath } = scope;
    const given = attributes['icon-paths'];
    const nameKey = typeof given === 'string' && given !== '' ? given : 'name';
    let reported = '';
    const fixed = nameKey === 'name' ? attributeHost(HOSTS.get(scope)) : undefined;
    const draw = (): void => {
        element.replaceChildren();
        const name = fixed ? fixed.getAttribute('name') : store.get(`${basePath}.${nameKey}`);
        if (typeof name !== 'string' || name === '') {
            reported = '';
            return;
        }
        const icon = findIcon(store, name);
        if (!icon) {
            if (reported !== name) {
                reported = name;
                report.error(buildError('SUI-RUN-ICON', { name, path: basePath, statePath: basePath }).message, { code: 'SUI-RUN-ICON', path: basePath });
            }
            return;
        }
        reported = '';
        const wantsFilled = fixed ? fixed.hasAttribute('filled') && fixed.getAttribute('filled') !== 'false' : store.get(`${basePath}.filled`) === true;
        const filled = wantsFilled && icon.filled !== undefined;
        element.append(drawIcon(element.ownerDocument, filled ? (icon.filled as readonly IconPath[]) : icon.outline, filled));
    };
    const subscription = fixed ? undefined : scope.subscribe([`$.${nameKey}`, '$.filled'], draw);
    const observer = fixed ? new MutationObserver(draw) : undefined;
    if (fixed) observer?.observe(fixed, { attributes: true, attributeFilter: ['name', 'filled'] });
    store.on(RUNTIME_ICONS, draw);
    draw();
    return () => {
        subscription?.dispose();
        observer?.disconnect();
        store.off(RUNTIME_ICONS, draw);
    };
}

try {
    registerMixin('icon-paths', drawInto as never);
} catch (error) {
    if (!String(error).includes('already registered')) throw error;
}

export default function icon(context: { element: Element; scope: object }): void {
    HOSTS.set(context.scope, context.element);
}
