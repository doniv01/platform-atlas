# User guide

Platform Atlas shows one repository at a time as a city of source modules. This guide covers every part of the interface. In the app, **About & help** has a short version and **Settings → Take the tour** walks through the main controls.

## The screen

| Area | What is there |
| --- | --- |
| Header | The repository name and artwork (select it to switch atlases), the **Source repository** link with the pinned commit, **Search**, a link to this project on GitHub, and **Share** |
| Left rail | **Map**, **Modules**, **Walkthrough**, and **Filters**; **Settings** and **About & help** at the foot. On a phone the rail becomes a bottom bar. |
| Bottom dock | **Pan**, **Orbit**, and **Move**; **3D** or **Flat**; labels on or off; fit the current view |
| Bottom right | Zoom and camera presets, the **Legend**, and **Angle & layers** |
| Bottom left | A live count of the modules, districts, and connections on the map |

## Reading the city

- **Towers are modules.** A module is a meaningful unit of the codebase, such as a controller, a service, or a group of related files, not a single file.
- **Color is the district**, the part of the system a module belongs to. The legend lists every district.
- **Height follows the number of source files** behind the module. **A wider base means more connections.**
- **Connections take the color of the module they start from.** Solid lines are calls, requests, and reads; dashed lines are responses; dotted lines are hooks, events, and async jobs; a rose pulse is a write.

The city is a picture of the source at one commit. It does not show traffic, load, or which features a particular site has turned on.

## Moving around

- **Pan** (default): drag empty space to slide the city. Scroll or pinch to zoom toward the pointer.
- **Orbit**: drag to turn around the city; drag up to look straight down.
- **Move**: drag a tower or a district pad to rearrange it. **Settings → Reset moved modules** puts them back.
- **Angle & layers**: drag the compass (or focus it and use the arrow keys) to turn and tilt, snap to **Front**, **Top**, or **Side**, and choose whether to show districts, modules, or both. **Precise camera** has sliders for pitch, bearing, and depth.
- The zoom control's menu has camera presets, and the dock's last button fits the current view.
- **Flat** swaps the city for a tidy diagram grouped by district, with every module named on its card.

## The source panel

Select a tower, a search result, or a module card to open its source panel.

- The header shows the module type, its district, and its source status.
- **Source**, **Runtime**, and **Deployment** state what the atlas actually knows. Source is confirmed against the pinned commit; runtime and deployment are always **Not checked**.
- **Overview** explains how the module works, the evidence behind it (with file and line references), and its risks and limits.
- **Files** lists every path. Copy a path, open it on GitHub at the pinned commit, or use **Copy context** to copy a Markdown summary of the module. **Revision & module facts** shows the counts behind the tower's size.

Close the panel with its close button or <kbd>Esc</kbd>; keyboard focus returns to where you were.

### Source status

| Label | Meaning |
| --- | --- |
| Source present | The code is in the repository and on the main path described |
| Conditional | The code exists but only runs under a setting, feature flag, extension, or request condition |
| External | A boundary with another system, such as a payment provider |
| Declared | A manifest or build step declares the code, but it is not in the repository at the pinned commit |

## Walkthroughs

A walkthrough follows one real flow through the code as a short story.

- **WooCommerce:** placing an order with the Checkout Block, from browser state through the Store API, order storage, and payment, back to the result. Four chapters.
- **Gumroad:** buying one paid digital product, from loading the checkout page through payment to the receipt. Twelve chapters.

Each chapter explains what happens, what the source confirms, and where its claim stops. **Files in this chapter** lists the paths involved. Use **Next chapter** and **Back**, or open **All chapters** to jump. **Step through individual calls** moves one hop at a time along the flow; <kbd>←</kbd> and <kbd>→</kbd> do the same.

The camera frames the whole path beside the panel, and the numbered badges on the map mark where each chapter starts. **About this walkthrough** holds the summary, a picker for the atlas's other source flows, a legend, and the boundaries of the story. Closing the panel keeps the path on the map; press <kbd>J</kbd> to bring it back, or **Back to map** to leave the walkthrough.

## The module index

**Modules** lists everything in the atlas. Filter by type (surfaces, routes and APIs, services, data, providers and hooks, external systems, configuration), start the walkthrough from its card, fly to a district, or open any module's source panel.

## Search and filters

Press <kbd>/</kbd> to search modules, file paths, flows, and walkthroughs. The map filters as you type, and the caption shows how many modules match. Press <kbd>Enter</kbd> to open the first result, or <kbd>↓</kbd> to move through them. When nothing matches, **Clear search and filters** resets everything.

**Filters** groups the city by system district or by source folder, turns even spacing and labels on or off, hides modules by status, and lists every visible module.

## Settings and sharing

**Settings** holds the scene finish, **Surprise me** (opens a random module), **Focus mode** (full screen, without the chrome), **Reset view**, **Replay entrance**, **Reset moved modules**, the guided tour, and the shortcut list.

The three finishes show the same data:

- **Luminous**: glowing glass towers on a dark ground.
- **Matte**: flat, quiet colors without the glow.
- **Architectural**: stepped towers in mineral tones.

**Share → Copy link** copies a link that reopens the current atlas, module, and view. **Save PNG** downloads the 3D scene. **Save view** remembers the camera, layout, and moved modules in this browser; **Clear saved view** forgets them. Nothing is sent anywhere.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>/</kbd> | Search |
| <kbd>R</kbd> <kbd>E</kbd> <kbd>J</kbd> | Map · Modules · Walkthrough |
| <kbd>P</kbd> <kbd>O</kbd> <kbd>A</kbd> | Pan · Orbit · Move |
| <kbd>I</kbd> | Open or close the source panel |
| <kbd>L</kbd> | Labels on or off |
| <kbd>M</kbd> | Focus mode |
| <kbd>←</kbd> <kbd>→</kbd> | Previous or next call in a walkthrough |
| <kbd>Tab</kbd>, <kbd>Enter</kbd> | Move between towers and open one |
| <kbd>Esc</kbd> | Close the current panel, menu, or search |
| <kbd>?</kbd> | Help |

## Links and URL options

| URL | Opens |
| --- | --- |
| `?atlas=gumroad` | A specific atlas from the registry |
| `?node=checkout-api` | A module's source panel |
| `#journey` | The walkthrough (`#repository` returns to the map) |
| `?look=matte` | A scene finish (`luminous`, `matte`, or `architectural`) for this visit |
| `?intro` | Replays the entrance animation; `?intro=6000` slows it to six seconds |
| `?noblur` | Turns off background blur, for slow or software-rendered graphics |

Combine them, for example `?atlas=gumroad&node=payment-form`.

## Phones, motion, and accessibility

On narrow screens the rail moves to the bottom, and an open walkthrough or source panel takes the full height until you close it. With **reduce motion** turned on in the operating system, the entrance flight, camera animations, and decorative effects are skipped.

Controls have visible labels or accessible names, towers can be reached with <kbd>Tab</kbd>, the guided tour keeps focus inside it, and focus returns to its starting point when a panel closes. The module index and search give the same information as the 3D city in a plain, readable form.
