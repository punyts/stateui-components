# shared

CSS partials and base controllers used by more than one component. They live here, outside `components/`, because the
build's convention scan rejects any file in `components/` that is not part of a component folder.

## css/
Partials a component's `view.css` pulls in with a line `@include "<name>.css";` (the build's `sharedCssDir`, set in `scripts/buildComponents.mjs`). The token lint checks them inside each component that includes them.
- `control.css`: the class `.control` for a bare native control (border, radius, padding, minimum height from `--control-height`, placeholder, read-only, disabled and focus states) from the `control` tokens. Used by `input` and `textarea`.
- `overlay.css`: the dialog, backdrop, frame, header, close button, body and footer of `modal` and `drawer`; the including view sets `--pad`, `--gap` and `--radius` on `.dialog`.

## field/
`field.ts`: `createField(context, valueName)`, the base controller of every field (glyph, message, baseline, `validate` and `reset` commands, `change`, `invalid` and `valid` events, `focus` and `clear` commands, the `ui-field-connect` event with `FieldConnect`, `touched` and `dirty`) and the layout helpers; `rules.ts`: `failingRule`, `patternOf`, `NAMED_PATTERNS` and `FIELD_RULES`, the pure validation rules.

## format/
`format.ts`: `formatValue(value, { format, locale, currency, signed })` formats a number with `Intl` for a language (`number`; `percent` from 0 to 1, up to one decimal; `currency` with an ISO 4217 code; `duration` from seconds as `m:ss`, or `h:mm:ss` from one hour) and returns an empty string for a value that is not a number. An unusable locale falls back to `en`, a currency code `Intl` refuses to a plain number. `stat` uses it; the `table` and `descriptionList` columns will. Controllers import it as `../shared/format/format.js`.

## tone/
`toneGlyph.ts`: `toneIcon(tone)` gives the default icon of a tone (`info-circle` for `info`, `neutral` and `accent`, `alert-circle`, `alert-triangle` and `circle-check` for `danger`, `warning` and `success`). `toast` uses it; a controller imports it as `../shared/tone/toneGlyph.js`.

## popover/
`popover.ts`: `createPopover` (popover API, CSS anchor positioning from a `placement` or an `anchor` name, Escape and outside-press dismissal, no layout reads; no component needed, exported from the package), `positionAreaOf`, `isPlacement`, `isAlignedPlacement`, `isAnchorName`, `PLACEMENTS` and `ALIGNED_PLACEMENTS`. `tip.ts`: `attachTip` (show after a hover delay, at once on focus, hide on leave and blur). `tipMixin.ts`: the `tip` and `tip-describes` attribute directives and `registerTipMixins()`; `tooltip` and the icon-only `button` import it as `../shared/popover/tipMixin.js` and put `tip="" tip-describes="_text"` on their popover element, the element after the trigger.

## overlay/
`overlay.ts`: `registerOverlayMixin()` registers the `overlay` attribute directive, put on the `<dialog>` of a view: it keeps the dialog open as the component's `open` property says (`showModal()`, `close()`, focus returned to the opener), closes it on Escape and a backdrop press while `dismissible` is not false by writing `open`, and raises `open` or `close` on the host once per change of `open`. `createOverlayController(context)` gives the commands `open`, `close` and `toggle` and the handler `onClose`, which only write `open`. `deepActiveElement` is the focused element through open shadow roots. `modal` and `drawer` import it as `../shared/overlay/overlay.js` and pull the layout parts in with `@include "overlay.css";`.

## records/
`window.ts`: `readWindow`, `poolSize(count, overscan)` (visible rows plus the overscan on both sides, at most `MAX_SLOTS` = 200, taken from the overscan first) and `poolStart`. `recordIndex.ts`: `createRecordIndex`, the key-to-position bookkeeping of an array (a key-to-index map kept from the store events) or a keyed map, with `order`, `keyAt`, `pathOf`, `locate` (the record path, or `$.runtime.empty`) and `size`. `slotPool.ts`: `createSlotPool`, the slot nodes in the runtime branch recycled by re-pointing one `row` link. `recordList` uses them as `../shared/records/*.js`; `recordGrid` will too.
