# Changelog

## 1.0.0 - 2026-11-05

First public release.

### Atlases

- **WooCommerce** at [`5d86d8f40b68`](https://github.com/woocommerce/woocommerce/tree/5d86d8f40b68039d16419049a40a3abf065ca71c): 48 modules in 8 districts, 69 connections, 6 source flows, and a four-chapter walkthrough of placing an order with the Checkout Block.
- **Gumroad** at [`29bb68b1c378`](https://github.com/antiwork/gumroad/tree/29bb68b1c37884b66a07062c7dcf9e19a71766d8): 47 modules in 10 districts, 40 connections, and a twelve-chapter walkthrough of buying a digital product.
- Switch between them from the repository name in the header or with `?atlas=`.

### Viewer

- A 3D city rendered with WebGL2, with an SVG fallback. Color is the district, height follows the number of source files, and a wider base means more connections.
- **Map**, **Modules**, **Walkthrough**, and **Filters** in a navigation rail that becomes a bottom bar on phones.
- A source panel with **Overview** and **Files** tabs, file links pinned to the mapped commit, and one-click **Copy context**.
- Search, status filters, a flat diagram, saved views, shareable links to a module, and PNG export.
- Three scene finishes: **Luminous**, **Matte**, and **Architectural**.
- Keyboard access to towers and panels, reduced-motion support, and screen-reader labels.
- A landing page (`landing.html`) with links into both atlases.
- A Content-Security-Policy on both pages, so scripts, fonts, and images load only from the site itself.

### Tooling

- `npm run scan` describes any local repository's files and imports from its Git objects, without running its code.
- `npm run source:fetch` and `npm run atlas:generate` build an exploratory pack from the latest WooCommerce or Gumroad commit to compare with the curated one.
- `npm run build` validates every asset and import at the domain root and under a project path before writing `dist/`.
- CI on Node.js 22 and 24, and a manual GitHub Pages deployment workflow.
