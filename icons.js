const shapes = {
  brand:
    '<path d="m4 9 8-4 8 4v9l-8 4-8-4zM4 9l8 4 8-4M12 13v9"/><path d="M8 7l8 4"/>',
  cube: '<path d="m3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10"/>',
  room: '<path d="M3 20V5h17v15h-7m-4 0H3m6 0v-6l4 3"/>',
  bag: '<path d="M4 7h16l1 14H3L4 7zM8 9V6a4 4 0 0 1 8 0v3"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  rotate: '<path d="m15 3 5 1-1 5M19 5a8 8 0 1 0 1 11"/>',
  move: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M5 9l-3 3 3 3m4 4 3 3 3-3m4-10 3 3-3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  focus:
    '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><circle cx="12" cy="12" r="2"/>',
  sparkles:
    '<path d="m10 4 2.2 6.8 6.8 2.2-6.8 2.2L10 22l-2.2-6.8L1 13l6.8-2.2zM19 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="8" r="1"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  swap: '<path d="M3 7h16l-4-4m6 14H5l4 4"/>',
  link: '<path d="M13 3h8v8m0-8L10 14m0-9H4v16h16v-6"/>',
  sofa: '<path d="M5 11V7q0-2 2-2h10q2 0 2 2v4M5 19v2m14-2v2M2 11h4v4h12v-4h4v8H2z"/>',
  chair: '<path d="M6 13 5 4h13l-1 9M5 13h14v3H5zm2 3-2 5m12-5 2 5"/>',
  lamp: '<path d="M6 11 9 4h6l3 7zM12 11v9m-5 0h10"/>',
  table: '<path d="M2 9h20v3H2zm3 3-1 8m15-8 1 8"/>',
  rug: '<path d="M5 5h14v14H5zm3 3h8v8H8zM6 2v3m4-3v3m4-3v3m4-3v3M6 19v3m4-3v3m4-3v3m4-3v3"/>',
  plant:
    '<path d="M7 15h10l-2 6H9zm5 0V8m0 4Q3 12 4 5q7 0 8 7zm0-2q0-7 8-8 0 7-8 8z"/>',
  cabinet: '<path d="M4 3h16v17H4zm0 8h16M6 20v2m12-2v2M10 7h4m-4 8h4"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
};
export function icon(name) {
  return (
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
    (shapes[name] || shapes.cube) +
    "</svg>"
  );
}
