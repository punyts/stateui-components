import { afterEach, describe, expect, it } from 'vitest';
import { libraryFromCatalog, mountApp, registerLocaleStep } from '@punyts/stateui-app';
import type { AppDocument } from '@punyts/stateui-app';
import type { Catalog } from '@punyts/stateui-app/build';
import catalogJson from '../../.test-build/real/components/catalog.json';
import { registerAll } from '../../.test-build/real/components/index.js';
import { overlaysFromFiles } from '../harness/createMountComponent.js';
import type { ComponentBuild } from '../harness/createMountComponent.js';

const catalog = catalogJson as unknown as Catalog;
const library = libraryFromCatalog(catalog);
const overlays = overlaysFromFiles(
    import.meta.glob<ComponentBuild['localeFiles'][string]>('../../.test-build/real/components/*.locale.*.json', { eager: true, import: 'default' })
);

const STEPS = ['details', 'options', 'review'] as const;
type Step = (typeof STEPS)[number];

let registered = false;
const mounted: { dispose(): void; host: HTMLElement; unregister(): void }[] = [];

interface Wizard {
    host: HTMLElement;
    store: NonNullable<ReturnType<typeof mountApp>['store']>;
    emitted: { name: string; payload: unknown }[];
    switchTo(code: string): void;
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Every element with this tag under the root, through the shadow roots, in document order */
function deep(root: ParentNode, tag: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (child.localName === tag) found.push(child as HTMLElement);
        if (child.shadowRoot) found.push(...deep(child.shadowRoot, tag));
        found.push(...deep(child, tag));
    }
    return found;
}

async function mount(app: Record<string, unknown> = {}): Promise<Wizard> {
    if (!registered) {
        registerAll();
        registered = true;
    }
    const host = globalThis.document.body.appendChild(globalThis.document.createElement('div'));
    host.style.cssText = 'inline-size: 700px';
    const locale = registerLocaleStep(overlays);
    const emitted: { name: string; payload: unknown }[] = [];
    const document = { locale: 'en', app: { component: 'wizard', ...app } } as unknown as AppDocument;
    const result = mountApp(host, document, library, { onEmit: (name: string, payload: unknown) => emitted.push({ name, payload }) });
    if (!result.store) throw new Error(`wizard did not mount: ${result.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    mounted.push({ host, dispose: () => result.dispose(), unregister: () => locale.unregister() });
    await settle();
    return { host, store: result.store, emitted, switchTo: (code) => void locale.switchTo(code) };
}

const get = (wizard: Wizard, path: string): unknown => wizard.store.get(`$.app.${path}`);
const field = (step: Step, name: string): string => `children.tabs.children.${step}.children.${name}`;
const put = (wizard: Wizard, step: Step, name: string, value: unknown, property = 'value'): void => {
    wizard.store.set(`$.app.${field(step, name)}.${property}`, value as never);
};
const shown = (wizard: Wizard): unknown => get(wizard, 'children.tabs.shown');
const completed = (wizard: Wizard): unknown => get(wizard, 'children.stepper.completed');
const active = (wizard: Wizard): unknown => get(wizard, 'children.stepper.active');
const isShown = (element: Element): boolean => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
const labelOf = (button: HTMLElement): string => button.shadowRoot?.querySelector('.label')?.textContent?.trim() ?? '';
/** The buttons of the step forms with this label that are on screen (the other steps' forms are hidden) */
const shownButtons = (wizard: Wizard, label: string): HTMLElement[] => deep(wizard.host, 'ui-button').filter((button) => labelOf(button) === label && isShown(button));
const press = (button: HTMLElement | undefined): void => (button?.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
const next = async (wizard: Wizard, label = 'Next'): Promise<void> => {
    press(shownButtons(wizard, label)[0]);
    await settle();
};
const back = async (wizard: Wizard, label = 'Back'): Promise<void> => {
    press(shownButtons(wizard, label)[0]);
    await settle();
};
const stepperButtons = (wizard: Wizard): HTMLButtonElement[] =>
    Array.from((deep(wizard.host, 'ui-stepper')[0] as HTMLElement).shadowRoot?.querySelectorAll<HTMLButtonElement>('.button') ?? []);
const fillDetails = (wizard: Wizard): void => put(wizard, 'details', 'name', 'Ada');
const fillOptions = (wizard: Wizard): void => put(wizard, 'options', 'plan', 'pro');

describe('wizard in Chromium', () => {
    afterEach(() => {
        for (const entry of mounted.splice(0)) {
            entry.dispose();
            entry.unregister();
            entry.host.remove();
        }
    });

    it('should show the stepper above the tabs with the strip hidden and the first step form', async () => {
        // Arrange
        const wizard = await mount();
        const stepper = deep(wizard.host, 'ui-stepper')[0] as HTMLElement;
        const tabs = deep(wizard.host, 'ui-tabs')[0] as HTMLElement;

        // Assert
        expect(stepper.getBoundingClientRect().bottom).toBeLessThanOrEqual(tabs.getBoundingClientRect().top + 1);
        expect(tabs.getAttribute('strip')).toBe('hidden');
        expect(isShown(tabs.shadowRoot?.querySelector('[role=tablist]') as HTMLElement)).toBe(false);
        expect(shown(wizard)).toBe('details');
        expect(deep(wizard.host, 'ui-form')).toHaveLength(3);
        expect(shownButtons(wizard, 'Next')).toHaveLength(1);
        expect(shownButtons(wizard, 'Back')).toHaveLength(0);
        expect(Array.from(stepper.shadowRoot?.querySelectorAll('.label') ?? []).map((label) => label.textContent)).toEqual(['Details', 'Options', 'Review']);
    });

    it('should stay on the step and show the errors when Next is pressed with a required field empty', async () => {
        // Arrange
        const wizard = await mount();

        // Act
        await next(wizard);

        // Assert
        expect(shown(wizard)).toBe('details');
        expect(active(wizard)).toBe('');
        expect(completed(wizard)).toEqual([]);
        expect(get(wizard, `${field('details', 'name')}.error`)).toBe('required');
        expect(get(wizard, `${field('details', 'name')}.message`)).toBe('This field is required');
        expect(get(wizard, 'children.tabs.children.details.errorCount')).toBe(1);
        expect(wizard.emitted).toEqual([]);
    });

    it('should go forward through valid steps, completing each, and emit wizard.done after the last', async () => {
        // Arrange
        const wizard = await mount();

        // Act and assert
        fillDetails(wizard);
        await next(wizard);
        expect(shown(wizard)).toBe('options');
        expect(active(wizard)).toBe('options');
        expect(completed(wizard)).toEqual(['details']);

        fillOptions(wizard);
        await next(wizard);
        expect(shown(wizard)).toBe('review');
        expect(active(wizard)).toBe('review');
        expect(completed(wizard)).toEqual(['details', 'options']);
        expect(wizard.emitted).toEqual([]);

        put(wizard, 'review', 'confirm', true, 'checked');
        await next(wizard, 'Finish');
        expect(wizard.emitted).toEqual([{ name: 'wizard.done', payload: { values: { confirm: true } } }]);
    });

    it('should block the last step and not emit when its required field is empty', async () => {
        // Arrange
        const wizard = await mount();
        fillDetails(wizard);
        await next(wizard);
        fillOptions(wizard);
        await next(wizard);

        // Act
        await next(wizard, 'Finish');

        // Assert
        expect(shown(wizard)).toBe('review');
        expect(get(wizard, `${field('review', 'confirm')}.error`)).toBe('required');
        expect(wizard.emitted).toEqual([]);
    });

    it('should not reach a later step without valid earlier ones: the stepper blocks it and no tab strip is reachable', async () => {
        // Arrange
        const wizard = await mount();

        // Act
        const buttons = stepperButtons(wizard);
        buttons[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await settle();

        // Assert
        expect(buttons.map((button) => button.disabled)).toEqual([false, true, true]);
        expect(shown(wizard)).toBe('details');
        expect(active(wizard)).toBe('');
        expect((deep(wizard.host, 'ui-tabs')[0] as HTMLElement).shadowRoot?.querySelectorAll('[role=tab]')).toBeDefined();
        expect(Array.from((deep(wizard.host, 'ui-tabs')[0] as HTMLElement).shadowRoot?.querySelectorAll<HTMLElement>('[role=tab]') ?? []).every((tab) => tab.offsetParent === null)).toBe(true);

        // Act: details is valid, options is not yet
        fillDetails(wizard);
        await next(wizard);
        await settle();

        // Assert
        expect(stepperButtons(wizard).map((button) => button.disabled)).toEqual([false, false, true]);
    });

    it('should keep the typed values when going back, and never validate on Back', async () => {
        // Arrange
        const wizard = await mount();
        put(wizard, 'details', 'email', 'ada@example.com');
        fillDetails(wizard);
        await next(wizard);

        // Act: Back from options while its required plan is still empty
        await back(wizard);

        // Assert
        expect(shown(wizard)).toBe('details');
        expect(active(wizard)).toBe('details');
        expect(get(wizard, `${field('details', 'name')}.value`)).toBe('Ada');
        expect(get(wizard, `${field('details', 'email')}.value`)).toBe('ada@example.com');
        expect(get(wizard, `${field('options', 'plan')}.error`)).toBe('');
        expect(completed(wizard)).toEqual(['details']);
        const input = deep(wizard.host, 'ui-text-field')[0]?.shadowRoot?.querySelector('input') as HTMLInputElement;
        expect(input.value).toBe('Ada');

        // Act: forward again keeps the step complete without a second entry
        await next(wizard);

        // Assert
        expect(shown(wizard)).toBe('options');
        expect(completed(wizard)).toEqual(['details']);
    });

    it('should show Back only after the first step', async () => {
        // Arrange
        const wizard = await mount();
        fillDetails(wizard);

        // Act
        await next(wizard);

        // Assert
        expect(shownButtons(wizard, 'Back')).toHaveLength(1);
        expect(shownButtons(wizard, 'Next')).toHaveLength(1);
    });

    it('should show the German stepper, buttons and field labels after switching to de', async () => {
        // Arrange
        const wizard = await mount();
        fillDetails(wizard);
        await next(wizard);

        // Act
        wizard.switchTo('de');
        await settle();
        await settle();

        // Assert
        const stepper = deep(wizard.host, 'ui-stepper')[0] as HTMLElement;
        expect(Array.from(stepper.shadowRoot?.querySelectorAll('.label') ?? []).map((label) => label.textContent)).toEqual(['Angaben', 'Optionen', 'Prüfen']);
        expect(shownButtons(wizard, 'Zurück')).toHaveLength(1);
        expect(shownButtons(wizard, 'Weiter')).toHaveLength(1);
        expect(deep(wizard.host, 'ui-select-field')[0]?.shadowRoot?.querySelector('.label')?.textContent?.trim()).toBe('Tarif');
    });

    it('should use the German button texts on the first and last steps', async () => {
        // Arrange
        const wizard = await mount();
        wizard.switchTo('de');
        await settle();
        await settle();

        // Assert
        expect(shownButtons(wizard, 'Weiter')).toHaveLength(1);
        expect(get(wizard, 'children.tabs.children.review.actions.children.next._title')).toBe('Fertig');
    });
});
