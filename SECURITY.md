# Security

## Reporting a vulnerability

Please report security issues privately using GitHub's **Security → Report a vulnerability** form on this repository. If that is not available, contact the maintainer privately through the contact details on their GitHub profile. Do not post exploit details or private code in a public issue.

Include the affected commit, your browser, Node.js, and Git versions, the steps to reproduce, the trust boundary involved, and a minimal sanitized example.

Report vulnerabilities in WooCommerce or Gumroad to those projects. An atlas describes source code; it is not evidence that any running service is vulnerable.

## Trust boundaries

**The site.** Platform Atlas is a static site with no backend, login, or write endpoint. File links open GitHub. Saved views and the scene finish stay in the browser's local storage. Copying and PNG export use standard browser features. Hosting providers have their own logging.

**The local server.** `npm start` and `npm run preview` bind to `127.0.0.1` by default and serve only an allowlist of static paths. They reject path traversal, hidden paths, and symlinks, and never expose `.cache/` or `generated/`. `--host 0.0.0.0` exposes the server to your network on purpose; it is a development server, not a hardened public one.

**Fetching sources.** `npm run source:fetch` accepts only the WooCommerce and Gumroad repositories over HTTPS. It pins the advertised commit, disables hooks and credential helpers, and never checks out or runs the fetched code.

**Scanning.** The scanner reads Git objects and parses bounded text and JSON. It never runs package scripts, Composer, Bundler, PHP, Ruby, or JavaScript from the scanned repository. It is a heuristic reader, not a sandbox, malware detector, or security audit, and large inputs can still take memory and time within the configured limits. `runtime: unverified` and `deployment: unverified` are statements of what is unknown, not of safety.

**Packs.** An `atlas-data.mjs` file is executable JavaScript. The generator only writes data, but review any pack you did not generate before serving it. The hashes in build and provenance manifests detect unexpected changes; they are not signatures.

**Builds.** The default build publishes only `index.html`, `landing.html`, `src/`, `assets/`, `atlases/`, `vendor/`, and the license files. A build with `--pack` also publishes that pack's paths and metadata, so review it before sharing. `.gitignore` is not an access control; the server and build enforce their own allowlists.

## Supported versions

Security fixes are made on the default branch. Older copies, forks, and cached source snapshots are not maintained.
