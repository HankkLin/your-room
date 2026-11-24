const pictures = {
  mouse: '<rect x="5" y="1.5" width="14" height="21" rx="7"/><path d="M12 2v8H5"/><path d="M7 8a5 5 0 0 1 4-5v5z" fill="currentColor" stroke="none"/>',
  drag: '<path d="M3 18l2-11 8 8-5 .4-2 4zM12 5h9m-3-3 3 3-3 3"/>',
  map: '<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2zM8 3v15m8-12v15"/><circle cx="12" cy="11" r="2" fill="currentColor"/>',
  watch: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

function hint(symbol, label) {
  const graphic = Array.isArray(symbol)
    ? symbol.map(key => `<kbd>${key}</kbd>`).join("")
    : `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${pictures[symbol]}</svg>`;
  return `<li><span>${graphic}</span><span>${label}</span></li>`;
}

export function controlHints(mode) {
  const inputs = {
    action: [],
    choose: [],
    place: [["drag","Drag the stool, then release"], [["Enter"],"Place the focused stool"]],
    orbit: [["drag","Drag to orbit"], ["mouse","Right-drag to pan · scroll or pinch to zoom"],
      [["Enter"],"Continue with the focused button"]],
    walk: [[["W","S"],"Walk forward / back"], [["A","D"],"Step left / right"],
      ["drag","Drag the view to look around"], ["map","Click or tap any numbered room pin"],
      [["Tab","Enter"],"Focus a pin or Continue, then activate"]],
    continue: [],
    wait: [["watch","Watch the replay · advances automatically"]],
  };
  return inputs[mode].map(([symbol,label]) => hint(symbol,label)).join("");
}
