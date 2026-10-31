import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildLibrary } from '@punyts/stateui-app/build';
import { buildCoreIcons, coreIconsModule, coreIconsTypes } from './core-icons.ts';

/** The shared CSS partials a component's `view.css` pulls in with `@include "<name>.css";` */
const SHARED_CSS_DIR = resolve(import.meta.dirname, '../src/shared/css');

const REGISTER_JS = `import { components } from './components/index.js';

/**
 * Defines every component of the library on the page. StateUI defines elements on the global registry, so \`window\`
 * must be the page's own window; a component that is already defined is returned as it is, so calling twice is safe
 */
export function register(window) {
    if (window.customElements !== globalThis.customElements) {
        throw new Error('register needs the window the page runs in: StateUI defines elements on the global registry');
    }
    return components.map((component) => window.customElements.get(component.tag) ?? component.register());
}
`;

const REGISTER_DTS = `import type { StateUIElement } from '@punyts/stateui';

export declare function register(window: { readonly customElements: CustomElementRegistry }): (typeof StateUIElement)[];
`;

/**
 * Builds the component folder \`sourceDir\` into \`outDir\` with \`buildLibrary\` and writes the \`register(window)\` helper
 * next to it (in the parent of \`outDir\`, so it imports \`./components/index.js\` when \`outDir\` is \`<dist>/components\`)
 *
 * @param {string} sourceDir
 * @param {string} outDir
 * @returns {Promise<import('@punyts/stateui-app/build').BuildResult>}
 */
export async function buildComponents(sourceDir, outDir) {
    const result = await buildLibrary(resolve(sourceDir), resolve(outDir), { cssTransforms: [], cssChecks: [], sharedCssDir: SHARED_CSS_DIR });
    const registerDir = dirname(resolve(outDir));
    await mkdir(registerDir, { recursive: true });
    await writeFile(join(registerDir, 'register.js'), REGISTER_JS);
    await writeFile(join(registerDir, 'register.d.ts'), REGISTER_DTS);
    await mkdir(join(registerDir, 'icons'), { recursive: true });
    await writeFile(join(registerDir, 'icons', 'core.js'), coreIconsModule(await buildCoreIcons()));
    await writeFile(join(registerDir, 'icons', 'core.d.ts'), coreIconsTypes());
    return result;
}
