// Регулятор скорости: кнопки, ползунок, и два поля — коэффициент (×) и длина после ускорения (с).
// Меняешь одно — второе пересчитывается. Для клипов, роликов рекламы и всего, у чего есть скорость.
import { h, field } from './ui.js';

/**
 * speed — текущий коэффициент, srcLen — длина исходника в секундах (на скорости 1×).
 * onChange(speed, live) — live: ползунок ещё тянут (склеивать в один шаг истории).
 */
export function speedControl({ speed = 1, srcLen, min = 0.1, max = 10, presets = [0.25, 0.5, 1, 1.5, 2, 3, 5], onChange }) {
  const clamp = (s) => Math.max(min, Math.min(max, s));
  const lmin = Math.log10(min), lmax = Math.log10(max);
  const toSl = (s) => Math.round(((Math.log10(s) - lmin) / (lmax - lmin)) * 1000);
  const fromSl = (v) => +Math.pow(10, lmin + (v / 1000) * (lmax - lmin)).toFixed(2);
  const fmt = (s) => `${+s.toFixed(2)}×`;
  let cur = speed;

  const val = h('span', { class: 'range-val' }, fmt(cur));
  const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: toSl(cur) });
  const coef = h('input', { type: 'number', min, max, step: 0.05, value: +cur.toFixed(2) });
  const len = h('input', { type: 'number', min: +(srcLen / max).toFixed(2), max: +(srcLen / min).toFixed(2), step: 0.1, value: +(srcLen / cur).toFixed(2) });
  const note = h('div', { class: 'note', style: { margin: '2px 0 0' } });
  const btns = presets.map((s) => h('button', { class: 'btn', style: { padding: '6px 9px' }, onclick: () => set(s, false) }, `${s}×`));

  const sync = (from) => {
    if (from !== 'slider') slider.value = toSl(cur);
    if (from !== 'coef') coef.value = +cur.toFixed(2);
    if (from !== 'len') len.value = +(srcLen / cur).toFixed(2);
    val.textContent = fmt(cur);
    btns.forEach((b, i) => b.classList.toggle('primary', Math.abs(presets[i] - cur) < 0.005));
    note.textContent = `Было ${(+srcLen).toFixed(1)} с → станет ${(srcLen / cur).toFixed(1)} с.`;
  };
  function set(s, live, from) {
    cur = clamp(s);
    sync(from);
    onChange(cur, live);
  }
  slider.addEventListener('input', () => set(fromSl(+slider.value), true, 'slider'));
  slider.addEventListener('change', () => set(fromSl(+slider.value), false, 'slider'));
  coef.addEventListener('change', () => { const v = parseFloat(String(coef.value).replace(',', '.')); if (v > 0) set(v, false); else sync(); });
  len.addEventListener('change', () => { const v = parseFloat(String(len.value).replace(',', '.')); if (v > 0) set(srcLen / v, false); else sync(); });
  sync();
  return h('div', { class: 'speed-ctl' },
    h('div', { class: 'btn-row', style: { marginTop: 0 } }, ...btns),
    field('Скорость', h('div', { class: 'row' }, slider, val)),
    h('div', { class: 'row' }, field('Коэффициент, ×', coef), field('Длина после ускорения, с', len)),
    note);
}
