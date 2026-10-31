/**
 * One path of an icon. A plain string is the path data and takes the icon's own drawing style (an outline icon is
 * stroked, a filled icon is filled). The object form is used only for the few outline paths Tabler styles on their
 * own, so they draw as designed
 */
export type IconPath = string | IconStyledPath;

export interface IconStyledPath {
    readonly d: string;
    /** The path is also filled with the current colour (an outline icon's dots and solid shapes) */
    readonly fill?: true;
    /** The path is not stroked */
    readonly stroke?: false;
    readonly opacity?: number;
}

export interface IconEntry {
    readonly category: string;
    readonly tags: readonly string[];
    readonly outline: readonly IconPath[];
    /** Present only when Tabler ships a filled variant */
    readonly filled?: readonly IconPath[];
}

/** The shape of `icons.json`. The icon name is the key of `icons` */
export interface IconsFile {
    readonly tablerVersion: string;
    readonly aliases: Readonly<Record<string, string>>;
    readonly icons: Readonly<Record<string, IconEntry>>;
}
