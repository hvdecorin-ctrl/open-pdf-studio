# Grid + Polar Tracking — Design

Date: 2026-05-05

## Goal

Add a visible dot grid with optional snap-to-grid, plus polar tracking that
biases drawing/edit cursors toward configurable angle increments. Both are
passes inside the unified snap pipeline introduced in spec 2 — they apply
**before** object snap (so object snap wins over grid/polar) but **after**
type/coord input (which is authoritative). This brings the drafting feel
to AutoCAD/BricsCAD parity.

## Data model

Preference additions (`state.preferences`):

```js
preferences.grid = {
  visible: true,
  snap: false,
  spacing: 10,            // user units (mm by default)
  unit: 'mm',
  color: '#cccccc',
  hideUnderZoom: 0.5,     // hide when zoom < this
  showAtZoom: 4.0,        // show every-other when zoom > this
}

preferences.polar = {
  enabled: false,
  increment: 45,          // deg
  alignToLastSegment: false,
  showTooltip: true,
  color: '#cc66cc',       // light magenta for the polar ray
}
```

No annotation changes.

## UI / interaction

### Grid rendering

- Drawn on a dedicated underlay canvas placed beneath the annotation
  overlay (new `gridCanvas` per page, sized to viewport).
- Dot pattern: 1 px circle every `spacing` user units, color
  `prefs.grid.color`.
- Honors zoom: when `viewportScale < hideUnderZoom`, hidden entirely;
  when `viewportScale > showAtZoom`, draw additional minor dots at
  `spacing/5` interval in 50 % opacity.
- Re-renders on zoom/pan via the existing render scheduling already used
  for annotation overlay.
- F7 toggles `prefs.grid.visible` (matches AutoCAD).

### Snap-to-grid

- F9 toggles `prefs.grid.snap`.
- Grid pass implementation: round livePoint to the nearest grid node when
  active. Marker: small `+` glyph at the snap candidate, color
  `prefs.grid.color`.

### Polar tracking

- F10 toggles `prefs.polar.enabled`.
- During an active drawing/edit phase that has a known anchor point
  (drawing tool's first click, or `commandFlow.basePoint`), compute the
  angle from anchor → cursor.
- If the angle is within `±2°` of `k × increment` (k integer), snap the
  angle to `k × increment` and project the cursor onto the polar ray.
- Visual: faint dashed ray through anchor in `prefs.polar.color`,
  extending past the cursor by 60 px.
- Tooltip near cursor: `Polar: 90.000° < 124.376` (angle and distance,
  using the active scale region's units — see spec 1).
- `alignToLastSegment` (off by default): for polyline-style tools, the
  reference angle is the previous segment's direction rather than 0°.

### Pipeline order

Inside `snapEngine.resolve(rawX, rawY, ctx)`:

```
1. coord-input override (spec 6) — if user typed an exact value, return that
2. polar pass — projects (rawX,rawY) onto polar ray if applicable
3. grid pass — rounds to grid node if snap-to-grid on
4. object-snap pass (spec 2) — strongest snap, wins over grid/polar
5. pdf-content snap pass (existing)
```

Each pass returns either a `{x, y, snapped, type}` or `null` to pass
through. The pipeline takes the result of the **last** pass that returned
a snap (later ones overrule earlier ones), with object-snap radius
honored separately so it only "wins" when actually within radius.

## Components / files touched

- `js/core/preferences.js` — defaults for `grid` and `polar`.
- `js/pdf/renderer.js` — add gridCanvas underlay; `renderGrid(viewport,
  prefs.grid)`. May factor a small new file `js/pdf/grid-renderer.js`.
- `js/tools/snap-engine.js` — new internal passes
  `polarPass(anchor, p, prefs.polar)` and `gridPass(p, prefs.grid)`.
  Update `resolve()` to compose passes in the order above.
- `js/annotations/rendering/decorations.js` — render polar ray + tooltip.
- `js/tools/keyboard-handlers.js` — F7 (`grid.visible`),
  F9 (`grid.snap`), F10 (`polar.enabled`).
- `js/solid/components/StatusBar.jsx` — chip indicators GRID / SNAP /
  POLAR with click-to-toggle.
- `js/solid/components/dialogs/DraftingSettingsDialog.jsx` — tabs for
  Grid (spacing, unit, colors, zoom thresholds) and Polar (increment,
  alignToLastSegment).
- `js/i18n/locales/*/preferences.json` — labels.

## Persistence (PDF + XFDF)

None. Pure preference state.

## Out of scope (YAGNI)

- Isometric grid (3 axis snap planes).
- Per-page grid overrides.
- Saving grid state per document.
- Snap to grid on existing annotation edit (only applies to new
  drawing — keeps moves of large selections from quantising
  unexpectedly).
- Object-tracking acquired points (alignment guides from temporary
  anchors).
- Polar override-mode keys (e.g. type angle in chord buffer).

## Testing (manual smoke)

1. Open PDF. F7 — dot grid appears at 10 mm. Zoom in 4× — additional
   minor dots appear at 2 mm. Zoom out below 0.5× — grid hides.
2. F9 — start drawing a line; cursor snaps to nearest dot. Confirm by
   the `+` marker.
3. F10 — start a line, move cursor near 45° from start; faint ray and
   tooltip appear, line snaps to 45°. Tooltip reads angle and distance
   in current scale units (works inside a scale region from spec 1).
4. With polar + grid both on — polar ray takes precedence over grid
   along its direction; grid still applies perpendicular to the ray.
5. With object-snap (endpoint) on plus polar on — moving near another
   line's endpoint within 12 px snaps to endpoint, overriding polar.
6. Type a value (`100`) during polar — coord-input takes precedence;
   line is exactly 100 along the polar angle.
7. Open Drafting Settings → Grid → change spacing to 25 mm and unit to
   `cm` — preview updates immediately.
8. Set polar increment to 30° — angles snap to 0/30/60/90/...
9. Toggle `alignToLastSegment` and draw a polyline — second segment's
   polar reference angle is segment-1's direction.
10. Restart app — grid + polar prefs persist.
