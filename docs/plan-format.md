# Site Sketch plan format

Version 2 JSON is the drawing. Later wall elevations and 3D renders should read this file and not invent a second model.

Units are millimetres. X increases east. Y increases north (up). A quarter-turn rotation is degrees counter-clockwise from east. Heights are above finished floor level (AFFL).

The file is one sketch with two sheets:

| Sheet | What it shows |
| --- | --- |
| Existing | `origin: "existing"`. `removal: "remove"` is drawn red (demolition). |
| Proposed | Existing items with `removal: "keep"`, plus `origin: "new"`. Removed items are omitted. |

`meta` (client, address, drawn by, date, revision, project, notes) is typed in the app and stored only on the device. It is not sent anywhere.

## Top level

```json
{
  "version": 2,
  "units": "mm",
  "walls": [],
  "rooms": [],
  "openings": [],
  "fixtures": [],
  "callouts": [],
  "notes": [],
  "dims": [],
  "meta": {
    "client": "",
    "address": "",
    "drawnBy": "",
    "date": "",
    "revision": "A",
    "project": "",
    "notes": ""
  }
}
```

Version 1 files (walls and rooms only) load as version 2. Missing `origin` becomes `"existing"`, missing `removal` becomes `"keep"`.

## Walls

A wall is a centreline `a` → `b` plus a finished thickness. A room's rectangle is the clear interior; the four centreline walls sit outside it, in order bottom, right, top, left.

```json
{ "id": "wall-1", "a": { "x": 0, "y": 0 }, "b": { "x": 2490, "y": 0 }, "thickness": 90, "origin": "existing", "removal": "keep" }
```

## Rooms

```json
{ "id": "room-1", "wallIds": ["bottom", "right", "top", "left"], "name": "BATHROOM", "ceiling": 2400 }
```

`ceiling` is millimetres AFFL. Clear area is `width × depth` of the interior, in m². The name is stored in uppercase.

## Openings

An opening is hosted by `wallId`. `offset` is the distance from `wall.a` to the centre of the clear opening. `hand: "start"` puts the hinge, or the cavity pocket, toward `wall.a`. `side: 1` swings to the left of `a → b`.

```json
{
  "id": "opening-1",
  "wallId": "bottom",
  "kind": "hinged",
  "offset": 1200,
  "width": 820,
  "pocket": 0,
  "hand": "start",
  "side": 1,
  "sill": 0,
  "head": 2040,
  "origin": "existing",
  "removal": "keep"
}
```

| `kind` | Plan symbol | Default width | `sill` | `head` | `pocket` |
| --- | --- | --- | --- | --- | --- |
| `hinged` | Leaf and swing arc | 820 | 0 | 2040 | 0 |
| `cavity` | Pocket, door slab, chevron | 820 | 0 | 2040 | width − 60 |
| `window` | Three glazing lines | 900 | 1000 | 2100 | 0 |

Common door widths are 720, 770, 820 and 920. The pocket length is what an elevation needs for a cavity slider.

## Fixtures

`x`, `y` is the anchor. For wall-mounted items that is the centre of the back edge (or the corner of an L grab) on the wall face. For showers, baths, ceiling symbols and turning circles it is the centre. `wallId` and `along` are set when the item is snapped to a wall; `along` uses the same axis as an opening's `offset`. `side` is which face.

```json
{
  "id": "fx-1",
  "kind": "basin",
  "x": 400,
  "y": 45,
  "rotation": 0,
  "width": 720,
  "depth": 450,
  "affl": 850,
  "height": 0,
  "diameter": 0,
  "clearance": false,
  "origin": "new",
  "removal": "keep",
  "wallId": "bottom",
  "along": 400,
  "side": 1
}
```

Default size and the AFFL field:

| `kind` | Width × depth | `affl` means | `height` |
| --- | --- | --- | --- |
| `toilet` | 360 × 700 | Seat | 0. `clearance: true` draws a dashed zone |
| `basin` | 720 × 450 | Rim | 0 |
| `vanity` | 900 × 460 | Rim | 0 |
| `shower` | 1200 × 1200 | 0 (floor waste) | 0 |
| `bath` | 1675 × 760 | 0 | 0 |
| `grab` | 600 × 82 | Rail centreline. 32 mm tube, 50 mm off the wall, end flanges | 0 |
| `grab-l` | 800 × 800 | Horizontal rail | Vertical leg length |
| `curtain` | 1200 × 40 | Track | 0 |
| `niche` | 600 × 90 | Sill | Opening height |
| `mirror` | 750 × 150 | Bottom of cabinet | Cabinet height |
| `gpo` | 117 × 74 | Plate centre | 0 |
| `switch` | 75 × 40 | Plate centre | 0 |
| `exhaust` | 332 × 332 | Mounting height | 0 |
| `light` | 220 × 220 | Mounting height | 0 |
| `turning` | diameter × diameter | 0 | 0. `diameter` is 1540 or 2070 |

Local +Y is the depth axis. A recessed niche runs into the wall; other wall-mounted items project into the room. Symbols are generic plan shapes at these sizes, not traced manufacturer outlines.

## Annotations

Callouts, free text and manual dimensions each have a `sheet` of `"existing"` or `"proposed"`. Callout `number` is per sheet. Callout text is stored in uppercase. A manual dimension measures `a` → `b`; `offset` is the dimension line, in millimetres, to the left of that direction.

## Elevations and 3D

A wall elevation can be built without looking at the canvas:

1. Take the wall centreline as the horizontal axis. Offset 0 is `wall.a`.
2. The wall height is `ceiling` on a room whose `wallIds` include this wall.
3. Openings on this `wallId` contribute `offset`, `width`, `sill` and `head`. A cavity also contributes `pocket` and `hand`.
4. Fixtures with this `wallId` contribute `along`, `width`, `affl` and `height`.
5. `origin` and `removal` decide existing, demolished and new work.
6. Thickness is the finished wall build-up. Interior dimensions are the clear sizes between inner faces.

Nothing in this file is a compliance certificate. Notes on the sheet say the same thing.
