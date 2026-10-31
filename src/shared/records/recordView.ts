/** What a component built on a record view (`tree`) tells the pool about the record in a slot */
export interface SlotMeta {
    /** The depth of the record, from 0; the slot shows it as the custom property `--sui-level` */
    level: number;
}

/**
 * What a record view puts on its element, for a component built on it (`list`, `table`): `locate` returns the store
 * path of the record with a key, or the shared empty record `$.runtime.empty` when no record
 * has it, `keyAt` the key shown at a position, `recordKeys` the keys of every position in order, and `commands.scrollTo`
 * takes a key. A component that wraps the view sets `slotMeta`, which the pool asks for each record it shows, and calls
 * `invalidate` when what `slotMeta` answers changed without the order changing
 */
export interface RecordViewElement extends Element {
    locate?: (key: string) => string;
    keyAt?: (position: number) => string | undefined;
    recordKeys?: () => string[];
    commands?: { scrollTo?: (value: unknown) => void };
    slotMeta?: (key: string, position: number) => SlotMeta | undefined;
    invalidate?: () => void;
}
