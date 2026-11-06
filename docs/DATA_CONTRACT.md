# Data contract

Platform Atlas uses two formats:

- **The viewer pack** (`atlases/<id>/atlas-data.mjs`) is what the app loads. A curated pack summarizes architecture: one node can stand for several files, and every claim carries its evidence and its limits.
- **The AtlasDocument** (`npm run scan` output, JSON) is what the scanner produces. A node is a tracked file or manifest, and relationships are inferred from source text.

They are deliberately different. A scan is raw material for a pack, not a substitute for one.

## Viewer packs

### Registering a pack

Every pack has an entry in the registry inside `index.html`:

```json
{ "id": "gumroad", "title": "Gumroad", "repository": "antiwork/gumroad", "summary": "Buying one paid digital product, from storefront to receipt.", "art": "./assets/repositories/gumroad-3d.png" }
```

| Field | Use |
| --- | --- |
| `id` | Matches the folder name and the `?atlas=` value. Lowercase, `[a-z0-9][a-z0-9-]{0,63}`. |
| `title` | Shown in the atlas switcher. |
| `repository` | `owner/name`, shown in the switcher and used to match the default pack to its entry. |
| `summary` | Tooltip in the switcher. |
| `art` | Optional image shown next to the repository name. Falls back to `mark`, then to the generic repository mark. |

The `atlas-module` meta tag in `index.html` names the default pack. The build checks that every registered pack and its artwork exist.

### Exports

A pack exports two objects:

- `ATLAS_CONTRACT` declares the vocabulary the pack uses: `nodeTypes`, `edgeTypes`, `statuses`, and the allowed `truth` values for `repository`, `runtime`, and `deployment`.
- `ATLAS_DATA` holds the content below.

A pack may import `../../src/palette.mjs` to resolve district colors for the three finishes. Packs must not import anything else from `src/`.

### `meta`

| Field | Required | Meaning |
| --- | --- | --- |
| `generatedFor` | yes | `owner/name` of the mapped repository |
| `repositoryUrl` | yes | `https://github.com/owner/name` |
| `repositoryRevision` | yes | Full 40- or 64-character commit SHA. Every file link uses it. |
| `title`, `displayName` | yes | Full title and the short name shown in the header |
| `storageNamespace` | yes | Unique prefix for saved views in local storage |
| `defaultNodeId`, `defaultFlowId`, `defaultJourneyId` | when present | Must point at objects in the pack |
| `journeyKicker` | no | Short label for the walkthrough, read by screen readers |
| `nodeIcons` | no | Map of node ID to a Phosphor icon name in `src/icons.mjs` |
| `updated` | no | Date the curation was last reviewed |

Generated packs also set `evidenceMode: "generated-exploratory"`, `sourceNodeCount`, `viewerNodeCount`, edge counts, and `scanIncomplete`. The app uses them to describe a generated pack as ranked and inferred rather than curated.

### `districts`

`{ id, label, color, appearanceColors, purpose }`. Resolve colors with `resolveDistrictColors()` from `palette.mjs` to get all three finishes. A literal `color` is kept as is in every finish.

### `nodes`

| Field | Meaning |
| --- | --- |
| `id`, `label`, `shortLabel` | Stable ID, full name, and the name used on map labels |
| `type` | One of `ATLAS_CONTRACT.nodeTypes` (for example `surface`, `route`, `service`, `database`) |
| `district`, `layout` | District ID, and the folder group used by the **Folders** grouping |
| `status` | One of `ATLAS_CONTRACT.statuses` (see below) |
| `truth` | `{ repository, runtime, deployment }`, each from the contract's `truth` lists |
| `position` | Finite `{ x, y, z }`. `x` and `y` place the module on a 0–100 grid; `z` is a layout hint, not data. |
| `paths` | Repository-relative files or folders (folders end with `/`). Never absolute, never `..`. |
| `purpose`, `trace`, `risks`, `boundaries`, `tags` | What it does, how it works step by step, what can go wrong, what the atlas cannot claim, and search terms |
| `packet` | `{ direction, schema }`: the evidence object shown under **Evidence shape**, including source claims with path, line, and symbol |

Tower height is computed from the number of `paths`, and footprint from the number of connections. Neither is stored in the pack.

### Statuses

| Value | Shown as | Use it when |
| --- | --- | --- |
| `active-code` | Source present | The code is in the repository and on the described path |
| `gated` | Conditional | A setting, flag, extension, or request decides whether it runs |
| `external` | External | It is a boundary with another system |
| `parked` | Declared | A manifest or build declares it, but the code is not in the checkout |

Runtime and deployment stay `unverified` (shown as **Not checked**) unless you have separate evidence, which the curated packs do not claim.

### `edges`

`{ id, from, to, type, label }` plus optional truth and evidence. `from` and `to` must be existing node IDs, and `type` must be in `ATLAS_CONTRACT.edgeTypes`. The type decides the line style: `response` is dashed; `event` and `broadcast` are dotted; `write` is a rose pulse; everything else is solid.

### `flows`

`{ id, label, description, status, nodeIds, edgeIds, cautions }`. `edgeIds` has exactly one fewer entry than `nodeIds`, and edge *n* must run from node *n* to node *n + 1*. A node may appear more than once.

### `journeys` (walkthroughs)

Optional. Each walkthrough tells the story of one flow:

| Field | Meaning |
| --- | --- |
| `id`, `label`, `status`, `flowId` | Identity, the title shown in search and the module index, and the flow it follows |
| `shortLabel` | Title of the walkthrough panel, for example "The checkout walkthrough" |
| `description` | One-paragraph summary |
| `mapHeading`, `mapSummary` | Optional heading and summary for screen readers while the walkthrough is open |
| `entryBoundary`, `completionBoundary` | Where the story starts and stops, and what lies outside it |
| `positions` | Optional map of node ID to `{ x, y, z }` for a hand-drawn walkthrough layout. Without it, the app lays the flow out as a snaking path. |
| `steps` | The chapters, in order |

Each step is `{ id, title, description, boundary, startHop, endHop, stageNodeId }`. `startHop` and `endHop` are inclusive indexes into the flow's `nodeIds`; `stageNodeId` is the node that carries the chapter number on the map.

## Adding a pack

1. Pick an ID and create `atlases/<id>/atlas-data.mjs`.
2. Pin a full commit SHA. Describe modules with their source paths, purpose, evidence, and explicit limits. Keep IDs stable once published, because share links use them.
3. Add the registry entry to `index.html`, with artwork if you have a clear right to use it. To make it the default, update the `atlas-module` meta tag.
4. Add flows and walkthroughs only after checking each relationship against the source.
5. Run `npm run check`, `npm test`, and `npm run build`. The pack consistency test runs automatically for every folder in `atlases/`.
6. Credit the source repository and its license in `THIRD_PARTY_NOTICES.md`.

## The scanner's AtlasDocument (schema version 1.0.0)

[`atlas.schema.json`](atlas.schema.json) documents the shape. Output is canonical JSON with stable key order and IDs derived from source identities, so scanning the same objects with the same configuration always gives the same result.

| Field | Contents |
| --- | --- |
| `schemaVersion` | `1.0.0` |
| `source` | Provider (`local-git`), repository identity, sanitized GitHub URL or null, requested ref, resolved commit |
| `generator` | Name, version, and the SHA-256 of the effective configuration |
| `scan` | Tracked, eligible, and analyzed counts, analyzed bytes, skipped files, an `incomplete` flag, limits, and diagnostics |
| `districts` | Groups by directory or package, with paths and counts |
| `nodes` | One per module or manifest: path, language, size, district, truth, evidence, optional package name |
| `edges` | Import, include, require, or dependency relationships with label, confidence, truth, and evidence |

Evidence always has a repository-relative `path`, a `line`, and the `extractor` that found it. A file's presence is `observed`; a resolved import is `heuristic`; a manifest dependency between scanned packages is `declared`. Runtime and deployment stay `unverified`. Confidence labels name the kind of extractor, not a measured probability.

## Extending the scanner

Language support lives in `scripts/atlas-generate.mjs`: eligible extensions, bounded text parsing, safe repository-relative resolution, and named extractors. Keep the Git-object input; never import, install, or execute the target's code. Add fixtures for both resolved relationships and ambiguous cases, and bump the generator version when output changes. `scripts/viewer-pack.mjs` decides how scanner fields appear in a generated pack.
