# Selection Mode Parity — Design

Date: 2026-05-05

## Goal

Bring marquee selection to AutoCAD/BricsCAD parity. Two distinct modes
distinguished by drag direction:

- **Window select** (left → right drag): blue rectangle, only objects
  **fully contained** within the rectangle are selected.
- **Crossing select** (right → left drag): green rectangle, objects fully
  inside **or crossing** the rectangle are selected.

Adds Shift-click (additive) and Ctrl-click (toggle), preserves click-empty-
to-deselect, and keeps the existing click-and-drag-on-object move
behaviour. Extends `select-tool.js` cleanly without breaking other paths.

## Data model

`interactionStore.marquee` slice:

```ts
marquee: {
  active: boolean,
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  page: number,
  mode: 'window' | 'crossing',     // derived: curX < startX → crossing
  modifier: 'replace' | 'add' | 'toggle',  // from initial pointerdown
}
```

No annotation changes.

## UI / interaction

### Visuals

- Window mode: rectangle outline 1 px solid `#3b82f6` (blue), fill
  `rgba(59,130,246,0.10)`.
- Crossing mode: rectangle outline 1 px **dashed** `#10b981` (green),
  fill `rgba(16,185,129,0.10)`.
- Mode color and dash pattern flip live as cursor crosses startX (drag
  back and forth flips between blue and green).
- Drawn in `decorations.js`.

### State machine (select tool, idle phase)

```
pointerdown
  ├ over annotation? → existing drag/move flow (no change)
  ├ over a grip?     → grip stretch (spec 3)
  └ over empty area:
       record (startX, startY, page, modifier from Shift/Ctrl)
       → marquee.active = true, mode='window'
pointermove
  → marquee.curX/Y updated
  → mode = curX < startX ? 'crossing' : 'window'
  → live preview: highlight candidate annotations using mode rule
pointerup
  → compute final selection set (see rules below)
  → apply modifier:
       replace → setSelection(set)
       add     → addToSelection(set)
       toggle  → toggleSelection(set)
  → marquee.active = false
Esc during marquee → cancel; selection unchanged
```

### Hit rule

For each annotation on the active page, compute its tight axis-aligned
bounding rectangle (existing `getAnnotationBounds` in `geometry.js`).

- **window**: select iff bounds fully inside marquee rect.
- **crossing**: select iff bounds intersect or are fully inside marquee
  rect; for line/polyline annotations, use precise segment-vs-rect
  intersection (cheap Cohen-Sutherland) to avoid false negatives on
  long thin lines whose AA bounds overflow the marquee.

Annotations on other pages are never selected by marquee (matches
existing per-page selection model).

### Modifier keys

- Plain pointerdown on empty: `replace` — replaces selection.
- Shift+pointerdown on empty: `add` — additive.
- Ctrl+pointerdown on empty: `toggle` — XORs marquee result with current
  selection.
- Plain click on annotation: replace selection with that annotation
  (existing behaviour preserved).
- Shift+click on annotation: add to selection.
- Ctrl+click on annotation: toggle that annotation in selection.
- Click on empty (no drag): deselect all (replace mode); or no-op for
  add/toggle.

### Live preview

While dragging, candidate annotations are drawn with a half-strength
selection halo so the user sees what will be selected on release.
Implemented by `selection-helpers.ts` adding a transient
`previewSelection: string[]` field consulted by
`rendering/selection.js`.

## Components / files touched

- `js/core/stores/interaction-store.ts` — `marquee` slice + actions
  `startMarquee`, `updateMarquee`, `commitMarquee`, `cancelMarquee`.
- `js/core/stores/selection-helpers.ts` — `previewSelection` field +
  `setPreviewSelection`, `clearPreviewSelection`,
  `addToSelection`, `toggleSelection` (latter may already exist —
  verify, extend if missing).
- `js/tools/tools/select-tool.js` — pointerdown/move/up logic above.
  Existing on-object drag-move path stays untouched.
- `js/annotations/geometry.js` — `getAnnotationBounds(ann)` helper
  (consolidate any existing per-type bounds funcs); new
  `segmentIntersectsRect(p1, p2, rect)` for precise crossing test on
  line-like annotations.
- `js/annotations/rendering/decorations.js` — render marquee rect.
- `js/annotations/rendering/selection.js` — render preview halo when
  `previewSelection` set.
- `js/tools/keyboard-handlers.js` — Esc cancels active marquee.
- `js/i18n/locales/*/context.json` — status-bar prompt strings
  ("Window select" / "Crossing select").

## Persistence (PDF + XFDF)

None. Selection is transient session state.

## Out of scope (YAGNI)

- Lasso (free-form polygon) selection — `WPolygon` / `CPolygon` /
  `Fence` modes from AutoCAD.
- Implied windowing (the AutoCAD-specific behaviour where selection
  starts the moment any non-pickable area is clicked, regardless of
  command).
- Subobject selection (handles within an annotation).
- Cross-page marquee.
- Selection cycling (Tab through overlapping annotations under cursor).
- Quick Select / Filter dialog.
- Object groups.

## Testing (manual smoke)

1. Open PDF with mixed annotations spread on the page.
2. Drag from upper-left to lower-right across some annotations — blue
   solid rectangle. Only the annotations fully inside get the preview
   halo. Release → those become selected.
3. Drag from lower-right to upper-left across the same annotations —
   green dashed rectangle; partially-crossed annotations also get
   halo. Release → all of them selected.
4. Cross the start X mid-drag — rectangle flips between blue/green
   live; preview set updates.
5. Shift-drag a marquee — adds to current selection (existing
   selection preserved).
6. Ctrl-drag a marquee over a mix of selected and unselected — toggles.
7. Plain click on empty — deselects everything.
8. Plain click on an annotation — selects only it (existing).
9. Shift-click an annotation — added to selection.
10. Ctrl-click a selected annotation — removed from selection.
11. Esc during marquee — selection unchanged, marquee disappears.
12. Click-and-drag starting **on** an annotation still moves the
    selection (no marquee starts, regression-checks existing
    behaviour).
13. A long line that bisects the marquee in crossing mode is selected
    (verifies precise segment-rect test, not just AA-bounds overlap).
