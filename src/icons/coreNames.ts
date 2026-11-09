/**
 * The icons the library's own components draw, compiled into the library so components work before or without an
 * app's icon list. Every name is a Tabler icon name; `scripts/core-icons.ts` reads their path data from the pinned
 * `@tabler/icons` package. A test fails when a template or shape uses an icon that is not listed here
 */
export const CORE_ICON_NAMES: readonly string[] = [
    'alert-circle',
    'alert-triangle',
    'arrow-back-up',
    'arrow-forward-up',
    'brush',
    'bucket-droplet',
    'calendar',
    'check',
    'chevron-down',
    'chevron-left',
    'chevron-right',
    'chevron-up',
    'circle-check',
    'dots',
    'eraser',
    'grip-vertical',
    'info-circle',
    'layout-sidebar',
    'layout-sidebar-right',
    'line',
    'menu-2',
    'minus',
    'oval',
    'plus',
    'search',
    'square',
    'squares',
    'trash',
    'upload',
    'x'
];
