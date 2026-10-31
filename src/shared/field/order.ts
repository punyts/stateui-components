/**
 * The values of `targets` whose element is under `root`, in document order, found by walking `root` through the shadow
 * roots it contains. The DOM's own `compareDocumentPosition` cannot order elements that sit in different shadow trees;
 * a form's fields do
 */
export function inDocumentOrder<T>(root: ParentNode, targets: ReadonlyMap<Element, T>): T[] {
    const found: T[] = [];
    const visit = (parent: ParentNode): void => {
        for (const child of Array.from(parent.children)) {
            if (targets.has(child)) found.push(targets.get(child) as T);
            if (child.shadowRoot) visit(child.shadowRoot);
            visit(child);
        }
    };
    visit(root);
    return found;
}
