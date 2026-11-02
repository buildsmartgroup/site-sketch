# Site Sketch

Buildsmart Group's iPad drafting board for site plans. Milestone 1 is a installable PWA: pan and pinch, rooms and walls in real millimetres, Apple Pencil drawing with finger navigation, undo, and sketches stored on the device.

The plan is plain data. Rendering is derived from it, so later milestones (fixture library, elevations, PDF, 3D) can extend the same document.

## Model

- Units are millimetres.
- X increases to the right. Y increases upward.
- A wall is a centerline (`a` → `b`) plus a thickness. The default is a 90 mm internal stud, with 110 mm and 150 mm available.
- A room is four walls. The rectangle you drag is the **clear interior**; the walls sit outside it. Dimension labels show that interior size. A free wall's label is its centerline length.
- `version: 1` documents contain `walls` and `rooms` only. Fixtures, notes, and photos can be added later without changing the unit system.

Sketches are kept in IndexedDB in the browser and saved as you work. Undo history lives in memory for the session.

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

`scripts/verify-m1.mjs` builds nothing by itself: run `npm run build` first, then the script serves `dist` and drives an iPad-sized browser with pen and touch pointer events.

## Offline

The production build registers a service worker that precaches the app shell. After one online load, add it to the iPad home screen (Safari → Share → Add to Home Screen) and it opens offline.
