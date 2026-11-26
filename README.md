# Site Sketch

Buildsmart Group's iPad drafting board for bathroom alterations. One sketch holds the existing room and the proposed room. Pencil draws, a finger pans and pinches, and the sketch stays on the device.

The plan is plain JSON in millimetres. [docs/plan-format.md](docs/plan-format.md) is the contract for later wall elevations and 3D.

## Model

- Units are millimetres. X increases to the right. Y increases upward.
- A wall is a centreline (`a` → `b`) plus a thickness. The default is a 90 mm internal stud, with 110 mm and 150 mm available.
- A room is four walls. The rectangle you drag is the **clear interior**; the walls sit outside it. The label shows the name, the area in m², and the ceiling height.
- Each wall, opening and fixture has `origin` (`existing` or `new`) and `removal` (`keep` or `remove`).
- Existing sheet: existing work in black, removals in red. Proposed sheet: kept existing work, plus new work in blue hatch. New items are hidden on the existing sheet. Removed items are hidden on the proposed sheet.
- Openings (hinged door, cavity slider, window) sit on a wall. Doors default to 820 mm; 720, 770, 820 and 920 are one tap. Head, sill and cavity pocket length are stored for elevations.
- Fixtures are true-size blocks (pan, 720 basin, vanity, hobless shower, bath, grab rails, curtain, niche, mirror, GPO, switch, exhaust, light, 1540/2070 turning circle) with a mounting height AFFL.
- Version 1 sketches (walls and rooms only) still open.

Sketches, including the job title block (client, address, drawn by, date, revision), are kept in IndexedDB and saved as you work. Nothing is uploaded.

## Drawing

- Apple Pencil (`pointerType: "pen"`) uses the current tool. A finger never draws.
- Keys: `V` select, `R` room, `W` wall, `D` door, `K` cavity slider, `N` window, `F` fixture, `M` dimension, `C` callout, `T` text. Ctrl/Cmd+Z undo.
- Select a wall, opening or fixture and tap **Mark remove** to flag demolition.
- Switch **Existing / Proposed** in the top bar. Anything drawn on Proposed is new work.
- Snap is 10 mm while that step is at least about 8 px on screen.
- Tap a dimension, type a size, and the geometry updates.

## Export

**PDF** writes two A3 landscape sheets, Existing / Demolition and Proposed, at 1:30 or the next standard scale that fits. The title block carries Buildsmart Group, builders licence DBU 46138, NDIS provider 4-GQRXUP3, and info@buildsmartgroup.com.au, plus the job fields entered under **Job**.

**JSON** downloads the version 2 plan described in `docs/plan-format.md`.

On iPad Safari the file goes to the share sheet when the browser allows it, otherwise it downloads. Both work offline because the PDF library is inside the app.

## Drawing

- Apple Pencil (`pointerType: "pen"`) uses the current tool.
- A finger never draws. One finger pans, two fingers pan and pinch-zoom.
- A mouse draws with the left button, pans with the middle or right button (or Alt or Space), and zooms with the wheel. Keys: `V` select, `R` room, `W` wall, Ctrl/Cmd+Z undo.
- Snap is 10 mm while that step is at least about 8 px on screen, then coarser as you zoom out.
- Walls also snap to existing endpoints and to 0°, 45°, and 90°.
- Tap a dimension, type a size, and the geometry updates. The keypad comes up on iPad (`inputmode="decimal"`).

## Scripts

```bash
npm install
npm test
npm run dev
npm run build
npm run preview
```

The dev server and the production preview both use the `/site-sketch/` base path. GitHub Pages serves the built app at [https://buildsmartgroup.github.io/site-sketch/](https://buildsmartgroup.github.io/site-sketch/).

`scripts/verify-m1.mjs` and `scripts/verify-m2.mjs` build nothing by themselves: run `npm run build` first, then the script serves `dist` and drives an iPad-sized browser with pen and touch pointer events. `verify-m2.mjs` draws an example bathroom, exports PDF and JSON, and checks the sheets.

## Offline

The production build registers a service worker that precaches the app shell. After one online load, add it to the iPad home screen (Safari → Share → Add to Home Screen) and it opens offline.
