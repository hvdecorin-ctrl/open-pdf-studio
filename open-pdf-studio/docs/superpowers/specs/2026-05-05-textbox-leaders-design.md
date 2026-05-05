# Textbox Leaders — Design

Date: 2026-05-05

## Goal

Allow a textbox annotation to have zero or more "leaders" — kinked lines from
the textbox to a point in the document, with an arrow or circle endpoint and a
draggable knee (grip) point. The user can add and remove leaders while the
textbox is selected, and the anchor side on the textbox auto-flips when the
tip is dragged to a different side.

This generalizes the existing single-leader `callout` type to multi-leader on
the regular `textbox`. `callout` stays untouched for backward compatibility.

## Data model

New optional property on `textbox` annotations:

```js
annotation.leaders = [
  {
    id: string,            // unique within the annotation
    tipX, tipY: number,    // endpoint in app coords (PDF user units)
    kneeX, kneeY: number,  // knee/grip point in app coords
    endStyle: 'arrow' | 'circle',  // default 'arrow'
  },
  ...
]
```

Anchor side is **derived**, not stored: at render/drag time `_pickAnchorSide(box, kneeX, kneeY)` picks `top|right|bottom|left` whose midpoint is closest to the knee. The path is `anchor(side) → knee → tip`. Dragging `tip` or `knee` to the other side flips the anchor automatically.

## Components

### Rendering (`js/annotations/rendering.js`, `selection.js`)
- After drawing the textbox body, iterate `leaders[]` and draw polyline anchor→knee→tip in the textbox stroke color & line width.
- Endpoint: `arrow` = filled triangle along (tip-knee) direction; `circle` = filled disc r=4 px.
- When the textbox is selected, also draw:
  - `tip` handle (square, like resize handles)
  - `knee` handle (square, slightly smaller)
  - `×` button at tip + 14 px offset (delete leader)
  - `+` button at top-right corner of the textbox, 16 px outside (add leader)

### Handles (`js/annotations/handles.js`)
- Extend `getAnnotationHandles(textbox)` to emit one `LEADER_TIP_<id>`, `LEADER_KNEE_<id>`, `LEADER_DELETE_<id>` per leader, plus a single `LEADER_ADD` button.
- `findHandleAt` returns the matching handle when cursor is over its rect.

### Hit-testing (`js/annotations/geometry.js`)
- Selection hit: textbox body OR within 4 px of any leader segment.

### Transforms (`js/annotations/transforms.js`)
- `applyMove(textbox, dx, dy)`: also shift each leader's `tipX/Y, kneeX/Y` by the same delta.
- `applyResize(textbox, ...)`: keep leaders absolute (don't scale tips); the anchor side is rederived so the line snaps to the new edge.
- New `_handleResize` branch for handles starting with `LEADER_TIP_`/`LEADER_KNEE_` — drag updates that single point.

### Tool wiring (`js/tools/tools/select-tool.js`)
- On pointerdown over `LEADER_ADD`: append `{id: nanoid(), tipX: x+pageW*0.15, tipY: y, kneeX: x+pageW*0.08, kneeY: y, endStyle: 'arrow'}` to leaders, redraw, record undo.
- On pointerdown over `LEADER_DELETE_<id>`: splice that leader, redraw, record undo.

### Persistence (`js/pdf/saver.js`, `xfdf.js`) — Option B (compatible)
On save:
- Write the textbox as a normal FreeText annotation as today.
- For each leader, write a separate standard PDF **Line** annotation (subtype `/Line`) with:
  - `L` = `[anchorX anchorY tipX tipY]` (PDF coords)
  - `LE` = `[/None /OpenArrow]` for `arrow`, `[/None /Circle]` for `circle`
  - `IT` = `/LineDimension` not appropriate; use plain Line
  - `IRT` = textbox's object reference (in-reply-to)
  - Optional: store the knee point in the Line's `BS` or in a private XFDF key `<openpdfstudio:knee x="…" y="…"/>` so we can restore the kink on reload. PDF `Line` is straight 2-point — Acrobat will render it straight.
  - For a polyline appearance preserving the kink in PDF natively, fall back to subtype `/PolyLine` with `Vertices = [anchorX anchorY kneeX kneeY tipX tipY]` and `LE` on the last vertex. Use PolyLine because it natively shows the kink in any compliant viewer.

**Decision: use `/PolyLine`** so other viewers see the kinked line correctly. Store endStyle in `LE`.

On load:
- Recognize `/PolyLine` annotations whose `IRT` points at a textbox we just loaded — attach as a leader instead of a standalone polyline. The first vertex = anchor (recompute side), middle vertex = knee, last = tip.
- If we don't have IRT linkage (XFDF-only viewers), fall back to standalone PolyLine annotations — no data loss.

### Type defs (`js/types/annotation.ts`)
- Add `leaders?: Leader[]` to `TextboxAnnotation`. Define `Leader` interface.

### Factory (`js/annotations/factory.js`)
- `createAnnotation({type:'textbox', ...})`: default `leaders: []`.

## Interaction details

- Add button (`+`): visible only when textbox is the single selected annotation. 16×16 px square with `+` glyph.
- Delete button (`×`): visible per leader when the parent textbox is selected. Positioned at `tip + 14 px` along the leader direction (away from knee) so it doesn't overlap the arrowhead.
- Tip drag: while dragging, recompute anchor side every frame from current knee→box geometry. Snap to nice sides (no diagonal anchors).
- Knee drag: simple point-move. Anchor side may also re-pick because it depends on knee position.

## Undo / redo

Each `+`, `×`, tip-drag, knee-drag commits a `recordModify(textboxId, beforeClone, afterClone)`.

## Out of scope (YAGNI)

- Rotation of leaders (textbox rotation also rotates leaders rigidly — handled by existing transform).
- Curved leaders, multi-knee leaders.
- Per-leader color/lineWidth (inherits from textbox).
- Locked/printable per leader.

## Files touched

- `js/types/annotation.ts`
- `js/annotations/factory.js`
- `js/annotations/rendering.js`
- `js/annotations/rendering/selection.js`
- `js/annotations/handles.js`
- `js/annotations/geometry.js`
- `js/annotations/transforms.js`
- `js/tools/tools/select-tool.js`
- `js/pdf/saver.js`
- `js/pdf/loader/annotation-converter.js` (recognize IRT-linked PolyLines)
- `js/annotations/xfdf.js`

## Testing

Manual via CDP:
1. Place a textbox, select it → `+` button visible at top-right.
2. Click `+` → leader appears with arrow endpoint, knee handle.
3. Drag tip across the box to opposite side → anchor flips automatically.
4. Drag knee → line bends, anchor re-picks if knee crosses median.
5. Click `×` → leader removed.
6. Add 3 leaders → save → reload → all 3 visible with correct positions.
7. Open saved PDF in another viewer → leaders visible as kinked polylines with arrowheads.
8. Move/resize textbox → leaders move with it (tips relative); resize keeps tips at absolute coords with anchor side re-picking.
