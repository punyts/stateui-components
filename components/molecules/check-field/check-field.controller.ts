import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';

export default function controller(context: ControllerContext) {
    const field = createField(context, 'checked');
    const { store, basePath } = context;
    return {
        ...field,
        // A read-only control keeps its state: the click is cancelled, so no change follows
        onClick: (event: Event) => {
            if (store.get<boolean>(`${basePath}.readonly`) === true) event.preventDefault();
        }
    };
}
