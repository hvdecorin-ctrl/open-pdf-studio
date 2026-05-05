# Grip Points + Tracking Lines — Design

Date: 2026-05-05

## Goal

Add CAD-style yellow grip-point markers on every selected annotation's
defining points, plus an interactive "grip stretch" mode. Clicking a grip
enters a modal stretch state in which the cursor drags that point with a
rubber-band tracking line from the grip's original location to the current
cursor position. A second click (or Enter) commits; Esc cancels. This
supersedes ad-hoc per-shape edit handles for stretch operations and unifies
the editing UX across line, polyline, circle, rect, and arc.

## Data model

No annotation-shape changes. Two additions:

1. New `interactionStore` slice `gripStretch`:

   ```ts
   gripStretch: {
     active: boolean,
     annId: string | null,
     handleType: string | null,    // e.g. 'GRIP_LINE_START'
     basePoint: {x, y} | null,     // grip's original location (anchor for tracking line)
     livePoint: {x, y} | null,     // current cursor (after snap pipeline)
     undoSnapshot: any | null,     // pre-stretch annotation deep clone for cancel
   }
   ```

2. New handle-type constants in `js/core/constants.ts`:

   `GRIP_LINE_START`, `GRIP_LINE_MID`, `GRIP_LINE_END`,
   `GRIP_POLY_VERTEX_<i>`, `GRIP_POLY_EDGE_MID_<i>`,
   `GRIP_CIRCLE_CENTER`, `GRIP_CIRCLE_QUAD_E/N/W/S`,
   `GRIP_RECT_CORNER_TL/TR/BR/BL`, `GRIP_RECT_EDGE_T/R/B/L`,
   `GRIP_RECT_CENTER`,
   `GRIP_ARC_START`, `GRIP_ARC_MID`, `GRIP_ARC_END`, `GRIP_ARC_CENTER`.

## UI / interaction

### Grip markers (drawn in selection layer)

- 6×6 px filled square; `#ffd400` fill, `#000` 1 px stroke.
- Hover state: `#3399ff` fill (blue).
- Active (stretching) state: `#e81123` fill (red, matches Win modal close
  hover).
- Drawn at screen-constant size (compensate zoom — see existing
  `HANDLE_SIZE / scale` pattern in `handles.js`).

### Per-type grip layout

| Type      | Grips                                                         |
|-----------|---------------------------------------------------------------|
| line      | start, midpoint, end (3)                                      |
| polyline  | each vertex + each edge midpoint (n + n−1, or +n if closed)   |
| circle    | center + 4 quadrants (5)                                      |
| rectangle | 4 corners + 4 edge mids + center (9)                          |
| arc       | start, end, midpoint, center (4)                              |

Edge-midpoint grips on polylines insert a new vertex at the midpoint when
clicked, then immediately enter grip stretch on that new vertex (re-uses
existing edit-contour pattern from `polyline-tool.js`).

### Tracking line

While `gripStretch.active`, draw a 1 px dashed line from `basePoint` to
`livePoint`. Color: the annotation's stroke color (fall back to
`#0078d4` if none). Drawn in `decorations.js`.

### State machine

```
selected → pointerdown over grip
   → enter gripStretch (snapshot annotation, set basePoint)
   → pointermove updates livePoint via snapEngine.resolve(...)
        → re-applies the appropriate transform live (start/end stretch,
          mid moves whole shape, quadrant resizes radius, etc.)
   → pointerup OR Enter → commit (push undo with delta)
   → Esc → restore from snapshot, exit
```

Per-grip semantics:

- **LINE start/end**: stretch endpoint to livePoint.
- **LINE mid**: translate whole line by `livePoint − basePoint`.
- **POLY vertex i**: replace `points[i]` with livePoint.
- **POLY edge-mid i**: insert vertex at base, then stretch.
- **CIRCLE quadrant**: new radius = distance(center, livePoint); center
  unchanged.
- **CIRCLE center**: translate whole circle.
- **RECT corner**: stretch via opposite-corner pivot.
- **RECT edge-mid**: stretch one side only (other dimension unchanged).
- **RECT center**: translate.
- **ARC start/end/mid**: re-fit arc through three points.
- **ARC center**: translate.

### Coordinate input

While in grip stretch, the existing type-length-input (and the new
coord-input from spec 6) is active so user can type a numeric distance and
press Enter to commit at exactly that distance from the base point.

## Components / files touched

- `js/core/constants.ts` — add new handle types.
- `js/core/stores/interaction-store.ts` — `gripStretch` slice + actions
  `enterGripStretch`, `updateGripStretch`, `commitGripStretch`,
  `cancelGripStretch`.
- `js/annotations/handles.js` — extend `getAnnotationHandles()` to emit
  `GRIP_*` handles for each annotation type. Existing resize handles stay
  for backward compatibility but are visually replaced by grips when
  `state.preferences.useGripPoints !== false`.
- `js/annotations/rendering/selection.js` — render grip squares.
- `js/annotations/rendering/decorations.js` — render tracking line during
  stretch.
- `js/annotations/transforms.js` — new `applyGripStretch(ann, handleType,
  livePoint)` dispatcher.
- `js/tools/tools/select-tool.js` — pointerdown over a grip enters
  stretch; pointerup commits.
- `js/tools/keyboard-handlers.js` — Esc cancels, Enter commits when
  `gripStretch.active`.
- `js/tools/snap-engine.js` — already used by `onPointerMove`; no change.

### Reconciliation with existing edit handles

Several tools already partially do per-vertex edits (polyline, line,
shape). After this spec lands those bespoke paths route through
`applyGripStretch`. The existing `HANDLE_TYPES.TOP_LEFT` etc. continue to
work for non-grip resize gestures (e.g. Shift+drag for proportional
scale), but their visual is replaced by the grip rendering when grips are
on.

## Persistence (PDF + XFDF)

None. Grips are pure UI; what gets saved is the post-stretch annotation
geometry, which already round-trips today.

## Out of scope (YAGNI)

- Multi-grip simultaneous stretch (selecting 2+ grips with shift-click).
- Hot-grip menu (right-click on grip for Stretch / Move / Rotate /
  Scale / Mirror submenu — that's deferred to spec 4 commands).
- Custom grip glyphs per annotation type (everyone gets squares).
- Grip stretch on text/textbox (use existing edit flow).
- Grip stretch on image annotations.
- Auto-tracking acquired points (deferred to spec 5/6).

## Testing (manual smoke)

1. Draw a line. Select it. Three yellow squares appear.
2. Hover the start grip — it turns blue. Click — turns red, tracking
   line appears.
3. Move cursor; line endpoint follows; tracking line draws from original
   start to cursor. Click again to commit.
4. Esc during stretch on the same line — line snaps back unchanged.
5. Type `100` Enter during stretch — endpoint placed at exactly 100 mm
   from base in cursor direction (verifies type-length integration).
6. Polyline: vertex grip stretches one vertex; edge-mid grip inserts a
   new vertex and stretches it.
7. Circle: quadrant grip resizes radius; center grip moves whole circle.
8. Rectangle: corner grip resizes via opposite pivot; edge-mid stretches
   one side; center grip moves.
9. Undo restores pre-stretch state.
10. Multiple selected annotations: each shows its own grip set; clicking
    one of them enters stretch only on that annotation.
