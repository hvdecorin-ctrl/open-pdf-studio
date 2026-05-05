# Scale Region — Design

Date: 2026-05-05

## Goal

Introduce a `scaleRegion` annotation that defines a rectangular calibration
viewport over a PDF page. Each region carries its own scale (e.g. `1:100`) and
unit (`mm`, `cm`, `m`, `in`, `ft`). Any annotation drawn or any measurement
taken whose anchor lies inside the region uses **that region's scale** instead
of the document-global one. Multiple regions per page are allowed and may
overlap (e.g. `1:1` titelblok, `1:100` tekening, `1:20` detail). This
generalises the existing single per-document `measureScale` and the
`scaleBar` annotation into a spatial, declarative model that mirrors how CAD
viewports work in paper space.

## Data model

New annotation type `scaleRegion`. Stored next to all other annotations in
`state.annotations[pageNum]`.

```js
{
  id, page, type: 'scaleRegion',
  x, y, width, height,             // app coords (PDF user units, top-left origin)
  scale: '1:100',                  // string (display + serialization)
  scaleRatio: 0.01,                // numeric ratio (drawing : world), derived
  units: 'mm',                     // 'mm' | 'cm' | 'm' | 'in' | 'ft'
  label: 'Plattegrond BG',         // optional user label, drawn in badge
  color: '#1f6feb',                // border + badge color
  borderStyle: 'dashed',           // fixed, but stored for forward-compat
  opacity: 1,
}
```

No store-level fields are required: the active scale per measurement is looked
up at hit-test time via a new helper.

## UI / interaction

### Creation tool

A new tool `scale-region-tool.js` under `js/tools/tools/`. Two-click drag
rectangle, identical to `shape-tool.js`'s rect mode. On commit, opens a small
inline popover prompting for `scale` (text `1:100`) and `units` (dropdown).
Defaults pulled from preferences (`prefs.lastScaleRegion`).

### State machine (drawing)

```
idle → pointerdown → dragging → pointerup → prompt(scale,units) →
   confirm → committed (annotation created, undo recorded)
                      ↘ cancel → discarded
```

### Selection / editing

- Standard 8-handle resize (re-uses `shape` rectangle handles in `handles.js`).
- Standard move via body drag.
- Properties panel (`PropertiesPanel.jsx`): `scale` text input, `units`
  dropdown, `label` text input, `color` swatch.
- Visual: 1.5 px dashed border in `color`, badge top-left `[1:100 mm]` (or
  `[label · 1:100 mm]` if a label is set), 11 px font, white-on-color chip.

### Resolution helper

New module `js/annotations/scale-region.js`:

```js
getScaleRegionAt(pageNum, x, y) → { pixelsPerUnit, unit, source: 'region', regionId }
```

Iterates the page's `scaleRegion` annotations in z-order top-most first;
returns the first whose rect contains `(x, y)`. `pixelsPerUnit` is computed
from `scaleRatio` and `units` using the page DPI baseline used elsewhere.

### Integration with existing scale resolution

`getMeasureScale(pageNum, x, y)` in `js/annotations/measurement.js` is
extended. New priority:

1. `scaleRegion` containing `(x, y)` (NEW — highest priority)
2. `scaleBar` annotation containing `(x, y)` (existing)
3. Per-document `measureScale`
4. Legacy global preference
5. Default

When `(x, y)` is omitted (callers that ask for a "page scale"), region
lookup is skipped — only the existing fallbacks apply. Measurement tools
already pass coordinates; `line-tool` and `polyline-tool` will be updated to
pass the start point as the lookup coordinate so that a polyline starting
inside a region keeps that region's scale for its full length even if it
crosses the boundary (consistent with CAD viewport semantics).

## Components / files touched

- `js/types/annotation.ts` — add `'scaleRegion'` to the type union + props.
- `js/annotations/factory.js` — `createScaleRegion(...)` factory.
- `js/annotations/scale-region.js` — NEW, region resolution helpers.
- `js/annotations/measurement.js` — extend `getMeasureScale` priority chain.
- `js/annotations/rendering/shapes.js` — render dashed rect + badge.
- `js/annotations/rendering/selection.js` — handle drawing reuses rect path.
- `js/annotations/handles.js` — no change (rectangle handles already exist).
- `js/annotations/transforms.js` — no change (rectangle move/resize already
  cover x/y/width/height).
- `js/annotations/xfdf.js` — round-trip `scaleRegion` (see below).
- `js/pdf/saver.js` — write `/Square` with custom keys.
- `js/pdf/loader/annotation-converter.js` — parse `/Square` with
  `OPS_Subtype=scaleRegion`.
- `js/tools/tools/scale-region-tool.js` — NEW.
- `js/tools/tools/index.js` — register the tool.
- `js/tools/tool-registry.js` — register tool id.
- `js/solid/components/ribbon/MeasureTab.jsx` — toolbar button.
- `js/solid/components/PropertiesPanel.jsx` — properties UI.
- `js/i18n/locales/*/ribbon.json`, `*/properties.json`, `*/context.json` —
  new keys (`scaleRegion.title`, etc.) for all 37 languages.

## Persistence (PDF + XFDF)

### PDF (`/Square` annotation)

Saved as a `/Square` annotation so legacy viewers see a rectangle. Custom
private keys carry the semantics:

- `/OPS_Subtype (scaleRegion)`
- `/OPS_ScaleString (1:100)`
- `/OPS_ScaleRatio 0.01`
- `/OPS_Units (mm)`
- `/OPS_Label (Plattegrond BG)`

On load, `annotation-converter.js` recognises `OPS_Subtype=scaleRegion` and
materialises the right annotation type. Without the custom keys, the
annotation degrades to a normal rectangle.

### XFDF

Element `<square ...>` with extra attributes in the `OPS:` namespace:
`OPS:subtype="scaleRegion"`, `OPS:scaleString`, `OPS:scaleRatio`,
`OPS:units`, `OPS:label`. `xfdf.js` import/export adds reciprocal handling.

## Out of scope (YAGNI)

- Rotated regions (only axis-aligned rectangles in v1).
- Polygon / non-rect regions.
- Per-region origin offset (true coordinate readout).
- Region inheritance / nested regions (precedence is purely z-order).
- Cross-page regions.
- Auto-detect viewport boundary from PDF content.
- Mass conversion of existing `scaleBar` annotations into regions.

## Testing (manual smoke)

1. Open a multi-page PDF. Switch to Measure tab, choose Scale Region tool.
2. Drag a rectangle on the drawing area, set `1:100`, units `mm`. Confirm
   border + badge render as specified.
3. Draw a second region inside the first, `1:20`, `mm`.
4. Use measureDistance to draw a 100 mm line **inside** the inner region —
   the value reads against `1:20`.
5. Draw a 100 mm line in the outer region only — value reads `1:100`.
6. Draw a line entirely outside both regions — falls back to document scale.
7. Resize and move both regions; values on associated measurements update on
   redraw.
8. Save the PDF. Reopen — both regions reload with correct scales/units.
9. Export XFDF, re-import in a fresh document — round-trip identical.
10. Open the saved PDF in another viewer — sees plain dashed rectangles.
