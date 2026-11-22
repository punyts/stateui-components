/**
 * A key in a record view's `order` that names no record: the row a view shows in place of records it is waiting for
 * (`tree`: the busy row under a record whose children are loading). The pool shows such a position as a pending slot, whose
 * `row` links to the shared empty record. The prefix starts with a character a record key never has
 */
export const PLACEHOLDER_PREFIX = '\u0000busy:';

/** The key of the placeholder that waits for the children of the record with that key */
export const placeholderKey = (owner: string): string => `${PLACEHOLDER_PREFIX}${owner}`;

/** Whether a key is a placeholder's */
export const isPlaceholderKey = (key: string): boolean => key.startsWith(PLACEHOLDER_PREFIX);

/** The key of the record a placeholder waits for, or `undefined` for a key that is not a placeholder's */
export const placeholderOwner = (key: string): string | undefined => (isPlaceholderKey(key) ? key.slice(PLACEHOLDER_PREFIX.length) : undefined);

/**
 * The prefix of a group row's key in a record view's `order` (`table` grouped by a field). A group key names a record in
 * the view's `groups` map, not in its records, and is never selected
 */
export const GROUP_PREFIX = '\u0000group:';

/** The key of the group row whose record is at `groups.<id>` */
export const groupKey = (id: string): string => `${GROUP_PREFIX}${id}`;

/** Whether a key is a group row's */
export const isGroupKey = (key: string): boolean => key.startsWith(GROUP_PREFIX);

/** The id of a group row's record in `groups`, or `undefined` for a key that is not a group row's */
export const groupId = (key: string): string | undefined => (isGroupKey(key) ? key.slice(GROUP_PREFIX.length) : undefined);

/** Whether a key names no record of the view's own (a placeholder or a group row), since only those keys start with U+0000 */
export const isVirtualKey = (key: string): boolean => key.startsWith('\u0000');
