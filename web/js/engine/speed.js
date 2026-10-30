// Скорость клипа: постоянная (0,1×–10×) и кривые скорости (как в CapCut).
// Все модули пересчитывают «время таймлайна ↔ время исходника» только через эти функции.

/** Кривые: точки [доля длительности клипа на таймлайне, скорость]; между точками — плавно. */
export const CURVES = {
  none: { label: 'Нет' },
  montage: { label: 'Монтаж', pts: [[0, 1], [0.32, 1], [0.5, 4], [0.68, 1], [1, 1]] },
  hero: { label: 'Герой', pts: [[0, 1.2], [0.35, 1.2], [0.48, 0.25], [0.7, 0.25], [0.82, 1.2], [1, 1.2]] },
  bullet: { label: 'Пуля', pts: [[0, 3], [0.38, 3], [0.5, 0.3], [0.62, 0.3], [0.74, 3], [1, 3]] },
  jump: { label: 'Прыжок', pts: [[0, 1], [0.3, 1], [0.45, 5], [0.55, 5], [0.7, 1], [1, 1]] },
  flashin: { label: 'Вспышка вход', pts: [[0, 6], [0.35, 6], [0.6, 1], [1, 1]] },
  flashout: { label: 'Вспышка выход', pts: [[0, 1], [0.4, 1], [0.65, 6], [1, 6]] },
  ramp: { label: 'Разгон', pts: [[0, 0.5], [1, 3]] },
  brake: { label: 'Торможение', pts: [[0, 3], [1, 0.5]] },
};

const N = 256;
const cache = new Map();

/** Профиль: скорость в точке и накопленный путь по исходнику (численно, N отсчётов). */
function profile(curve, speed) {
  const key = `${curve}|${speed}`;
  let pr = cache.get(key);
  if (pr) return pr;
  const pts = CURVES[curve]?.pts;
  const v = (x) => {
    if (!pts) return 1;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const k = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
        const s = k * k * (3 - 2 * k); // сглаживание, чтобы скорость менялась мягко
        return y0 + (y1 - y0) * s;
      }
    }
    return pts[pts.length - 1][1];
  };
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + (v((i - 0.5) / N) * speed) / N;
  pr = { v: (x) => v(x) * speed, cum, total: cum[N] };
  cache.set(key, pr);
  return pr;
}

const prof = (c) => profile(c.curve && CURVES[c.curve]?.pts ? c.curve : 'none', Math.max(0.05, c.speed || 1));

// Стоп-кадр: клип с freeze = длительность (с); всё время показывает кадр c.in, звука нет.
export const hasCurve = (c) => !c.freeze && !!(c.curve && CURVES[c.curve]?.pts);
export const isSped = (c) => !c.freeze && (hasCurve(c) || Math.abs((c.speed || 1) - 1) > 1e-6);

/** Длительность клипа на таймлайне. */
export function clipDur(c) {
  if (c.freeze) return c.freeze;
  return (c.out - c.in) / prof(c).total;
}

/** Смещение по исходнику для смещения tl по таймлайну (от начала клипа). Вне клипа — продолжение с краевой скоростью. */
export function srcOffset(c, tl) {
  if (c.freeze) return 0;
  const p = prof(c);
  const D = (c.out - c.in) / p.total;
  const L = c.out - c.in;
  if (tl <= 0) return tl * p.v(0);
  if (tl >= D) return L + (tl - D) * p.v(1);
  const x = (tl / D) * N;
  const i = Math.min(N - 1, Math.floor(x)), f = x - i;
  return L * (p.cum[i] + (p.cum[i + 1] - p.cum[i]) * f) / p.total;
}

/** Обратное: смещение по таймлайну для смещения src по исходнику. */
export function tlOffset(c, src) {
  if (c.freeze) return 0;
  const p = prof(c);
  const L = c.out - c.in;
  const D = L / p.total;
  if (src <= 0) return src / p.v(0);
  if (src >= L) return D + (src - L) / p.v(1);
  const target = (src / L) * p.total;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] < target) lo = mid; else hi = mid; }
  const f = (target - p.cum[lo]) / Math.max(1e-12, p.cum[hi] - p.cum[lo]);
  return ((lo + f) / N) * D;
}

/** Скорость кривой в доле x ∈ [0, 1] (для рисования плиток). */
export const curveAt = (curve, x) => profile(CURVES[curve]?.pts ? curve : 'none', 1).v(x);

/** Мгновенная скорость на смещении tl (для плеера). */
export function speedAt(c, tl) {
  if (c.freeze) return 1;
  const D = clipDur(c);
  return prof(c).v(Math.max(0, Math.min(1, tl / D)));
}
