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
