# shared

CSS partials and base controllers used by more than one component. They live here, outside `components/`, because the
build's convention scan rejects any file in `components/` that is not part of a component folder.

## css/
Partials a component's `view.css` pulls in with a line `@include "<name>.css";` (the build's `sharedCssDir`, set in `scripts/buildComponents.mjs`). The token lint checks them inside each component that includes them.
- `control.css`: the class `.control` for a bare native control (border, radius, padding, minimum height from `--control-height`, placeholder, read-only, disabled and focus states) from the `control` tokens. Used by `input` and `textarea`.

## format/
`format.ts`: `formatValue(value, { format, locale, currency, signed })` formats a number with `Intl` for a language (`number`; `percent` from 0 to 1, up to one decimal; `currency` with an ISO 4217 code; `duration` from seconds as `m:ss`, or `h:mm:ss` from one hour) and returns an empty string for a value that is not a number. An unusable locale falls back to `en`, a currency code `Intl` refuses to a plain number. `stat` uses it; the `table` and `descriptionList` columns will. Controllers import it as `../shared/format/format.js`.
