// Небольшие помощники для построения интерфейса.
import { S, cssFont } from './store.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const field = (label, ...controls) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...controls);

export function range(label, value, { min = 0, max = 100, step = 1, fmt = (v) => v, onInput }) {
  const val = h('span', { class: 'range-val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); onInput(+inp.value); });
  return field(label, h('div', { class: 'row' }, inp, val));
}

export function color(value, onInput) {
  const inp = h('input', { type: 'color', value });
  inp.addEventListener('input', () => onInput(inp.value));
  return inp;
}

export function select(options, value, onChange) {
  const s = h('select', {}, ...Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === String(value) }, l)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function seg(options, value, onChange) {
  const box = h('div', { class: 'seg' });
  for (const [v, l] of Object.entries(options)) {
    box.append(h('button', { class: String(value) === v ? 'on' : '', onclick: () => onChange(v) }, l));
  }
  return box;
}

export function check(label, value, onChange) {
  const inp = h('input', { type: 'checkbox', checked: !!value });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'check' }, inp, label);
}

export function textInput(value, onInput, attrs = {}) {
  const inp = h('input', { type: 'text', value: value ?? '', spellcheck: false, ...attrs });
  inp.addEventListener('input', () => onInput(inp.value));
  return inp;
}

export function numberInput(value, onChange, attrs = {}) {
  const inp = h('input', { type: 'number', value, ...attrs });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) onChange(v); });
  return inp;
}

/** Выбор шрифта: выпадающий список, каждый пункт написан своим шрифтом. */
export function fontPicker(value, onChange) {
  const box = h('div', { class: 'font-pick' });
  const cur = S.fontMap[value] || S.fonts[0];
  const head = h('div', { class: 'cur', style: { fontFamily: `"${cssFont(value)}"` } }, cur?.label || value, h('span', { class: 'dim small' }, '▾'));
  box.append(head);
  head.addEventListener('click', (e) => {
    e.stopPropagation();
    if (box.querySelector('.font-pop')) return box.querySelector('.font-pop').remove();
    const pop = h('div', { class: 'font-pop' }, ...S.fonts.map((f) =>
      h('div', { class: f.id === value ? 'on' : '', style: { fontFamily: `"f_${f.id}"` }, onclick: () => { pop.remove(); onChange(f.id); } }, f.label)));
    box.append(pop);
    pop.querySelector('.on')?.scrollIntoView({ block: 'center' });
    const close = (ev) => { if (!box.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  });
  return box;
}

export function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}

export function modal(build) {
  const root = document.getElementById('modal-root');
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal' });
  back.append(box);
  const close = () => back.remove();
  back.addEventListener('pointerdown', (e) => { if (e.target === back && !box.dataset.locked) close(); });
  build(box, close);
  root.append(back);
  return close;
}

export const pct = (v) => `${Math.round(v * 100)}%`;

/** Заменить содержимое; пропущенные пункты (null/false) не превращаются в текст «null». */
export const fill = (el, ...children) => el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
