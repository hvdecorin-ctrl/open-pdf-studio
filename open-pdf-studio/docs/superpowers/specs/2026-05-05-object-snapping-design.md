# Object Snapping (OSNAP) — Design

Date: 2026-05-05

## Goal

Extend the existing snap pipeline so the cursor magnetically snaps to
geometric features of nearby annotations (and PDF content) while drawing or
editing. Modes are individually toggleable. A visual marker is drawn on the
candidate snap before the user clicks; the cursor's reported coordinate is
pulled to the snap point when within a configurable radius. This brings the
app's drawing UX to AutoCAD/BricsCAD parity.

## Data model

No annotation-model changes. Preferences (`state.preferences.snap`) gain a
new sub-tree:

```js
preferences.snap = {
  enabled: true,
  radius: 12,                  // px, screen-space
  modes: {
    endpoint: true,
    midpoint: true,
    intersection: true,
    perpendicular: false,
    nearest: false,
    center: true,
    quadrant: false,
    tangent: false,
  },
  showMarker: true,
  showStatusBarFeature: true,
}
```

Persisted via the existing `savePreferences()` mechanism.

## UI / interaction

### Snap markers (canvas overlay, drawn just before flush)

| Mode          | Marker            | Glyph |
|---------------|-------------------|-------|
| endpoint      | square 8 px       | □     |
| midpoint      | triangle 8 px     | △     |
| intersection  | rotated cross     | ✕     |
| perpendicular | right-angle mark  | ⊥     |
| nearest       | hourglass         | ✕     |
| center        | small circle      | ○     |
| quadrant      | diamond           | ◇     |
| tangent       | circle with bar   | ⌀     |

Marker color: `#ff8800` (matches existing `drawSnapIndicator` palette in
`snap-engine.js`). Drawn in `decorations.js` overlay phase.

### State machine (per pointer move)

```
pointermove(rawX,rawY)
   → snapEngine.resolve(rawX,rawY,context)
        ├ run polar-tracking pass     (spec 5)
        ├ run grid pass               (spec 5)
        ├ run object-snap pass         ← THIS SPEC
        └ run pdf-content pass        (existing pdf-snap-extractor)
   → returns { x, y, snapped: bool, type, sourceAnnId }
   → tool uses (x,y); decorations layer draws marker
```

Object-snap pass beats grid/polar (so user can always lock to a real point).
PDF-content snap remains last as fallback.

### Toggle UI

- Status-bar button group with 8 toggle chips (one per mode), initial-letter
  glyph + on/off colour. Clicking toggles the mode. Right-click opens a
  modal "Drafting Settings" (Windows-style, see CLAUDE.md modal rules).
- Keyboard: `F3` opens the modal. `Shift+E/M/I/P/N/C/Q/T` toggle individual
  modes inline. F11 toggles the master `enabled` flag.
- Status bar text: when snapped, shows `Endpoint < line ann_42` (mode +
  source annotation type/id) for ~1 s.

## Components / files touched

- `js/tools/snap-engine.js` — split internal helpers; add new functions
  `collectObjectSnapCandidates(annotations, page, prefs)` (extends existing
  `collectSnapPoints` with the missing modes), `findIntersections()`,
  `findPerpendicularFoot()`, `findNearestOnAnnotation()`,
  `findTangent()`. Existing `findNearestSnap()` remains the kernel.
- `js/tools/snap-engine.js` — new top-level `resolve(x, y, ctx)` that
  pipelines polar → grid → object-snap → pdf-content and returns one
  result.
- `js/annotations/rendering/decorations.js` — render snap marker glyph
  per type.
- `js/core/preferences.js` — defaults + migration for new keys.
- `js/solid/components/StatusBar.jsx` (or equivalent) — chip group + status
  text.
- `js/solid/components/dialogs/DraftingSettingsDialog.jsx` — NEW Windows-
  style modal (no rounded corners; gradient title bar).
- `js/tools/keyboard-handlers.js` — F3 / F11 / Shift+letter handlers.
- `js/tools/tools/*.js` — every drawing tool's `onPointerMove` swaps from
  bespoke snap calls to the unified `snapEngine.resolve(...)`.
- `js/i18n/locales/*/preferences.json`, `*/context.json` — new keys for
  each mode label.

## Persistence (PDF + XFDF)

None. Snap state is purely UI/preferences.

## Out of scope (YAGNI)

- Tangent-from-curve and tangent-to-curve.
- Parallel and extension snaps.
- Apparent intersection (3D projection).
- Deferred-perpendicular (perpendicular before second point known).
- Snap-from offset construction.
- Snap to imported DWG/DXF underlay.
- Snap to PDF text baselines.

## Testing (manual smoke)

1. Open a PDF with several annotations (lines, polylines, rect, circles).
2. Open Drafting Settings (F3). Toggle modes one-by-one.
3. With endpoint on, hover near a line endpoint — square marker appears,
   cursor snaps within 12 px.
4. With midpoint on, hover near segment middle — triangle marker, snap
   works.
5. With intersection on, hover near where two lines cross — × marker,
   coordinate exactly at intersection.
6. With perpendicular on, draw a line; while placing the second point,
   move near another segment — ⊥ marker on its foot, snap correct.
7. With center on, hover near a circle's centre — ○ marker.
8. With quadrant on, hover near 0°/90°/180°/270° points of a circle —
   ◇ marker at quadrant.
9. With nearest on, hover anywhere on a polyline edge — × marker on edge.
10. Disable master via F11 — no markers, no snapping.
11. Confirm preference persists across app restart.
12. Status bar shows "Endpoint < line" momentarily on each snap.
