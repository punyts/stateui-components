/**
 * Semantic icon names mapped to the Tabler icon each one draws. A minion can write `close` or `warning` and get a
 * consistent icon; `icons.json` lists the table, and a test fails when a target is not a Tabler icon name
 */
export const ICON_ALIASES: Readonly<Record<string, string>> = {
    close: 'x',
    delete: 'trash',
    warning: 'alert-triangle',
    error: 'alert-circle',
    success: 'circle-check',
    info: 'info-circle'
};
