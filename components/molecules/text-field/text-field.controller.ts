import type { ControllerContext } from '@punyts/stateui';
import { createField } from '../shared/field/field.js';

export default function controller(context: ControllerContext) {
    return createField(context);
}
