import type { ControllerContext } from '@punyts/stateui';

/** The properties of the list that its `recordList` body reads through a link, by the body's property name */
const PASSED: Readonly<Record<string, string>> = {
    records: 'items',
    row: 'row',
    key: 'key',
    total: 'total'
};

/**
 * The body of the list is a `recordList` node held in the runtime property `body` and drawn with `<sui-node>`. Its
 * `records`, `row`, `key` and `total` are store aliases of the list's `items`, `row`, `key` and `total`, so the record
 * view reads the list's data and template directly: the slot pool, the `$row` links (rewritten per slot by
 * `resolveRowLinks`), recycling and the key index are the record view's own. The body's runtime branch is
 * `$.runtime.nodes.<path>.body`, beside the list's own runtime state. The links are made before the view draws the body,
 * so the record view's controller finds them; `allowMissing` lets a list with no `items` or `total` mount
 */
export default function controller({ store, basePath }: ControllerContext) {
    const bodyPath = `${basePath}.body`;
    const linked: string[] = [];
    for (const [name, source] of Object.entries(PASSED)) {
        const alias = `${bodyPath}.${name}`;
        if (store.link(alias, `${basePath}.${source}`, { allowMissing: true })) linked.push(alias);
    }
    return {
        dispose: () => {
            for (const alias of linked) store.unlink(alias);
        }
    };
}
