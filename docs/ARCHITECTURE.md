# Architecture

Platform Atlas is a static site: two HTML pages, a handful of ES modules, three stylesheets, data packs, and a vendored copy of Three.js. There is no framework, bundler, or runtime dependency. Everything a visitor needs is fetched from the same origin, so it works from a local server, GitHub Pages, or any static host.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `index.html` | The app's markup: map stage, rail, header, dock, popovers, panels, dialogs. Also the Three.js import map, the default pack (`<meta name="atlas-module">`), and the atlas registry (`<script id="atlas-registry">`). |
| `landing.html` | The overview page. It links into the app with relative `./?atlas=...` URLs. |
| `src/app.mjs` | Loads the selected pack and owns all state, rendering, search, filters, walkthroughs, camera, sharing, saving, and keyboard handling. |
| `src/city-three.mjs` | The WebGL2 city: towers, district pads, connections, glow, selection ring, the HTML label layer, the camera model, and the entrance animation. |
| `src/chrome.mjs` | Presentation behavior that does not depend on atlas state: the scene finish setting, source-panel tabs, the chapter list, and the walkthrough header and progress. |
| `src/layout-flat.mjs` | Deterministic, non-overlapping layouts for the flat diagram and flat walkthroughs. |
| `src/palette.mjs` | District colors for each finish, and the rules for resolving them from a pack. |
| `src/icons.mjs` | A local subset of Phosphor icons (regular, bold, and fill), plus node-type defaults. |
| `src/motion-lite.mjs` | Camera tweening and small Web Animations helpers, all of which respect reduced motion. |
| `src/landing.mjs` | Icons and gentle reveal animations for the landing page. |
| `src/styles/foundation.css` | Base primitives: reset, labels, menus, popovers, panels, dialogs, flat mode, and the SVG fallback. |
| `src/styles/app.css` | The current visual theme on top of the foundation, plus every responsive breakpoint. |
| `src/styles/landing.css` | The landing page. |

## Startup

1. `app.mjs` reads the registry. A valid `?atlas=<id>` selects `./atlases/<id>/atlas-data.mjs`; otherwise the `atlas-module` meta tag names the default.
2. The pack is imported with a URL resolved against the page, so the same code works under any path prefix.
3. The renderer is created by dynamically importing `city-three.mjs`. If WebGL2 or the module is unavailable, the app keeps going with its SVG renderer.
4. Repository identity (name, artwork, pinned-commit link, the switcher menu) is applied from the pack and its registry entry. Icons are rendered into every `[data-icon]` placeholder.
5. Event handlers are bound, any saved view is restored, and `chrome.mjs` applies the scene finish, which triggers the first full render.
6. A `#journey` hash opens the walkthrough. Unless a saved view was restored, the entrance animation plays once per session.

## State and rendering

All mutable state lives in one `state` object in `app.mjs`: the lens (system, folders, or walkthrough), display mode (3D or flat), camera, selection, hover, search query, status filter, label and spacing settings, walkthrough position, and any moved modules.

`renderAll()` brings every part of the interface in line with that state: the lens and mode controls, panels, search results, the walkthrough guide, the module list, the source panel, the camera readouts, and the map. Changes that only move the camera use `scheduleRenderMap()`, which coalesces to one map render per animation frame.

`renderMap()` has two outputs:

- **The SVG layer** (`#atlas-map`). In 3D mode it holds only invisible hit targets for towers and district pads, which give keyboard focus, pointer hit-testing, and accessible names to what the GPU draws. In flat mode, and whenever WebGL2 is unavailable, it draws the whole map.
- **The GPU scene.** `collectSceneData()` describes every visible module (position, color, height, footprint, selection and walkthrough state), connection, and district, and `gpuCity.sync()` applies it.

Rebuilding the SVG layer would normally drop keyboard focus, so `renderMap()` hands focus to the same module's new element.

## The 3D city

`createCity()` returns the `gpuCity` interface that `app.mjs` drives: coordinate conversion (`atlasToWorld`, `worldToViewBox`), hit geometry (`hitPolygon`, `groundPolygon`), camera helpers (`panDeltaFromScreen`, `panForWorld`, `zoomAtScreen`, `fitView`, `setCamera`), `setAppearance`, `sync`, `capture`, and lifecycle (`playIntro`, `setIntroSpeed`, `pause`, `setActive`, `dispose`).

- Towers, crowns, plinths, shadows, and glows are instanced meshes with custom shaders, sized for up to 1,000 modules (the generated-pack limit).
- Connections are tube geometry with an animated flow. The flow is decoration, not measured traffic.
- Bloom post-processing gives the Luminous finish its glow; Matte turns it off; Architectural keeps a little.
- Labels are HTML elements positioned over the canvas each frame. Placement runs in passes: priority labels (selected, hovered, the current call, walkthrough chapters) first, then district captions, then everything else. Labels avoid each other and any element marked `data-label-shield` (the rail, header, panels, and controls). A colliding chapter label first tries a nearby spot, then collapses to its chapter number.
- The camera is described by bearing, pitch, zoom, pan, and depth, the same model the SVG renderer uses. `fitView()` solves for the zoom and pan that put a set of points inside a screen rectangle; walkthroughs use it to frame the whole path beside the panel.

## Visual encoding

| Channel | Encodes | Where |
| --- | --- | --- |
| Color | District (identity only, never health or status) | `palette.mjs`, `district.appearanceColors` |
| Height | Number of source files, on a bounded curve | `nodeHeight()` in `app.mjs` |
| Footprint | Number of connections, on a square-root curve | `nodeFootprintFactor()` in `app.mjs` |
| Line style | Relationship type: call, response, event, or write | `EDGE_STYLE` in `app.mjs` |

Layout positions are presentation, not data. The map offers even spacing, the pack's curated positions, or a folder grid. Walkthroughs use positions authored in the pack (`journey.positions`); without them, the flow is laid out automatically as a snaking path.

## Atlas packs

A pack is a module that exports `ATLAS_CONTRACT` (the allowed node types, edge types, statuses, and truth values) and `ATLAS_DATA` (meta, districts, nodes, edges, flows, and walkthroughs). Packs are pure data; nothing in `src/` refers to a specific repository's modules. See [DATA_CONTRACT.md](DATA_CONTRACT.md) for the full shape.

The WooCommerce pack is an adapter over a frozen evidence model in `woo-source-data.mjs`. The Gumroad pack is authored directly.

## Tooling

| Script | Purpose |
| --- | --- |
| `scripts/serve.mjs` | Local server for the source (`npm start`) or `dist/` (`npm run preview`). Serves only an allowlist of static paths, rejects traversal and symlinks, and supports a project-path base. |
| `scripts/build.mjs` | Stages a copy of the static allowlist, validates every reference at two base paths, writes `build-manifest.json`, and swaps it into `dist/` only on success. |
| `scripts/check.mjs` | Syntax-checks every module and validates references without building. |
| `scripts/manifest.mjs` | The shared allowlist, registry reader, and reference validator. |
| `scripts/fetch-source.mjs` | Fetches the default-branch HEAD of WooCommerce or Gumroad into a bare, pinned snapshot under `.cache/`. |
| `scripts/atlas-generate.mjs` | The scanner (`npm run scan`): reads committed Git objects and emits a deterministic AtlasDocument JSON. |
| `scripts/generate-pack.mjs`, `scripts/viewer-pack.mjs` | Turn a fetched snapshot into an exploratory viewer pack under `generated/`. |
| `scripts/lib/` | Hardened Git invocation and safe path helpers. |

## Tests

`npm test` runs offline with Node's built-in test runner:

- `viewer-data.test.mjs` checks both packs for unique IDs, valid references, flows that match their edges, and valid walkthrough bounds.
- `flat-layout.test.mjs` checks that flat cards never overlap.
- `palette.test.mjs` and `scene-style.test.mjs` cover the finishes and the tower geometry.
- `build.test.mjs` covers the build, the reference validator, and the server, at the root and under a project path.
- `source-tools.test.mjs` covers fetching, scanning, and pack generation against fixture Git objects. No network, checkout, or source code execution is involved.

## Conventions

- Keep every URL relative, and keep Three.js behind the import map.
- Put repository-specific details in the pack or its registry entry, never in `src/`.
- Prefer native elements (`button`, `details`, `dialog`) and keep keyboard, focus, and reduced-motion behavior intact.
- New files under `src/`, `assets/`, `atlases/`, and `vendor/` are published automatically; anything else stays out of the build.
