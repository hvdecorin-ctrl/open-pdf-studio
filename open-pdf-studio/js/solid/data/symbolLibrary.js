// Built-in symbol library — sourced from Project Ocondat (https://github.com/OpenAEC-Foundation/Project-Ocondat)
// Each SVG uses viewBox="0 0 64 64", stroke-based design for scalability.

export const BUILT_IN_CATEGORIES = [
  {
    id: 'electrical',
    name: 'Electrical',
    color: '#2563eb',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1L4 9h4l-1 6 5-8H8l1-6z"/></svg>`,
    symbols: [
      { id: 'duplex-outlet', name: 'Duplex Outlet', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="28" fill="none" stroke="#000" stroke-width="2"/><line x1="20" y1="22" x2="20" y2="32" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><line x1="44" y1="22" x2="44" y2="32" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><path d="M26 40 Q32 46 38 40" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>` },
      { id: 'gfi-outlet', name: 'GFI Outlet', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="28" fill="none" stroke="#000" stroke-width="2"/><line x1="20" y1="22" x2="20" y2="32" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><line x1="44" y1="22" x2="44" y2="32" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><path d="M26 40 Q32 46 38 40" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/><text x="32" y="58" font-size="9" font-family="Arial" fill="#000" text-anchor="middle">GFI</text></svg>` },
      { id: 'single-pole-switch', name: 'Single Pole Switch', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="40" r="4" fill="#000"/><line x1="16" y1="40" x2="48" y2="20" stroke="#000" stroke-width="2"/><text x="50" y="24" font-size="14" font-family="Arial" fill="#000">S</text></svg>` },
      { id: 'three-way-switch', name: 'Three-Way Switch', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="40" r="4" fill="#000"/><line x1="16" y1="40" x2="48" y2="20" stroke="#000" stroke-width="2"/><text x="46" y="24" font-size="12" font-family="Arial" fill="#000">S3</text></svg>` },
      { id: 'ceiling-light', name: 'Ceiling Light', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="12" fill="none" stroke="#000" stroke-width="2"/><line x1="20" y1="32" x2="44" y2="32" stroke="#000" stroke-width="2"/><line x1="32" y1="20" x2="32" y2="44" stroke="#000" stroke-width="2"/></svg>` },
      { id: 'fluorescent-light', name: 'Fluorescent Light', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="24" width="48" height="16" fill="none" stroke="#000" stroke-width="2"/><line x1="16" y1="28" x2="16" y2="36" stroke="#000" stroke-width="1.5"/><line x1="48" y1="28" x2="48" y2="36" stroke="#000" stroke-width="1.5"/></svg>` },
      { id: 'recessed-light', name: 'Recessed Light', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="14" fill="none" stroke="#000" stroke-width="2"/><line x1="22" y1="22" x2="42" y2="42" stroke="#000" stroke-width="1.5"/><line x1="42" y1="22" x2="22" y2="42" stroke="#000" stroke-width="1.5"/></svg>` },
      { id: 'wall-sconce', name: 'Wall Sconce', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><line x1="32" y1="48" x2="32" y2="28" stroke="#000" stroke-width="2"/><circle cx="32" cy="22" r="10" fill="none" stroke="#000" stroke-width="2"/><line x1="32" y1="12" x2="32" y2="32" stroke="#000" stroke-width="1.5"/></svg>` },
      { id: 'emergency-light', name: 'Emergency Light', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="20" width="32" height="24" fill="none" stroke="#000" stroke-width="2" rx="2"/><circle cx="26" cy="32" r="5" fill="none" stroke="#000" stroke-width="1.5"/><circle cx="38" cy="32" r="5" fill="none" stroke="#000" stroke-width="1.5"/><text x="32" y="56" font-size="8" font-family="Arial" fill="#000" text-anchor="middle">EM</text></svg>` },
      { id: 'electrical-panel', name: 'Electrical Panel', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="8" width="40" height="48" fill="none" stroke="#000" stroke-width="2"/><line x1="12" y1="20" x2="52" y2="20" stroke="#000" stroke-width="1.5"/><line x1="32" y1="20" x2="32" y2="56" stroke="#000" stroke-width="1.5"/><rect x="16" y="24" width="12" height="4" fill="#000"/><rect x="36" y="24" width="12" height="4" fill="#000"/><rect x="16" y="32" width="12" height="4" fill="#000"/><rect x="36" y="32" width="12" height="4" fill="#000"/><rect x="16" y="40" width="12" height="4" fill="#000"/><rect x="36" y="40" width="12" height="4" fill="#000"/></svg>` },
      { id: 'junction-box', name: 'Junction Box', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="16" y="16" width="32" height="32" fill="none" stroke="#000" stroke-width="2"/><circle cx="32" cy="32" r="3" fill="#000"/></svg>` },
    ]
  },
  {
    id: 'fire-safety',
    name: 'Fire / Safety',
    color: '#dc2626',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1C8 1 3 6 3 10a5 5 0 0010 0C13 6 8 1 8 1z"/></svg>`,
    symbols: [
      { id: 'fire-alarm-pull', name: 'Fire Alarm Pull', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="10" width="36" height="44" fill="none" stroke="#d00" stroke-width="2.5" rx="3"/><text x="32" y="28" font-size="10" font-weight="bold" font-family="Arial" fill="#d00" text-anchor="middle">FIRE</text><text x="32" y="40" font-size="9" font-family="Arial" fill="#d00" text-anchor="middle">PULL</text><line x1="22" y1="48" x2="42" y2="48" stroke="#d00" stroke-width="2"/></svg>` },
      { id: 'smoke-detector', name: 'Smoke Detector', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="20" fill="none" stroke="#000" stroke-width="2"/><text x="32" y="30" font-size="11" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">SD</text><circle cx="32" cy="42" r="3" fill="#d00"/></svg>` },
      { id: 'heat-detector', name: 'Heat Detector', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="20" fill="none" stroke="#000" stroke-width="2"/><text x="32" y="36" font-size="11" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">HD</text></svg>` },
      { id: 'fire-horn-strobe', name: 'Fire Horn/Strobe', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="20" fill="none" stroke="#d00" stroke-width="2"/><text x="32" y="30" font-size="9" font-weight="bold" font-family="Arial" fill="#d00" text-anchor="middle">H/S</text><path d="M22 42 L28 38 L28 46 Z" fill="#d00"/><line x1="34" y1="38" x2="42" y2="38" stroke="#d00" stroke-width="2"/><line x1="34" y1="42" x2="40" y2="42" stroke="#d00" stroke-width="2"/><line x1="34" y1="46" x2="38" y2="46" stroke="#d00" stroke-width="2"/></svg>` },
      { id: 'sprinkler-head', name: 'Sprinkler Head', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="24" r="8" fill="none" stroke="#000" stroke-width="2"/><line x1="32" y1="32" x2="32" y2="44" stroke="#000" stroke-width="2"/><line x1="22" y1="44" x2="42" y2="44" stroke="#000" stroke-width="2.5"/><line x1="24" y1="48" x2="20" y2="54" stroke="#06f" stroke-width="1.5"/><line x1="32" y1="48" x2="32" y2="54" stroke="#06f" stroke-width="1.5"/><line x1="40" y1="48" x2="44" y2="54" stroke="#06f" stroke-width="1.5"/></svg>` },
      { id: 'fire-extinguisher', name: 'Fire Extinguisher', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="22" y="16" width="20" height="38" rx="4" fill="none" stroke="#d00" stroke-width="2"/><rect x="28" y="10" width="8" height="8" fill="none" stroke="#d00" stroke-width="2"/><line x1="36" y1="14" x2="44" y2="10" stroke="#d00" stroke-width="2"/><text x="32" y="40" font-size="8" font-weight="bold" font-family="Arial" fill="#d00" text-anchor="middle">FE</text></svg>` },
      { id: 'exit-sign', name: 'Exit Sign', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="18" width="44" height="28" fill="none" stroke="#000" stroke-width="2" rx="2"/><text x="32" y="37" font-size="14" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">EXIT</text><line x1="32" y1="10" x2="32" y2="18" stroke="#000" stroke-width="2"/></svg>` },
    ]
  },
  {
    id: 'architectural',
    name: 'Architectural',
    color: '#374151',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="12" height="10" rx="1"/><line x1="8" y1="4" x2="8" y2="14"/><line x1="2" y1="9" x2="14" y2="9"/></svg>`,
    symbols: [
      { id: 'single-door', name: 'Single Door', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><line x1="8" y1="48" x2="56" y2="48" stroke="#000" stroke-width="3"/><line x1="8" y1="48" x2="8" y2="44" stroke="#000" stroke-width="3"/><line x1="40" y1="48" x2="40" y2="44" stroke="#000" stroke-width="3"/><path d="M8 48 A32 32 0 0 1 40 48" fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="4,2"/></svg>` },
      { id: 'double-door', name: 'Double Door', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="48" x2="60" y2="48" stroke="#000" stroke-width="3"/><line x1="4" y1="48" x2="4" y2="44" stroke="#000" stroke-width="3"/><line x1="60" y1="48" x2="60" y2="44" stroke="#000" stroke-width="3"/><path d="M4 48 A28 28 0 0 1 32 48" fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="4,2"/><path d="M60 48 A28 28 0 0 0 32 48" fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="4,2"/></svg>` },
      { id: 'window', name: 'Window', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><line x1="8" y1="28" x2="56" y2="28" stroke="#000" stroke-width="3"/><line x1="8" y1="36" x2="56" y2="36" stroke="#000" stroke-width="3"/><line x1="8" y1="28" x2="8" y2="36" stroke="#000" stroke-width="2"/><line x1="56" y1="28" x2="56" y2="36" stroke="#000" stroke-width="2"/><line x1="32" y1="28" x2="32" y2="36" stroke="#000" stroke-width="1.5"/></svg>` },
      { id: 'stairs-up', name: 'Stairs Up', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="44" height="44" fill="none" stroke="#000" stroke-width="2"/><line x1="10" y1="46" x2="54" y2="46" stroke="#000" stroke-width="1"/><line x1="10" y1="40" x2="54" y2="40" stroke="#000" stroke-width="1"/><line x1="10" y1="34" x2="54" y2="34" stroke="#000" stroke-width="1"/><line x1="10" y1="28" x2="54" y2="28" stroke="#000" stroke-width="1"/><line x1="10" y1="22" x2="54" y2="22" stroke="#000" stroke-width="1"/><line x1="10" y1="16" x2="54" y2="16" stroke="#000" stroke-width="1"/><polygon points="32,12 28,20 36,20" fill="#000"/><text x="32" y="56" font-size="8" font-family="Arial" fill="#000" text-anchor="middle">UP</text></svg>` },
      { id: 'elevator', name: 'Elevator', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="8" width="40" height="48" fill="none" stroke="#000" stroke-width="2"/><line x1="32" y1="8" x2="32" y2="56" stroke="#000" stroke-width="1.5"/><polygon points="22,24 18,32 26,32" fill="#000"/><polygon points="42,38 38,30 46,30" fill="#000"/></svg>` },
      { id: 'toilet', name: 'Toilet', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="8" width="24" height="16" rx="2" fill="none" stroke="#000" stroke-width="2"/><ellipse cx="32" cy="38" rx="16" ry="18" fill="none" stroke="#000" stroke-width="2"/></svg>` },
      { id: 'sink', name: 'Sink', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><ellipse cx="32" cy="36" rx="22" ry="16" fill="none" stroke="#000" stroke-width="2"/><circle cx="32" cy="40" r="4" fill="none" stroke="#000" stroke-width="1.5"/><line x1="32" y1="20" x2="32" y2="10" stroke="#000" stroke-width="2"/><line x1="26" y1="10" x2="38" y2="10" stroke="#000" stroke-width="2"/><circle cx="28" cy="10" r="2" fill="#000"/><circle cx="36" cy="10" r="2" fill="#000"/></svg>` },
    ]
  },
  {
    id: 'hvac',
    name: 'HVAC',
    color: '#059669',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v4M5 3l3 3 3-3M8 14v-4M5 13l3-3 3 3"/></svg>`,
    symbols: [
      { id: 'supply-diffuser', name: 'Supply Diffuser', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="12" width="40" height="40" fill="none" stroke="#000" stroke-width="2"/><line x1="12" y1="12" x2="52" y2="52" stroke="#000" stroke-width="1.5"/><line x1="52" y1="12" x2="12" y2="52" stroke="#000" stroke-width="1.5"/><text x="32" y="60" font-size="7" font-family="Arial" fill="#000" text-anchor="middle">SD</text></svg>` },
      { id: 'return-grille', name: 'Return Grille', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="12" width="40" height="40" fill="none" stroke="#000" stroke-width="2"/><line x1="12" y1="12" x2="52" y2="52" stroke="#000" stroke-width="1.5"/><text x="32" y="60" font-size="7" font-family="Arial" fill="#000" text-anchor="middle">RA</text></svg>` },
      { id: 'thermostat', name: 'Thermostat', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="18" fill="none" stroke="#000" stroke-width="2"/><text x="32" y="37" font-size="14" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">T</text></svg>` },
    ]
  },
  {
    id: 'data-telecom',
    name: 'Data / Telecom',
    color: '#7c3aed',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="7" rx="1"/><line x1="8" y1="10" x2="8" y2="13"/><line x1="5" y1="13" x2="11" y2="13"/></svg>`,
    symbols: [
      { id: 'data-outlet', name: 'Data Outlet', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="32,8 56,48 8,48" fill="none" stroke="#000" stroke-width="2"/><text x="32" y="42" font-size="11" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">D</text></svg>` },
      { id: 'telephone-outlet', name: 'Telephone Outlet', svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="32,8 56,48 8,48" fill="none" stroke="#000" stroke-width="2"/><text x="32" y="42" font-size="10" font-weight="bold" font-family="Arial" fill="#000" text-anchor="middle">TEL</text></svg>` },
    ]
  },
];
