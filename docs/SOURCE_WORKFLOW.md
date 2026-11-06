# Source workflow

The curated WooCommerce and Gumroad packs stay pinned to their reviewed commits. The tooling here lets you fetch a newer upstream revision, generate an **exploratory** pack from it, and compare the two side by side. Generated packs are always labelled as inferred; refreshing a curated pack is a separate, manual review.

Everything below needs Node.js 22+ and Git, and runs from the repository root.

## 1. Fetch the latest upstream revision

```sh
npm run source:fetch -- --atlas woocommerce
npm run source:fetch -- --atlas gumroad
```

Only `woocommerce/woocommerce` and `antiwork/gumroad` are accepted. The command asks the remote for its default branch and full HEAD SHA, then fetches exactly that commit (depth one, no tags, no submodules) into a new bare repository under `.cache/sources/<atlas>-<sha>-<suffix>/`, and checks that the object it received matches the advertised SHA.

Nothing is checked out, installed, built, or run. Hooks, credential helpers, and global or system Git configuration are disabled for the fetch. `.cache/<atlas>-latest.json` then points at the new snapshot, and the snapshot records its own provenance. Older snapshots are kept; delete a specific `.cache/sources/...` folder yourself when you no longer need it.

## 2. Generate an exploratory pack

```sh
npm run atlas:generate -- --atlas gumroad --out generated/gumroad-review
```

Generation makes no network requests. It reads the last fetched snapshot, applies `scripts/scanner.config.json`, and writes a new folder under `generated/`. It refuses to overwrite anything, to write outside `generated/`, or to follow symlinks. Without `--out`, the folder is `generated/<atlas>-<full-sha>`.

| File | Contents |
| --- | --- |
| `atlas.json` | The full AtlasDocument: source SHA, generator and config hash, districts, nodes, evidence, relationships, and scan diagnostics |
| `atlas-data.mjs` | A viewer pack built from a ranked selection of the scanned nodes |
| `provenance.json` | Repository, SHA, branch, fetch and generation times, the document hash, and counts |
| `scanner.config.json` | The exact configuration used, including exclusions and limits |
| `README.md` | A short summary of what was scanned and how to preview it |

The viewer shows at most 180 nodes by default, chosen to represent every district first and then by connectedness, manifests, evidence, and size. Raise the cap carefully (the hard limit is 1,000):

```sh
npm run atlas:generate -- --atlas gumroad --out generated/gumroad-250 --max-nodes 250
```

`--config path.json` merges overrides into the defaults; unknown keys and invalid limits are rejected.

## 3. Preview it next to the curated pack

```sh
npm run build -- --pack generated/gumroad-review
npm run preview
```

The build copies the pack into `dist/atlases/gumroad-exploratory/`, adds it to the switcher, and makes it the default. The curated packs stay available from the switcher and the landing page. `npm run build` without `--pack` returns `dist/` to the curated site. The source `index.html` and `atlases/` folder are never modified.

A generated `atlas-data.mjs` is executable JavaScript like any pack. The generator only writes data, but review any pack you did not generate yourself before serving it.

## What the scanner understands

- JavaScript and TypeScript imports and requires
- A subset of PHP includes and named symbols
- Ruby `require` and `load`
- `package.json`, `composer.json`, and `Gemfile` manifests

A relationship is recorded only when both ends resolve to scanned files or local packages. File presence is `observed`, a manifest dependency is `declared`, and a resolved import is `heuristic`; in the viewer, inferred and declared edges are labelled that way. Pattern matching can miss multiline syntax, aliases, framework autoloading, Rails conventions, PHP hooks, generated files, and conditional loading, and it can misread comments or strings. Direction follows the source syntax, not runtime order. Generated packs have no authored walkthrough.

Default limits: 5,000 nodes, 20,000 edges, 1 MiB per file, 128 MiB of source, 100,000 tracked entries, and 32 MiB of Git tree output. Dependency, vendor, build, distribution, coverage, and Git folders are excluded. Symlinks, submodules, unsupported languages, and non-UTF-8 files are skipped. Check `scan.skippedFiles`, `scan.incomplete`, and the diagnostics before describing what a scan covers.

## Scan any local repository

```sh
npm run scan -- --repo /path/to/repository --ref HEAD --output generated/my-scan.json
```

This reads committed objects from a checkout or bare repository (uncommitted changes are ignored) and writes an AtlasDocument. Omit `--output` to print to stdout. It never fetches, checks out, or builds anything, and it only writes new files inside `generated/`. Remote URLs with credentials or non-GitHub hosts are not copied into source links. To turn a scan into a pack for the viewer, follow [DATA_CONTRACT.md](DATA_CONTRACT.md).

## Refreshing a curated pack

A newer SHA alone is not a reviewed update. To move a curated pack to a new commit:

1. Fetch the new revision and generate an exploratory pack. Read its provenance and diagnostics.
2. Check every curated path and line against the new SHA, including renamed or deleted files, route registration, dependency wiring, feature flags, and storage selection. A matching file name is not enough.
3. Re-check every relationship and every walkthrough chapter. Remove claims that no longer hold, label conditional and external boundaries, and note why any interpretation changed.
4. Update the pack's revision, evidence, descriptions, and dates together. For WooCommerce, update both `atlas-data.mjs` and `woo-source-data.mjs`.
5. Update the revision links in `README.md`, `landing.html`, and `THIRD_PARTY_NOTICES.md`, then run `npm run check`, `npm test`, and `npm run build`, and click through both atlases.

None of these commands commit, push, or deploy anything.
