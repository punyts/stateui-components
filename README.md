# @punyts/stateui-components

The StateUI component library: atoms, molecules, composites and composed components, built with `@punyts/stateui-app`.

## Layout
- `components/atoms/`, `molecules/`, `composites/`, `composed/`: one folder per component, by the `@punyts/stateui-app` file convention. The group folders are grouping only; `npm run build` creates them when they are missing, because git does not keep empty folders. Nothing but component files may sit in `components/`, so tests live in `test/`.
- `src/shared/`: CSS partials and base controllers used by several components.
- `scripts/`: `build.mjs` (the `npm run build` step) and `buildComponents.mjs` (`buildLibrary` plus the `register` helper).
- `test/`: the harness (`test/harness/`) and the fixture component `probe` (`test/fixtures/components/atoms/probe/`). The fixture is test-only and never part of `dist/`.

## Build
`npm run build` compiles `src/` with `tsc`, then runs `buildLibrary` over `components/` into `dist/components/` (modules, `catalog.json`, locale overlays, `index.js`) and writes `dist/register.js`.

## Package exports
- `.`: `COMPONENT_GROUPS`.
- `./components`: `components`, `componentTokens` and `registerAll()`.
- `./components/*`: a built module, controller or locale overlay.
- `./catalog.json`: the component catalog.
- `./register`: `register(window)` defines every component on the page. StateUI defines elements on the global registry, so `window` must be the page's own; it throws otherwise, and a component that is already defined is skipped.

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
