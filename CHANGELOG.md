# Changelog

## 0.1.0
- Scaffold: package, build (`buildLibrary` into `dist/components`, `register(window)`), Vitest node and browser configs, and the `mountComponent` test harness.
- `text` atom (`textRole`, `tone`, `align`, `truncate`, `element` with a runtime tag swap), `link` atom (`#` and relative `href`; raises `press`, never navigates) and `divider` atom (`orientation`, optional `_label`, `role="separator"`), each with a German overlay.
- Icon set build: `dist/icons.json` from `@tabler/icons` 3.50.0 (exported as `./icons.json`), the icon alias table and a pixel comparison test.
- `image` atom: inline `data:` picture with `fit`, `ratio`, `radius` and `decorative` (`_alt` required unless decorative).
- Shared control stylesheet `src/shared/css/control.css` (pulled in with `@include "control.css";` through the build's `sharedCssDir`) and the bare `input` and `textarea` atoms: shared `size`, `change` and `input` events with the value, `focus` and `clear` commands, group `control` tokens (`radius`, `border`, `padding.inline`), German overlays.
- `select` (data array or translated static map of options, `multiple`), `checkbox` and `switch` (`role="switch"`) atoms on `control.css` tokens, with `change`, `focus` and `clear` and German overlays; harness option `locales`.
- Test harness: `mountComponent` option `data` sets the document's `data`, so a `<-` link to `$.data` has a target.
- `icon` atom (E4.28): outline and filled icons drawn with `createElementNS` from path data (string or `{ d, fill, stroke, opacity }` paths), the core icon set compiled into the library (`icons/core.js`), the app's icons read from `$.runtime.icons`, shared `tone` and `size`, the `icon.stroke` token, `SUI-RUN-ICON` for an unknown name; `isIconName`, `createIconNames`, `loadIconsFile` and `validateIconNode` (`SUI-STATE-FILLED`) exported from the package.
