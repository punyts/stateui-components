# @punyts/stateui-components

The StateUI component library: atoms, molecules, composites and composed components, built with `@punyts/stateui-app`.

## Layout
- `components/atoms/`, `molecules/`, `composites/`, `composed/`: one folder per component, by the `@punyts/stateui-app` file convention. The group folders are grouping only; `npm run build` creates them when they are missing, because git does not keep empty folders. Nothing but component files may sit in `components/`, so tests live in `test/`.
- `src/shared/`: CSS partials and base controllers used by several components.
- `scripts/`: `build.mjs` (the `npm run build` step) and `buildComponents.mjs` (`buildLibrary` plus the `register` helper).
- `test/`: the harness (`test/harness/`) and the fixture component `probe` (`test/fixtures/components/atoms/probe/`). The fixture is test-only and never part of `dist/`.

## Build
`npm run build` compiles `src/` with `tsc`, then runs `buildLibrary` over `components/` into `dist/components/` (modules, `catalog.json`, locale overlays, `index.js`) and writes `dist/register.js`. It then runs `scripts/build-icons.ts`, which writes `dist/icons.json` (Tabler icon names, categories, tags, outline and filled path data, and the alias table from `src/icons/aliases.ts`) from the pinned `@tabler/icons` devDependency; `brand-*` icons are left out. Tabler's licence is in `LICENSE-tabler-icons`.

## Package exports
- `.`: `COMPONENT_GROUPS`, and the server-side icon helpers: `isIconName` (the `isIconName` option of `validateNode`; reads `dist/icons.json`, names and aliases), `createIconNames` and `loadIconsFile` (the same lookups over any `icons.json`), `validateIconNode` (the `SUI-STATE-FILLED` warning), `CORE_ICON_NAMES` and `ICON_ALIASES`.
- `./components`: `components`, `componentTokens` and `registerAll()`.
- `./components/*`: a built module, controller or locale overlay.
- `./catalog.json`: the component catalog.
- `./icons.json`: the icon data the server reads (never part of the runtime bundle).
- `./register`: `register(window)` defines every component on the page. StateUI defines elements on the global registry, so `window` must be the page's own; it throws otherwise, and a component that is already defined is skipped.

## Atoms: `text`, `link`, `divider`, `image`
- `text`: `_text`, shared `tone` and `textRole` (default `body`), `align` (`start`, `center`, `end`), `truncate` (lines; 0 means no clamp) and `element` (`span`, `p`, `h1` to `h6`). The tag is chosen by an `if`/`ifelse` chain in the view, so changing `element` swaps the tag and `element: "h2"` stays an `<h2>` whatever the `textRole`.
- `link`: `_text`, `tone` (default `accent`) and `href` (a `url` property: `#` and relative targets; `http:`, `javascript:` and `//host` are `SUI-STATE`). A click or Enter raises `press` once, with `{ href }` as detail; the click is cancelled, so the link never navigates by itself and the application decides with `on`. A `pattern` validator (`^(?!data:)`) also refuses `data:` hrefs.
- `divider`: `orientation` (`horizontal`, `vertical`) and `_label`, shown in the line only when not empty. The line is `role="separator"` with `aria-orientation`, named by the label when there is one.
- `image`: `src` (a `url` narrowed to `data:` by a `pattern` validator), `_alt` (required unless `decorative`), `fit`, `ratio` and `radius` (mapped to `--ui-radius-*`).

## Icons: `icon`
- `icon`: `name` (type `icon`; empty draws nothing), `filled` (false), `decorative` (true: the glyph is `aria-hidden`; false: `role="img"` named by `_label`, which `requiredWhen` makes required), shared `tone` (no default: without it the icon takes the surrounding text colour) and `size` (default `md`, from `--icon-size`). The line weight is the default semantic token `icon.stroke` (`--ui-icon-stroke`, default 2); it applies to outline icons only, so a write to `$.theme.tokens.icon.stroke` changes every outline icon.
- Drawing: the `icon-paths` mixin (registered by `icon.controller.ts`) builds an `<svg>` with `createElementNS` from path data, never from markup, and redraws when `name`, `filled` or `$.runtime.icons` change. A path is a string `d`, or `{ d, fill?, stroke?, opacity? }` for the 82 Tabler paths that carry their own style (`fill: true` fills with the current colour, `stroke: false` draws no line). Outline icons are stroked with `currentColor`, round caps and joins; filled icons are filled with `currentColor`. `filled: true` on a name with no filled variant draws the outline.
- Lookup order: `$.runtime.icons[name]`, `$.runtime.icons[alias target]`, then the core set by the same two keys. A runtime entry is `{ outline: path[], filled?: path[] }` (the shape of an `icons.json` entry without category and tags); an entry that is not that is ignored. A name found nowhere draws nothing and is reported once through `@punyts/core` as `SUI-RUN-ICON`.
- Core set: `src/icons/coreNames.ts` lists the icons the library's own components use. `scripts/core-icons.ts` reads their path data from the pinned `@tabler/icons` and `buildComponents` writes it as `icons/core.js` (and `core.d.ts`) beside `components/`, in `dist/` and in each test build; the controller imports `../icons/core.js`. A test fails when a shape default or a `<ui-icon name="...">` in a view uses an icon outside the set.
- Validation: `isIconName` gives `SUI-STATE-INVALID` for an unknown name; `validateIconNode(node, statePath)` gives the `SUI-STATE-FILLED` warning, which the shape format cannot express. The server runs both beside `validateNode`.

## Bare controls: `input`, `textarea`, `select`, `checkbox`, `switch`
Both `@include "control.css";` from `src/shared/css/` (inlined by the build's `sharedCssDir`, then linted). `input` has shared `size`, `disabled`, `readonly`, `required`, `inputType`, `min`, `max`, `step`, `maxLength`, `_placeholder`, `_label` (accessible name) and `value`; it raises `change` (blur or Enter) and `input` (each keystroke) and takes the `focus` and `clear` commands. `textarea` adds `rows` and `autoGrow`. Typing writes `value` through `bind`, so a `<-value` link writes `$.data`; `inputType: "number"` writes a number. Tokens `radius`, `border` and `padding.inline` are in the group `control`.

### `select`, `checkbox`, `switch`
The same `control` token group and the same `size`, `focus` and `clear`. `select` takes `options`, `optionValue` (`value`), `optionLabel` (`label`), `multiple`, `value`, `disabled` and `required`. `options` is a data array (normally `"<-options": "$.data.statuses"`; its labels are not translated) or a keyed map `{ "open": { "_label": "Open" } }` whose key is the value and whose `_label` is content, so a locale overlay translates it; an entry that holds `_label` is treated as a map entry. The value is the option value as the data holds it (a number stays a number); with `multiple` it is an array. The chevron is drawn with CSS. `checkbox` and `switch` have `checked` (written through `bind`), `disabled`, `readonly` (a click or Space changes nothing), `required` and `_label` (accessible name); `switch` has `role="switch"` and `aria-checked`. Each raises `change` with the new value, after the data is written; `clear` sets `false` (`select`: `""` or `[]`).

## Testing components
`mountComponent(name, nodeState, options?)` (`test/harness/mountComponent.ts`) mounts one component through `mountApp` in a browser test. `options` are `mode`, `brand`, `motion` (overlay names), `locale`, `data` (the document's `data`) and `locales` (the document's own overlays per language). It returns `{ element, host, store, setTheme(kind, name), setLocale(code), dispose }`; call `mountComponent.unmountAll()` in `afterEach`. It throws with the validation errors when the node does not mount.

```
npm run build
npm test            # node tests (happy-dom)
npm run test:browser  # Chromium tests
```

Both test configs build the fixture library and `components/` into `.test-build/` first, so tests need no earlier build.

Build `@punyts/state`, `@punyts/expression`, `@punyts/stateui` and `@punyts/stateui-app` first.

## License
MIT
