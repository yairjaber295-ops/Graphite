// Собственный набор иконок (24×24, линии). Вставляются вместо <span data-icon="имя">.
const P = {
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  subs: '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M6 13h5M13 13h5M6 16.5h9"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  transition: '<rect x="3" y="6" width="10" height="12" rx="2"/><rect x="11" y="6" width="10" height="12" rx="2"/><path d="M11 10l2 2-2 2"/>',
  wand: '<path d="m4 20 11-11 2 2L6 22z"/><path d="M15 3v3M19.5 5.5l-2 2M21 10h-3M13.5 2.5v0"/>',
  canvas: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M3 7v10M21 7v10"/>',
  prev: '<path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/>',
  next: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4.5 4"/>',
  story: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><circle cx="8.5" cy="8" r="1.6"/><path d="M11.5 7.5h5M7.5 12.5h9M7.5 16h6"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.8 1.8-1.7 0-1.3-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.9-1.6h2.1a4 4 0 0 0 4-4C20.5 6.8 16.7 3.5 12 3.5z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7.3" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.3" r="1.2" fill="currentColor"/>',
  speed: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  split: '<path d="M12 2v20"/><path d="M5 7h4v10H5zM15 7h4v10h-4z"/>',
  trimL: '<path d="M9 4v16"/><path d="M13 8h7v8h-7"/><path d="m5 9-3 3 3 3"/>',
  trimR: '<path d="M15 4v16"/><path d="M11 8H4v8h7"/><path d="m19 9 3 3-3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  beat: '<path d="M2 12h4l2-6 4 12 3-8 2 4h5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  filter: '<circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="10" r="5.5"/><circle cx="12" cy="15" r="5.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 5h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v0"/>',
};

export function svg(name, size = 20) {
  const body = P[name] || P.help;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Заменяет все <span data-icon="..."> внутри root на SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.done) return;
    el.innerHTML = svg(el.dataset.icon, +(el.dataset.size || 20));
    el.classList.add('icon');
    el.dataset.done = '1';
  });
}
