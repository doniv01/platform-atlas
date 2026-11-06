# Deploying

Platform Atlas is a static site. `npm run build` writes everything a host needs to `dist/`: the two HTML pages, `src/`, `assets/`, `atlases/`, `vendor/`, the license files, a `.nojekyll` marker, and `build-manifest.json`, which lists a SHA-256 hash for every published file. Nothing is minified or rewritten, so what you test locally is what gets published.

Every URL in the site is relative. The same `dist/` works at a domain root (`https://atlas.example.com/`) and under a project path (`https://<owner>.github.io/<repository>/`).

## GitHub Pages

The repository ships with two workflows in `.github/workflows/`:

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` (**CI**) | Every push and pull request | Syntax and reference checks, the test suite, and a build, on Node 22 and 24 |
| `pages.yml` (**Deploy to GitHub Pages**) | Every push to `main`, or a manual start | The same checks, then uploads `dist/` and deploys it |

To publish:

1. Turn on Pages with GitHub Actions as the source, once. Either open **Settings → Pages** and set **Source** to **GitHub Actions**, or run:

   ```sh
   gh api -X POST repos/<owner>/<repository>/pages -f build_type=workflow
   ```

2. Push to `main`. The workflow builds and deploys the site. To redeploy without a push, open **Actions → Deploy to GitHub Pages** and select **Run workflow** on the default branch; the build job refuses to run from any other branch.
3. When the deploy job finishes, its summary shows the site URL. For this repository that is `https://doniv01.github.io/platform-atlas/`, and the overview page is `landing.html` under it.

GitHub Pages can publish from a private repository only on a paid plan. On a free account, make the repository public first.

To deploy only by hand, remove the `push` trigger from `pages.yml`.

The deploy job uses the `github-pages` environment and needs only the workflow's own token (`pages: write` and `id-token: write`). No personal access token is involved.

## Check a project path locally

```sh
npm run build
npm run preview -- --base /platform-atlas/ --port 4185
```

Open `http://127.0.0.1:4185/platform-atlas/` and `.../landing.html`, then follow both atlas links from the landing page. Each should open the app under the same prefix with the right atlas selected. The preview server redirects `/platform-atlas` to its trailing-slash form, and returns a real 404 for anything missing, so broken imports are not hidden behind an HTML fallback.

## Other static hosts

Upload the contents of `dist/` as they are. The host needs to serve `.mjs` files with a JavaScript content type (`text/javascript`); most do by default. No rewrites, redirects, or server functions are required.

## What the build checks

Before it replaces a previous `dist/`, the build stages a fresh copy and validates it at `/` and at a project path:

- every `src`/`href` in `index.html` and `landing.html`;
- every static and dynamic import, including the Three.js import map;
- every stylesheet `url()` and `@import`;
- every atlas listed in the registry, plus its artwork.

It rejects absolute URLs, `<base>` elements, and symlinks, and it refuses to overwrite a `dist/` it did not create. If validation fails, the previous build is left untouched.

`npm run build -- --pack generated/<name>` adds a generated exploratory pack to the build and makes it the default; see [SOURCE_WORKFLOW.md](SOURCE_WORKFLOW.md). Running `npm run build` without `--pack` restores the curated build.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The page loads but the city never appears | The browser console for a failed module request. Every path must be relative; a root-relative `/src/...` breaks project paths. |
| Every file returns 404 on Pages | That the workflow uploaded `dist/` and that **Settings → Pages** uses **GitHub Actions** as its source. |
| The deploy job is waiting or rejected | The `github-pages` environment's protection rules and the branch the workflow ran from. |
| Fonts or images are missing | That the build output lists them in `build-manifest.json`; rebuild after changing assets. |
| The 3D city does not render on one machine | WebGL2 support. The app falls back to an SVG rendering when WebGL2 is unavailable. |
