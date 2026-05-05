# Live Coordinate Input — Design

Date: 2026-05-05

## Goal

Replace the existing `type-length-input.js` (length-only) with a richer
coord-input module that supports four AutoCAD-style entry formats during
any placement, drawing, or move/copy/rotate flow. A floating HUD shows
the buffer being typed, format hints, and the resolved point. The new
module remains backward-compatible: typing only digits still behaves as
length-only entry.

## Data model

New `interactionStore` slice `coordInput`:

```ts
coordInput: {
  active: boolean,        // any tool/flow declared it active
  buffer: string,         // raw user input
  parsed: {
    kind: 'length' | 'relativeXY' | 'polar' | 'absolute' | 'invalid',
    a: number | null,     // length / dx / r / x
    b: number | null,     // dy / theta / y
  } | null,
  anchor: {x, y} | null,  // basis for relative/length modes
  cursorDir: number | null,  // current cursor angle from anchor (radians)
  resolved: {x, y} | null,
  errorMsg: string | null,
  tabIndex: 0 | 1,        // which numeric field has focus when relativeXY/polar
}
```

No annotation schema changes.

## UI / interaction

### Supported formats

| Format        | Example     | Meaning                                  |
|---------------|-------------|------------------------------------------|
| length        | `100`       | distance 100 in current cursor direction |
| relative XY   | `100,50`    | offset @100,50 from anchor               |
| polar         | `100<45`    | distance 100 at 45° from anchor          |
| absolute      | `=400,300`  | absolute page coords (top-left origin)   |

Detection rules (parsed live on each keystroke):

- starts with `=` → absolute (must contain `,` or `<`)
- contains `<` → polar (split on `<`)
- contains `,` → relative XY (split on `,`)
- otherwise → length (must be numeric, decimal point allowed)

Decimal separator: locale-aware via i18next number formatting; both `.`
and `,` accepted as decimal when there's only one numeric token (i.e.
`100,5` is ambiguous → resolved by checking if the active locale uses
`,` decimal AND no `<`/`=`; if ambiguous, treat as relative XY).

### HUD

- Floating panel anchored 12 px below cursor.
- Three rows:
  1. Format glyph + buffer (`100<45` displayed as
     `100 < 45°` after parse)
  2. Resolved point: `→ x=523.450, y=271.200` in scale-region's units
  3. Hint: format help (e.g. `Tab to switch field, Enter to commit`)
- Color: white background, 1 px `#888` border, `#000` text. Squared
  corners (Windows-style per CLAUDE.md).
- Errors: hint row turns red with the `errorMsg` (e.g. "Polar requires
  number<number").

### State machine

```
inactive (no tool placement active)
  → tool/flow declares active(anchor) → active, buffer=''
  → keypress digit/operator → append to buffer, reparse
  → Tab → cycle tabIndex (only meaningful when relative/polar/absolute);
          subsequent typing replaces the indexed field
  → Enter → commit if parsed.kind != 'invalid'
              tool consumes resolved point as if user clicked it
  → Esc → clear buffer (keep tool active)
  → tool ends → inactive
```

If buffer is empty and user clicks, the click coordinate is used as
normal (preserves current UX).

### Anchor selection

`anchor` is provided by the caller:

- Drawing tools: anchor = first click (or last placed vertex for
  polyline).
- Move/Copy: anchor = `commandFlow.basePoint`.
- Rotate: anchor = basePoint, but `<angle>` in polar form is interpreted
  as rotation angle directly (length component ignored unless reference
  geometry is being placed).
- Grip stretch: anchor = grip's original location.

### Pipeline integration

Coord-input is the **first** pass in `snapEngine.resolve(rawX, rawY,
ctx)`. If `coordInput.active && parsed.kind != 'invalid'`, the resolved
point overrides everything else. The cursor is visually drawn at the
resolved point (so user sees exactly where Enter will land).

## Components / files touched

- `js/tools/coord-input.js` — NEW; replaces `type-length-input.js`.
  Public API:
  - `attach(anchor, opts)` — declares active
  - `detach()` — declares inactive
  - `feedKey(key)` — returns true if consumed
  - `getResolved(cursorDir, cursorPos)` — returns the {x, y} to use
  - `parse(buffer)` — internal
- `js/tools/type-length-input.js` — DELETE (re-export shim during
  transition).
- `js/tools/snap-engine.js` — first-pass override (see spec 5).
- `js/tools/keyboard-handlers.js` — when `coordInput.active`, feed all
  printable keys into `coord-input.feedKey`; Tab/Enter/Esc routed
  there too.
- `js/solid/components/TypeLengthHUD.jsx` — replaced by
  `CoordInputHUD.jsx` (NEW). Subscribes to `coordInput` slice.
- `js/tools/tools/line-tool.js`, `polyline-tool.js`,
  `measurement-tool.js`, `arc-tool.js`, `shape-tool.js`,
  `move-tool.js`, `copy-tool.js`, `rotate-tool.js`, `select-tool.js`
  (grip stretch) — call `coordInput.attach(anchor)` on phase entry,
  `detach()` on exit.
- `js/i18n/locales/*/ribbon.json` (or new `coordInput.json`) — hint
  strings localized.

## Persistence (PDF + XFDF)

None. Input is transient.

## Out of scope (YAGNI)

- Construction-line entry (`@dx,dy,dz`).
- Bearings notation (`N45dE`).
- Survey notation.
- Calculator expressions (`50+25*2`).
- Variable references (`@last`, `@end`).
- Mid-buffer cursor positioning / arrow-key editing inside buffer.
- Auto-completing units suffix (`100mm` vs default unit).

## Testing (manual smoke)

1. Start drawing a line, click first point. Type `100` Enter — second
   point is exactly 100 mm in the current cursor direction.
2. Click first point. Type `100,50` Enter — second point at @100,50
   from first.
3. Click first point. Type `100<45` Enter — second point at distance
   100 at 45°.
4. Click first point. Type `=400,300` Enter — second point at absolute
   (400, 300).
5. HUD updates live as user types; resolved-point row updates each
   keystroke.
6. Invalid input (`100<<45`) shows red hint; Enter is a no-op.
7. Tab cycles fields when buffer is `100<45`; further typing replaces
   the focused number.
8. Esc clears buffer without exiting tool.
9. Locale set to NL (decimal `,`): typing `100,5` (no `<`) is treated as
   length 100.5; typing `100,50` with two-digit fractional is still
   ambiguous → spec defaults to **length** when no `<` and exactly one
   comma; document this in HUD hint.
10. Inside Move flow with base point set: same four formats work; line
    of motion preview updates live.
11. During grip stretch on a circle's quadrant: `100` Enter → radius
    becomes 100.
