import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '../harness/mountComponent.js';

/**
 * How the components look, as screenshots compared with a reference: each sheet is one panel holding a component in
 * its variants, sizes and states, side by side. Behaviour tests cannot see a select that lost its chevron or text that
 * sits low in its line; these can. The references are per platform (fonts differ), under `__screenshots__` beside this
 * file: `npm run test:visual` compares, `npm run test:visual -- -u` writes them again after a change that is meant
 */

type Children = Record<string, Record<string, unknown>>;

const sheet = (children: Children, layout: Record<string, unknown> = { type: 'row', gap: 'sm', align: 'center', wrap: true }) => ({
    component: 'panel',
    padding: 'md',
    layout,
    children
});

const column = (children: Children) => sheet(children, { type: 'column', gap: 'sm' });

/** Mounts a sheet at a fixed width, so a reference never depends on the window */
async function shoot(name: string, node: Record<string, unknown>, options: { mode?: string; width?: number; height?: number } = {}): Promise<void> {
    const mounted = mountComponent('panel', node, options.mode === undefined ? {} : { mode: options.mode });
    const host = mounted.element as HTMLElement;
    host.style.width = `${options.width ?? 560}px`;
    host.style.display = 'block';
    if (options.height !== undefined) host.style.height = `${options.height}px`;
    await document.fonts.ready;
    await expect.element(page.elementLocator(host)).toMatchScreenshot(name, { comparatorName: 'pixelmatch', comparatorOptions: { threshold: 0.005, allowedMismatchedPixelRatio: 0.002 } });
}

const button = (title: string, extra: Record<string, unknown> = {}) => ({ component: 'button', _title: title, ...extra });

const BUTTONS: Children = {
    solid: button('Solid'),
    soft: button('Soft', { variant: 'soft' }),
    outline: button('Outline', { variant: 'outline' }),
    ghost: button('Ghost', { variant: 'ghost' }),
    link: button('Link', { variant: 'link' }),
    neutral: button('Neutral', { tone: 'neutral', variant: 'outline' }),
    danger: button('Danger', { tone: 'danger' }),
    small: button('Small', { size: 'sm' }),
    large: button('Large', { size: 'lg' }),
    pill: button('Pill', { corners: 'pill' }),
    square: button('Square', { corners: 'square', variant: 'soft' }),
    icon: button('Add', { icon: 'plus', iconPosition: 'only', corners: 'pill', variant: 'ghost', tone: 'neutral' }),
    withIcon: button('Search', { icon: 'search' }),
    busy: button('Busy', { busy: true }),
    disabled: button('Disabled', { disabled: true }),
    toggle: { component: 'toggleButton', _text: 'Bold', icon: 'check', pressed: true }
};

const options = { phone: { _label: 'Phone' }, tablet: { _label: 'Tablet' } };
const FIELDS: Children = {
    text: { component: 'textField', _label: 'Name', value: 'Ada Lovelace', _help: 'As on your card' },
    soft: { component: 'textField', _label: 'Soft', variant: 'soft', _placeholder: 'Placeholder' },
    ghost: { component: 'textField', _label: 'Ghost', variant: 'ghost', value: 'No box' },
    required: { component: 'textField', _label: 'Email', required: true, _placeholder: 'name@example.com' },
    disabled: { component: 'textField', _label: 'Disabled', value: 'Locked', disabled: true },
    select: { component: 'selectField', _label: 'Size', options, value: 'phone' },
    selectSoftPill: { component: 'selectField', _label: 'Soft pill, small', options, value: 'tablet', variant: 'soft', corners: 'pill', size: 'sm', width: 'auto' },
    selectLarge: { component: 'selectField', _label: 'Large', options, value: 'phone', size: 'lg' },
    number: { component: 'numberField', _label: 'Count', value: 3 },
    date: { component: 'dateField', _label: 'Date', value: '2026-11-13' },
    search: { component: 'searchBox', _label: 'Search', value: 'tide' },
    textarea: { component: 'textareaField', _label: 'Note', value: 'Two lines\nof text', rows: 2 }
};

const CHOICES: Children = {
    check: { component: 'checkField', _label: 'Checked', checked: true },
    unchecked: { component: 'checkField', _label: 'Unchecked' },
    switchOn: { component: 'switchField', _label: 'Switch on', checked: true },
    radio: { component: 'radioField', _label: 'Radio', options: { a: { _label: 'One' }, b: { _label: 'Two' } }, value: 'a' },
    slider: { component: 'sliderField', _label: 'Volume', value: 40 },
    segmented: { component: 'segmented', options: { day: { _label: 'Day' }, week: { _label: 'Week' } }, value: 'week' },
    rating: { component: 'rating', _label: 'Rating', value: 3 }
};

const text = (role: string, extra: Record<string, unknown> = {}) => ({ component: 'text', textRole: role, _text: `${role[0]?.toUpperCase()}${role.slice(1)} text`, ...extra });
const TEXT: Children = {
    display: text('display'),
    title: text('title'),
    heading: text('heading'),
    body: text('body'),
    label: text('label'),
    caption: text('caption'),
    code: text('code'),
    muted: text('caption', { muted: true, _text: 'Muted caption' }),
    caps: text('caption', { caps: true, muted: true, _text: 'Show' }),
    danger: text('body', { tone: 'danger', _text: 'Danger tone' })
};

const SURFACES: Children = {
    bordered: { component: 'panel', bordered: true, _title: 'Bordered panel', children: { t: text('body') } },
    raised: { component: 'panel', elevation: 'raised', bordered: true, _title: 'Raised panel', children: { t: text('body') } },
    pill: { component: 'panel', elevation: 'raised', bordered: true, corners: 'pill', padding: 'sm', layout: { type: 'row', gap: 'sm', align: 'center' }, children: { t: text('body', { _text: 'A pill bar' }), b: button('Go', { size: 'sm', corners: 'pill' }) } },
    card: { component: 'card', _title: 'Card', _subtitle: 'With a subtitle', children: { t: text('caption', { _text: 'Card body' }) } },
    alert: { component: 'alert', tone: 'warning', _title: 'Heads up', _text: 'Something to know' },
    badge: { component: 'badge', _text: 'Badge' },
    chip: { component: 'chip', _text: 'Chip', removable: true }
};

describe('how the components look', () => {
    afterEach(() => mountComponent.unmountAll());

    it('buttons', async () => {
        await shoot('buttons', sheet(BUTTONS));
    });

    it('fields', async () => {
        await shoot('fields', column(FIELDS), { width: 420 });
    });

    it('choices', async () => {
        await shoot('choices', column(CHOICES), { width: 420 });
    });

    it('text', async () => {
        await shoot('text', column(TEXT), { width: 420 });
    });

    it('surfaces', async () => {
        await shoot('surfaces', column(SURFACES), { width: 420 });
    });

    it('tabs that scroll in a fixed height', async () => {
        const long = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`l${index}`, text('body', { _text: `Line ${index + 1}` })]));
        const tabs = {
            component: 'tabs',
            placement: { grow: 1 },
            children: { one: { component: 'panel', placement: { _tab: 'One' }, children: long }, two: { component: 'panel', placement: { _tab: 'Two' }, children: {} } }
        };
        await shoot('tabs', column({ head: text('label', { _text: 'A panel 240px high' }), tabs }), { width: 320, height: 240 });
    });

    it('buttons and fields in dark mode', async () => {
        await shoot('dark', column({ buttons: sheet(BUTTONS), select: FIELDS['select'] as Record<string, unknown>, text: FIELDS['text'] as Record<string, unknown> }), { mode: 'dark' });
    });
});
