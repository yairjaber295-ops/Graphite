// Эффекты звука клипа/дорожки: бас, высокие, «телефон», «из-за стены», «радио».
// Одна и та же цепочка фильтров WebAudio — в превью (поверх <video>) и в экспорте (OfflineAudioContext).

export const AFX_FILTERS = { none: 'Без фильтра', phone: 'Телефон', wall: 'Из-за стены', radio: 'Радио', vinyl: 'Старое радио' };

/** Быстрые готовые настройки (меню по правому клику). */
export const AFX_PRESETS = {
  bass6: { label: 'Бас +6 дБ', set: { bass: 6 } },
  bassboost: { label: 'Бас-буст (+12 дБ)', set: { bass: 12 } },
  nobass: { label: 'Убрать бас', set: { bass: -12 } },
  bright: { label: 'Ярче (высокие +6)', set: { treble: 6 } },
  phone: { label: 'Как по телефону', set: { filter: 'phone' } },
  wall: { label: 'Из-за стены', set: { filter: 'wall' } },
  radio: { label: 'Радио', set: { filter: 'radio' } },
};

export const hasAfx = (a) => !!a && ((a.bass || 0) !== 0 || (a.treble || 0) !== 0 || (!!a.filter && a.filter !== 'none'));

/** Цепочка: бас → высокие → срез низа → срез верха → «середина» → громкость. */
export function makeChain(ctx) {
  const mk = (type, f) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; return n; };
  const c = { low: mk('lowshelf', 120), high: mk('highshelf', 4000), hp: mk('highpass', 10), lp: mk('lowpass', 22000), mid: mk('peaking', 1600), gain: ctx.createGain() };
  c.hp.Q.value = 0.7; c.lp.Q.value = 0.7; c.mid.Q.value = 1;
  c.low.connect(c.high).connect(c.hp).connect(c.lp).connect(c.mid).connect(c.gain);
  c.input = c.low; c.output = c.gain;
  return c;
}

/** Параметры фильтров под настройки (бас и высокие в дБ). */
export function setChain(c, a = {}) {
  const f = a.filter || 'none';
  const P = {
    none: [10, 22000, 0], phone: [380, 3200, 5], wall: [10, 420, 0], radio: [480, 5200, 3], vinyl: [250, 3800, 2],
  }[f] || [10, 22000, 0];
  c.low.gain.value = a.bass || 0;
  c.high.gain.value = (a.treble || 0) + (f === 'wall' ? -6 : 0);
  c.hp.frequency.value = P[0];
  c.lp.frequency.value = P[1];
  c.mid.gain.value = P[2];
  // бас-буст поднимает громкость — чуть убавляем, чтобы не хрипело
  c.gain.gain.value = 1 / (1 + Math.max(0, a.bass || 0) / 24);
  return c;
}
