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
- `.`: `COMPONENT_GROUPS`.
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

## Bare controls: `input`, `textarea`
Both `@include "control.css";` from `src/shared/css/` (inlined by the build's `sharedCssDir`, then linted). `input` has shared `size`, `disabled`, `readonly`, `required`, `inputType`, `min`, `max`, `step`, `maxLength`, `_placeholder`, `_label` (accessible name) and `value`; it raises `change` (blur or Enter) and `input` (each keystroke) and takes the `focus` and `clear` commands. `textarea` adds `rows` and `autoGrow`. Typing writes `value` through `bind`, so a `<-value` link writes `$.data`; `inputType: "number"` writes a number. Tokens `radius`, `border` and `padding.inline` are in the group `control`.

## Testing components
`mountComponent(name, nodeState, options?)` (`test/harness/mountComponent.ts`) mounts one component through `mountApp` in a browser test. `options` are `mode`, `brand`, `motion` (overlay names) and `locale`. It returns `{ element, host, store, setTheme(kind, name), setLocale(code), dispose }`; call `mountComponent.unmountAll()` in `afterEach`. It throws with the validation errors when the node does not mount.

```
npm run build
npm test            # node tests (happy-dom)
npm run test:browser  # Chromium tests
```

Both test configs build the fixture library and `components/` into `.test-build/` first, so tests need no earlier build.

Build `@punyts/state`, `@punyts/expression`, `@punyts/stateui` and `@punyts/stateui-app` first.

## License
MIT
