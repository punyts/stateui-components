const TONE_ICONS: Readonly<Record<string, string>> = {
    danger: 'alert-circle',
    warning: 'alert-triangle',
    success: 'circle-check'
};
const DEFAULT_TONE_ICON = 'info-circle';

/** The icon a message component shows for a tone when its `icon` property is empty */
export const toneIcon = (tone: unknown): string => (typeof tone === 'string' ? (TONE_ICONS[tone] ?? DEFAULT_TONE_ICON) : DEFAULT_TONE_ICON);
