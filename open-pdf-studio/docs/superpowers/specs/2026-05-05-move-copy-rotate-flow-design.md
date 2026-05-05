# Move / Copy / Rotate Basepoint Flow — Design

Date: 2026-05-05

## Goal

Add AutoCAD-style two-click Move (M), Copy (CO), and Rotate (RO) commands.
The user selects objects, invokes the command, picks a base point, then
picks a destination (or rotation angle). A live tracking line plus
coord-input HUD are visible throughout. Copy supports multi-copy mode (keep
placing copies until Esc). Move/Copy/Rotate also work via grip menus and
are integrated with the chord system and snap pipeline. The existing
`g-move-mode.js` (G-key drag) is rewritten to use this same flow with an
explicit base point instead of cursor-position.

## Data model

New `interactionStore` slice `commandFlow`:

```ts
commandFlow: {
  cmd: 'move' | 'copy' | 'rotate' | null,
  phase: 'idle' | 'awaitBase' | 'awaitTarget',
  basePoint: {x, y, page} | null,
  livePoint: {x, y} | null,
  selection: string[] | null,        // annotation ids snapshotted at command start
  ghosts: object[] | null,           // deep-clones for live preview
  multiCopy: boolean,                // Copy command stays in awaitTarget loop
  initialAngle: number | null,       // rotate: stored at base pick
}
```

No annotation schema changes.

## UI / interaction

### Command lifecycle

```
idle
  → invoke(M|CO|RO)         (chord, ribbon button, or context menu)
  → phase=awaitBase
       cursor crosshair, prompt: "Specify base point:"
  → click ⟶ basePoint set; ghosts cloned from selection
  → phase=awaitTarget
       prompt: "Specify destination:" (move/copy)
                | "Specify rotation angle:" (rotate)
       tracking line basePoint → cursor
       coord-input HUD active
       ghost preview rendered translated/rotated to (cursor − base)
  → click commit:
       move: apply translate to selection, exit
       copy: clone selection at offset, multiCopy → loop awaitTarget; else exit
       rotate: apply rotation to selection, exit
  → Esc cancel at any phase: discard ghosts, restore selection
```

### Visuals

- Base-point phase: cursor is a crosshair (only place in app where cursor
  changes; complies with CLAUDE.md "default cursor except PDF area").
- Tracking line: dashed 1 px, current annotation color, basePoint→cursor.
- Ghost preview: each selected annotation drawn at 50% opacity at the
  pending offset/rotation.
- Rotate: a faint arc from `initialAngle` to current cursor angle around
  basePoint, plus a degree readout floating 14 px above-right of cursor:
  `45.000°`. Honors polar-tracking increments (spec 5).
- Status-bar text mirrors the prompt.

### Multi-copy mode

Copy stays in `awaitTarget` after each click. New ghosts appear at each
new offset (relative to original basePoint, not last copy — matches
AutoCAD `COPY` default). Esc or Enter exits.

### Coord-input integration

In `awaitTarget`, the user can type:

- `100` → distance 100 in current cursor direction
- `100,50` → relative @100,50 from base
- `100<45` → polar @100 at 45°
- `=200,300` → absolute point (page coords)

See spec 6 for HUD details.

### Chord registration

Add to `CAD_CHORDS` in `keyboard-handlers.js`:

```
M  → invokeCommand('move')
CO → invokeCommand('copy')
RO → invokeCommand('rotate')
MI → invokeCommand('mirror')   // stub, see Out of scope
AR → invokeCommand('array')    // stub
```

Single-letter `M` already exists; ensure prefix logic still allows `MI`
to be reachable (existing chord buffer already supports prefixes).

### G-key migration

Current `g-move-mode.js` enters move-by-cursor immediately on G. New
behaviour: `G` is a shortcut for `M` and routes through `commandFlow`.
The old per-cursor drag is removed (replaced by base-point pick).

## Components / files touched

- `js/core/stores/interaction-store.ts` — new `commandFlow` slice +
  actions `startCommand`, `setBasePoint`, `updateLivePoint`,
  `commitCommand`, `cancelCommand`, `toggleMultiCopy`.
- `js/tools/tools/move-tool.js` — NEW; thin tool that drives the flow
  with `cmd: 'move'`.
- `js/tools/tools/copy-tool.js` — NEW; same with `cmd: 'copy'`,
  `multiCopy: true`.
- `js/tools/tools/rotate-tool.js` — NEW; same with `cmd: 'rotate'`.
- `js/tools/tools/index.js` — register the three.
- `js/tools/tool-registry.js` — register tool ids.
- `js/tools/keyboard-handlers.js` — chord entries; Esc/Enter handlers
  while `commandFlow.cmd` set; remove old G-key inline drag, replace with
  `invokeCommand('move')`.
- `js/tools/g-move-mode.js` — DELETE (or reduce to a thin re-export for
  backward compat).
- `js/annotations/transforms.js` — `applyTranslate(ann, dx, dy)`,
  `applyRotateAround(ann, cx, cy, theta)` (extend existing if present).
- `js/annotations/rendering/decorations.js` — tracking line, ghost
  preview, rotation arc + degree readout.
- `js/solid/components/CommandHUD.jsx` — NEW small status-bar prompt
  ("Specify base point:" etc.).
- `js/solid/components/ribbon/HomeTab.jsx` (or DrawingTab) — Move /
  Copy / Rotate buttons that dispatch `invokeCommand`.
- `js/i18n/locales/*/ribbon.json`, `*/context.json` — prompt strings,
  button labels (37 langs).

## Persistence (PDF + XFDF)

None. Result of the flow is mutated/cloned annotations — already
serialised.

## Out of scope (YAGNI)

- Mirror (MI) and Array (AR) implementations beyond chord stubs that
  show "Not yet implemented" toast.
- Reference-angle rotate (`R`-suboption in AutoCAD).
- Move/Copy across pages.
- Snap-from-base-point construction (treat base as start of subsequent
  geometry).
- Path-array, polar-array.
- Object scale (SC) command.

## Testing (manual smoke)

1. Select 2 lines and a circle. Type `M`. Status bar shows "Specify base
   point:". Crosshair cursor.
2. Click — ghosts of the 3 annotations follow the cursor. Tracking line
   from base to cursor.
3. Click destination — annotations translated by exactly `dest − base`.
4. Undo restores. Re-select. Type `CO`. Pick base, place 3 copies, Esc.
   Three copies created, original untouched.
5. Type `RO` with selection. Pick base. Move cursor — degree readout
   updates, ghost rotates around base. Click — applied.
6. With polar-tracking on (F10), rotation snaps to 45° increments.
7. Type `100<30` Enter during Move — translates @100 at 30°.
8. Type `=400,500` Enter during Move — translates so base lands on
   absolute (400,500).
9. Esc during awaitBase — flow exits cleanly, no annotation change.
10. Press G with selection — opens Move flow (same as M).
