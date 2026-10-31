# shared

CSS partials and base controllers used by more than one component. They live here, outside `components/`, because the
build's convention scan rejects any file in `components/` that is not part of a component folder.

## css/
Partials a component's `view.css` pulls in with a line `@include "<name>.css";` (the build's `sharedCssDir`, set in `scripts/buildComponents.mjs`). The token lint checks them inside each component that includes them.
- `control.css`: the class `.control` for a bare native control (border, radius, padding, minimum height from `--control-height`, placeholder, read-only, disabled and focus states) from the `control` tokens. Used by `input` and `textarea`.
