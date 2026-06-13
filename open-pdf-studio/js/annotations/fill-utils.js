// Single source of truth for "does this annotation have a fill?".
//
// A fill color counts as NO fill when it is absent or one of the sentinel
// no-fill values. 'none' is the canonical no-fill value the app writes for new
// annotations; 'transparent' is treated identically because (a) older saved
// data and some creators historically used it, and (b) the user asked that
// "transparant" behave as "geen" everywhere.
//
// Why this matters: hexToColorArray('transparent') / hexToColorArray('none')
// resolve to BLACK. Any save path that wrote /IC or /C without excluding these
// sentinels produced a black fill that reopened as an opaque black box. Routing
// every fill decision through hasFill() guarantees no-fill stays no-fill across
// rendering, saving and loading.
export function hasFill(color) {
  return !!color && color !== 'none' && color !== 'transparent';
}

// Normalise a fill value to the canonical form: a real color, or 'none'.
// Use when storing fill on an annotation so 'transparent'/null collapse to
// the single sentinel the rest of the app understands.
export function normalizeFill(color) {
  return hasFill(color) ? color : 'none';
}
