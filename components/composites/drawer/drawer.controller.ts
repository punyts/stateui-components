import type { ControllerContext } from '@punyts/stateui';
import { createOverlayController, registerOverlayMixin } from '../shared/overlay/overlay.js';

registerOverlayMixin();

/**
 * The commands `open`, `close` and `toggle` and the close button only write `open`; the `overlay` directive of the view
 * (`src/shared/overlay/`) shows the dialog and raises `open` and `close` once per change of `open`, whoever wrote it
 */
export default function controller(context: ControllerContext) {
    return createOverlayController(context);
}
