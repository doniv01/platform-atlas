# Contributing

Thank you for helping make large codebases easier to read. The most useful contributions are corrections to the source evidence, clearer explanations, accessibility and usability fixes, focused performance work, and new atlases with well-supported claims.

## Set up

You need Node.js 22 or newer. There are no dependencies to install.

```sh
npm start        # http://127.0.0.1:4183, serves the source as you edit
npm run check    # syntax and reference checks
npm test         # offline tests
npm run build    # writes dist/
npm run preview  # serves dist/ at http://127.0.0.1:4184
```

To check a GitHub Pages project path, run `npm run preview -- --base /platform-atlas/ --port 4185`.

The code layout is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Keep runtime code in `src/`, styles in `src/styles/`, assets in `assets/`, vendored code in `vendor/`, and atlas data in `atlases/<id>/`. Use relative URLs, keep Three.js behind the import map, and prefer built-in browser and Node APIs. The project has no runtime npm dependencies or bundler, and it should stay that way.

## Correcting an atlas

For a change to a curated claim, include:

- the atlas and the full pinned SHA;
- the file and line range that supports the change;
- the current claim and the corrected one;
- whether it is an observed fact, an interpretation, a conditional branch, or something the atlas cannot verify.

A static relationship is not proof of runtime behavior, so do not describe it as one. Keep node IDs stable when their meaning is unchanged, because share links depend on them. Update dependent edges, flows, walkthrough chapters, and defaults together. [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) and [docs/SOURCE_WORKFLOW.md](docs/SOURCE_WORKFLOW.md) cover the pack format and how to review a newer upstream revision.

## Changing the interface

Keep the vocabulary consistent: **Map**, **Modules**, **Walkthrough**, **Filters**, and the source panel's **Overview** and **Files**. Keep keyboard access, focus return, visible labels, reduced-motion behavior, and the separation between source facts and unchecked runtime claims intact.

Before opening a pull request, check by hand:

- both atlases, from the switcher and from `?atlas=` links;
- the map, the module index, a walkthrough (chapters and individual calls), and the source panel with its file links;
- search, filters, flat mode, the three finishes, share, and save;
- a narrow phone-sized window and a desktop window;
- keyboard only: <kbd>Tab</kbd> through the rail, towers, panels, and dialogs, and confirm focus returns when they close.

Include before-and-after screenshots for visual changes, and say which browser, window size, input method, and atlas you checked.

## Tests

Tests run offline. They use small fixture Git object databases and never run the code being scanned, make commits, or touch the network. Keep it that way. For scanner changes, add a fixture for a supported construct and for a failure case. Static tests do not replace checking the interface in a browser.

## Pull requests

- Explain the problem and the resulting behavior.
- Run `npm run check`, `npm test`, and `npm run build`, and mention anything you could not verify.
- Leave out `.cache/`, `generated/`, `dist/`, secrets, and machine-specific paths.
- Keep license notices intact, and record the origin, version, and license of any new vendored code or asset.
- Keep unrelated changes in separate pull requests.

When reporting a bug, include the atlas, the URL (including any `?` options and `#journey`), your browser and operating system, the steps, and what you expected to happen. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
