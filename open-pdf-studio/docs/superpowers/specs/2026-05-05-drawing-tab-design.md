# Drawing Tab — Design

Date: 2026-05-05
Source: User screenshot of Open 2D Studio's Drawing tab + user request "Maak een aparte tab voor tekenen die net zo werkt als de tekentab bij Open 2D Studio".

## Goal

Add a new top-level ribbon tab **"Tekenen"** (Drawing) to Open PDF Studio, structured identically to Open 2D Studio's Drawing tab. Reuses existing PDF Studio tools where they map; greys out / hides items that don't exist yet (no new tool implementations in this pass).

The existing **"Opmerkingen en tekenen"** tab is left untouched — the new Drawing tab is additive.

## Reference structure (from screenshot)

8 ribbon groups, left to right:

1. **SELECTION** — Select, Pan, Select All, Deselect, Find/Replace
2. **DRAW** — Line, Rectangle, Arc, Polyline, Hatch, Text, Note (?), Spline, Circle, Ellipse, Pattern-rect, L-shape, Image
3. **ANNOTATE** — Aligned, Linear, Angular, Spot coord., Radius, Diameter, Leader, Label, Table, Cloud, Measure
4. **MODIFY** — Move, Copy, Rotate, Mirror, Array
5. **EDIT** — Trim, Extend, Offset, Fillet, Chamfer, Stretch, Split, Align, Explode, Break, Join, Lengthen
6. **CLIPBOARD** — Paste, Cut, Copy, Delete
7. **COLLECTION** — Create, Explode
8. **SETTINGS** — Settings

## Mapping to existing PDF Studio tools

| Open 2D button | PDF Studio status | Wiring |
|---|---|---|
| **SELECTION** | | |
| Select | ✅ exists | `setTool('select')` |
| Pan | ✅ exists | `setTool('hand')` |
| Select All | ✅ exists | `selectAll()` action |
| Deselect | ✅ exists | `clearSelection()` |
| Find/Replace | ✅ exists | toggle find-bar |
| **DRAW** | | |
| Line | ✅ | `setTool('line')` |
| Rectangle | ✅ | `setTool('box')` |
| Arc | ✅ | `setTool('arc')` |
| Polyline | ✅ | `setTool('polyline')` |
| Hatch | ✅ via filledArea | `setTool('filledArea')` |
| Text | ✅ | `setTool('textbox')` |
| Note | ✅ | `setTool('comment')` |
| Spline | ✅ | `setTool('spline')` |
| Circle | ✅ | `setTool('circle')` |
| Ellipse | ⚠ same as circle (treated as ellipse internally) | `setTool('circle')` |
| Pattern-rect | ❌ deferred | greyed |
| L-shape | ❌ deferred | greyed |
| Image | ✅ | `setTool('image')` |
| **ANNOTATE** | | |
| Aligned dim | ✅ | `setTool('measureDistance')` |
| Linear dim | ⚠ uses aligned with ortho lock | `setTool('measureDistance')` (Shift constrains) |
| Angular | ✅ | `setTool('measureAngle')` |
| Spot coord. | ❌ deferred | greyed |
| Radius | ❌ deferred | greyed |
| Diameter | ❌ deferred | greyed |
| Leader | ✅ via callout | `setTool('callout')` |
| Label | ⚠ via textbox | `setTool('textbox')` |
| Table | ✅ | `setTool('scheduleTable')` |
| Cloud | ✅ | `setTool('cloud')` |
| Measure (perimeter/area) | ✅ | `setTool('measurePerimeter')` |
| **MODIFY** | | |
| Move | ✅ G-key + button | invokes G-move on selection |
| Copy | ✅ Ctrl+D / button | duplicate annotation |
| Rotate | ⚠ via handle only | greyed for now (no batch rotate command) |
| Mirror | ✅ flipX/flipY | invokes flip action |
| Array | ✅ exists | invokes array tool |
| **EDIT** | | |
| Trim | ✅ | trim tool |
| Extend | ✅ | extend tool |
| Offset | ❌ deferred | greyed |
| Fillet | ❌ deferred | greyed |
| Chamfer | ❌ deferred | greyed |
| Stretch | ❌ deferred | greyed |
| Split | ❌ deferred | greyed |
| Align | ✅ partial | invokes alignment-tool action |
| Explode | ❌ deferred | greyed |
| Break | ❌ deferred | greyed |
| Join | ❌ deferred | greyed |
| Lengthen | ❌ deferred | greyed |
| **CLIPBOARD** | | |
| Paste | ✅ | Ctrl+V handler |
| Cut | ✅ | Ctrl+X |
| Copy | ✅ | Ctrl+C |
| Delete | ✅ | Del key |
| **COLLECTION** | | |
| Create | ❌ deferred | greyed |
| Explode | ❌ deferred (same as Edit/Explode) | greyed |
| **SETTINGS** | | |
| Settings | ✅ | open Preferences dialog |

**Coverage**: ~65% of buttons map to existing tools. The other ~35% are placeholders for future work — render them as disabled buttons with the same icon position so the layout matches Open 2D Studio.

## Implementation

### New file
- `js/solid/components/ribbon/DrawingTab.jsx` — replicates the 8-group layout, uses existing `RibbonGroup` / `RibbonButton`. Disabled buttons get `disabled` prop + tooltip "Coming soon".

### Edits
- `js/solid/components/ribbon/Ribbon.jsx` — add `'drawing'` to tab list between `'comment'` and `'view'`. Add `<Match when={activeTab() === 'drawing'}><DrawingTab /></Match>`.
- `js/i18n/locales/nl/ribbon.json` — `tabs.drawing: "Tekenen"`. Add `drawing.selection`, `drawing.draw`, `drawing.annotate`, `drawing.modify`, `drawing.edit`, `drawing.clipboard`, `drawing.collection`, `drawing.settings` group labels. Per-button labels reuse existing keys (`comment.line`, `comment.box`, etc.) where possible — only add new keys for genuinely new labels.
- `js/i18n/locales/en/ribbon.json` — same with English.

### Disabled button styling
- Use existing `RibbonButton`'s `disabled` prop. If it doesn't exist, add: pass-through CSS opacity 0.4, no hover effect, cursor: default, no click handler.

### Keep both tabs
The merged "Opmerkingen en tekenen" tab stays as it was — the new Drawing tab is a SECOND way to access these tools, organized like a CAD app rather than a PDF annotator. Users can pick whichever fits their flow.

## Out of scope (YAGNI)

- No new tools (Offset, Fillet, Chamfer, Spot Coord, Radius, Diameter, Pattern-rect, L-shape, Create-block, Explode-block, Break, Join, Lengthen, Stretch, Split). These get greyed buttons only. Each is its own future spec.
- No keyboard shortcut overhaul.
- No removal/cleanup of the existing Comment tab.
- 35 missing locales — Dutch + English only this pass; fallback strings prevent broken UI.

## Files touched

| File | Change |
|---|---|
| `js/solid/components/ribbon/DrawingTab.jsx` | NEW |
| `js/solid/components/ribbon/Ribbon.jsx` | register tab |
| `js/i18n/locales/nl/ribbon.json` | + `tabs.drawing`, group labels |
| `js/i18n/locales/en/ribbon.json` | same EN |

## Testing

Manual via the running dev app:
1. Reload (Ctrl+R)
2. Top tab bar shows: File, Home, Opmerkingen en tekenen, **Tekenen**, View, Organize, AI, Help
3. Click Tekenen → 8 groups visible matching screenshot order
4. Active tools work (click Line → select-tool stops, line-tool active)
5. Greyed tools have reduced opacity, no click effect, tooltip "Binnenkort beschikbaar" / "Coming soon"
