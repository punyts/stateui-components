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

## Actions: `button`
- `button`: shared `tone` (default `accent`), `variant` (default `solid`) and `size`; `icon` (type `icon`), `iconPosition` (`start`, `end`, `only`; reflected), `disabled`, `busy`, `fill` (reflected; stretches to the container) and `_title`. Tokens `radius`, `padding.inline` and `gap` (group `button`).
- Variants paint only from `--tone`, `--tone-soft` and `--tone-on`: `solid` fills with the tone, `soft` with the soft tone, `outline` has a tone border and no fill, `ghost` has neither, `link` looks like underlined text with no padding.
- `press` (no detail) fires once per click, Enter or Space, and not while `disabled` (native `disabled`) or `busy` (the button stays focusable). The `focus` command focuses the native button. With `iconPosition: "only"` no label is drawn and `_title` is the `aria-label`.
- `busy` draws a spinner from the button's own CSS over the content, which stays laid out but hidden, so the width does not change. Its duration is a `--ui-motion-duration-slow` multiple, so `motion: "reduced"` stops it.
- The icon is drawn by the `icon-paths` mixin of `icon`, whose attribute value names the property that holds the icon name (`icon-paths="icon"`; empty means `name`). It inherits `--icon-size` and the text colour from the button.

## Bare controls: `input`, `textarea`, `select`, `checkbox`, `switch`
Both `@include "control.css";` from `src/shared/css/` (inlined by the build's `sharedCssDir`, then linted). `input` has shared `size`, `disabled`, `readonly`, `required`, `inputType`, `min`, `max`, `step`, `maxLength`, `_placeholder`, `_label` (accessible name) and `value`; it raises `change` (blur or Enter) and `input` (each keystroke) and takes the `focus` and `clear` commands. `textarea` adds `rows` and `autoGrow`. Typing writes `value` through `bind`, so a `<-value` link writes `$.data`; `inputType: "number"` writes a number. Tokens `radius`, `border` and `padding.inline` are in the group `control`.

### `select`, `checkbox`, `switch`
The same `control` token group and the same `size`, `focus` and `clear`. `select` takes `options`, `optionValue` (`value`), `optionLabel` (`label`), `multiple`, `value`, `disabled` and `required`. `options` is a data array (normally `"<-options": "$.data.statuses"`; its labels are not translated) or a keyed map `{ "open": { "_label": "Open" } }` whose key is the value and whose `_label` is content, so a locale overlay translates it; an entry that holds `_label` is treated as a map entry. The value is the option value as the data holds it (a number stays a number); with `multiple` it is an array. The chevron is drawn with CSS. `checkbox` and `switch` have `checked` (written through `bind`), `disabled`, `readonly` (a click or Space changes nothing), `required` and `_label` (accessible name); `switch` has `role="switch"` and `aria-checked`. Each raises `change` with the new value, after the data is written; `clear` sets `false` (`select`: `""` or `[]`).

## Molecules: `stat`, `avatar`
- `stat`: shared `tone` (none by default) and `size` (`sm`, `md`, `lg` set the figure's type role); `format` (`number`, `percent` from a 0 to 1 value, `currency`, `duration` from seconds as `m:ss` or `h:mm:ss`), `currency` (an ISO 4217 code, no default, required through `requiredWhen` when `format` is `currency`), `trend` (`up`, `down`, `flat`), content `_label` and `_unit`, and data `value` and `delta` (a number or numeric text; no value shows a dash). The shared formatter `src/shared/format/format.ts` formats with `Intl` for `$.locale`, so a data write or a language switch reformats. The controller writes the runtime properties `shown`, `deltaShown` (signed) and `trendIcon` (`chevron-up`, `chevron-down`, `minus`), which the view shows; the glyph is drawn by the icon component's `icon-paths` mixin, and it takes the tone colour only when `tone` is set.
- `avatar`: shared `size` (the control height), `shape` (`circle`, `square`), content `_name` and `src` (a `url` narrowed to `data:` by a `pattern` validator). The picture shows when `src` is set; otherwise the initials of the first and last word of `_name` (one word gives one letter), written by the controller into the runtime property `initials`. The element is `role="img"` with `_name` as its label.

## Fields: `textField` (the field base)
- Folder `components/molecules/text-field/` (kebab, as the convention requires; the component is `textField`, the tag `ui-text-field`). `textField` has `_label`, `_placeholder`, `_help`, `icon`, `disabled`, `readonly`, `inputType` (`text`, `email`, `password`, `url`, `tel`, `search`), `value`, shared `size` (default `md`) and `density`, `titlePosition` and `width`. Typing writes `value` through `bind`, so a `<-value` link writes `$.data`.
- `titlePosition` (`top` by default, `left`, `inner`, `hidden`) is `reflect: true`, so it is the host attribute `title-position` and the stylesheet lays out from it: `top` puts the label above, `left` in a column of `label.width` beside the control, `inner` over the top-left corner inside the control box (the control gets room for it), `hidden` clips the label to one pixel so it stays the control's accessible name (`<label for>`). `width` is `fill` (default), `auto` (fit the content) or a whole number of `ch` for the whole field; a value that is none of these means `fill` (a shape validator cannot express a union of words and a number).
- Help and error: the control's `aria-describedby` names `help` and `error` only while their text is shown. The error sits in a `role="status"` `aria-live="polite"` wrapper that is always in the DOM, so a message that appears is announced. `error` (the failing rule's name, empty for none) is a runtime property, as is `message` (the text of `_errors` for that rule, kept by the controller because a binding on a map does not re-run for a change inside it) and `glyph`; a node that sets one is `SUI-STATE-RUNTIME`. `_errors` is a content map with an English default per rule (`required`, `minLength`, `maxLength`, `min`, `max`, `pattern`) and a German overlay; one rule can be overridden with `_errors: { pattern: "Not a valid code" }`. The rules that set `error`, `touched`, `dirty` and the events and commands are E4.9 and E4.31.
- Tokens, group `field`: `label.gap` (`{space.gap.sm}`), `label.width` (`calc({size.control.lg} * 3)`, used when the title is on the left) and `help.size` (`{text.caption.size}`). The control uses the `control` group of `control.css`. `density` re-declares the spacing tokens on the host, so the gaps and the control padding shrink with `compact`.
- Icon: `icon` is copied by the base controller to the runtime `glyph.name`, and the view draws `<ui-icon state=".glyph" size="{{ $.size }}">`; the icon is absent while `icon` is empty.
- The base, for the six other fields: `src/shared/css/field.css` (`@include "field.css";` after `control.css`) lays out the classes `field`, `label`, `box`, `icon`, `messages`, `help` and `alert` from the host attributes; `src/shared/field/field.ts` has `createField(context)` (keeps `glyph` and `message` in step, returns `widthOf` and `describedBy` for the view) and the pure `fieldWidth`, `fieldDescribedBy` and `fieldMessage`. A field's controller is `return createField(context)` plus whatever its control needs; its view repeats the small skeleton in `text-field.view.html` (the build has no HTML include) with its own control in `.box`.
- Shared code in controllers: a controller is transpiled and never run by the build, and may not import a sibling file, but a relative import of a file `scripts/buildComponents.mjs` emits is fine. `buildComponents` transpiles every `.ts` under `src/shared/` (tests and `.d.ts` left out) to `shared/<folder>/<file>.js` beside `components/` (in `dist/` and in each test build), so a controller writes `import { createField } from '../shared/field/field.js'`. Unlike `../icons/core.js` this needs no per-file list, and the shared code is type-checked by `tsc` because it lives in `src/`.

## Indicators: `badge`, `spinner`, `progress`
- `badge`: shared `tone` (default `neutral`), `variant` (default `soft`) and `size`; `icon`, `dot`, `_text` and the data property `count`, shown instead of `_text` whenever it is set (0 included) and capped by `max` (default 99) as `99+`. With `dot` a small round dot replaces the label and `_text` becomes its accessible name. The icon is drawn by the `icon-paths="icon"` mixin that `icon.controller.ts` registers, so the library must contain `icon`.
- `spinner`: `tone`, `size` and `_label` (default `Loading`, the accessible name of its `role="status"` ring). The turn takes twice `motion.duration.slow` as `animation-duration`, so `motion: "reduced"` (which sets the durations to `0ms`) stops it.
- `progress`: `tone` (default `accent`), `size`, `_label`, `value` (default 0), `max` (default 100) and `indeterminate`. The track is `role="progressbar"` with `aria-valuemin`, `aria-valuemax` and `aria-valuenow`; `aria-valuenow` is left out while indeterminate, when the bar slides instead of filling. The bar width is `value / max` clamped to 0 to 100 percent.

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
