import { registerTipMixins } from '../shared/popover/tipMixin.js';

registerTipMixins();

/**
 * The behaviour is in the `tip` and `tip-describes` directives of the view (`src/shared/popover/`): the controller
 * only makes sure they are registered before the view is compiled
 */
export default function controller(): void {}
