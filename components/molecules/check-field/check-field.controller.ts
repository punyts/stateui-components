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
        },
        /** The control's description: the card's description, then the help and the error that are shown */
        cardDescribedBy: (description: unknown, help: unknown, message: unknown): string | null => {
            const ids = [typeof description === 'string' && description !== '' ? 'description' : '', field.describedBy(help, message) ?? ''].filter((id) => id !== '');
            return ids.length > 0 ? ids.join(' ') : null;
        }
    };
}
