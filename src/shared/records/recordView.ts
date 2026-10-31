/**
 * What a record view puts on its element, for a component built on it (`list`, `table`): `locate` returns the store
 * path of the record with a key, or the shared empty record `$.runtime.empty` when no record
 * has it, `keyAt` the key shown at a position, `recordKeys` the keys of every position in order, and `commands.scrollTo`
 * takes a key
 */
export interface RecordViewElement extends Element {
    locate?: (key: string) => string;
    keyAt?: (position: number) => string | undefined;
    recordKeys?: () => string[];
    commands?: { scrollTo?: (value: unknown) => void };
}
