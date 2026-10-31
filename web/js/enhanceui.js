// «Улучшить качество»: Real-ESRGAN на видеокарте компа. С телефона файл уходит на подключённый комп и возвращается.
// Улучшенный файл подменяет исходник под тем же id — куски, стоп-кадры и субтитры остаются как были.
import { S, commit, emit, clipsTL } from './store.js';
import { h, modal, toast, fill } from './ui.js';
import { loadMedia } from './mediastate.js';

const MODELS = {
  fast: { label: 'Быстрая', icon: '⚡', desc: 'Лёгкая видео-модель — в ~10 раз быстрее' },
  quality: { label: 'Качество', icon: '✦', desc: 'x4plus — максимум деталей, медленно' },
  none: { label: 'Без ИИ', icon: '↗', desc: 'Обычное увеличение + резкость, мгновенно' },
};
const RES = [['x2', '×2'], ['x4', '×4'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']];   // массив: числовые ключи объекта встали бы первыми
const running = {};   // mid → { progress, message, job } — обработка идёт и после закрытия окна

const even = (v) => Math.max(2, Math.round(v / 2) * 2);
function targetDims(w, h, res) {
  let k = res === 'x2' ? 2 : res === 'x4' ? 4 : +res / Math.min(w, h);
  k = Math.min(k, 3840 / Math.max(w, h));
  return [even(w * k), even(h * k)];
}
const human = (s) => (s < 60 ? `${Math.max(1, Math.round(s))} с` : s < 3600 ? `${Math.round(s / 60)} мин` : `${(s / 3600).toFixed(1).replace('.', ',')} ч`);

/** Исходный размер файла (до улучшения). */
const origDims = (m) => m.enhanced?.from || [m.width, m.height];

/** Секунда исходника под курсором (если курсор на этом клипе), иначе — середина клипа. */
function sourceTime(clip) {
  const tl = clipsTL().find((x) => x.id === clip?.id);
  if (!clip || !tl) return 0;
  const inside = S.t >= tl.start && S.t < tl.end;
  const f = inside ? (S.t - tl.start) / Math.max(0.01, tl.end - tl.start) : 0.5;
  return clip.freeze ? clip.in : clip.in + f * (clip.out - clip.in);
}

export function enhanceStatus(mid) { return running[mid] || null; }

export function openEnhance(clipId) {
  const clip = S.project.clips.find((x) => x.id === clipId);
  const m = clip && S.project.media.find((x) => x.id === clip.media);
  if (!m || (m.kind !== 'video' && m.kind !== 'image')) return toast('Выдели видео или фото на таймлайне');
  const caps = S.backend.caps || {};
  const image = m.kind === 'image';
  const [w0, h0] = origDims(m);
  const canvasShort = Math.min(S.project.canvas.w, S.project.canvas.h);
  const opts = {
    model: image ? 'quality' : 'fast',
    // по умолчанию — до разрешения проекта (обычно 1080p), если исходник меньше; иначе ×2
    res: Math.min(w0, h0) < canvasShort ? (canvasShort >= 1440 ? '1440' : '1080') : 'x2',
    power: image ? 75 : 100,
  };
  if (m.enhanced) Object.assign(opts, { model: m.enhanced.model || opts.model, res: m.enhanced.res || opts.res, power: m.enhanced.power ?? opts.power });
  let preview = null, pvBusy = false;

  modal((box, close) => {
    box.classList.add('enh-modal');
    const settings = h('div', { class: 'enh-side' });
    const stage = h('div', { class: 'enh-stage' });
    const cmp = compareView(stage);
    box.append(h('div', { class: 'enh-head' },
      h('div', {}, h('h2', {}, '✨ Улучшить качество'),
        h('div', { class: 'note' }, `${m.name} · ${w0}×${h0}${image ? '' : ` · ${Math.round(m.fps || 30)} fps · ${Math.round(m.duration)} с`}`)),
      h('button', { class: 'icon-btn enh-x', title: 'Закрыть', onclick: close }, '✕')),
    h('div', { class: 'enh-body' }, settings, stage));

    const draw = () => {
      const run = running[m.id];
      const busy = !!run;
      const key = `${opts.model}|${opts.res}|${opts.power}`;
      const tgt = targetDims(w0, h0, opts.res);
      const models = image ? ['quality', 'none'] : ['fast', 'quality', 'none'];
      fill(settings,
        !caps.enhance ? h('div', { class: 'enh-warn' }, 'Улучшение работает на видеокарте компа. Подключи комп: главный экран → «Комп», потом открой это окно снова.') : null,
        m.enhanced ? h('div', { class: 'enh-done' },
          h('span', {}, `Уже улучшено: ${MODELS[m.enhanced.model]?.label || ''} · ${m.width}×${m.height}`),
          h('button', { class: 'btn', disabled: busy, onclick: () => revert(m).then(draw) }, 'Вернуть оригинал')) : null,
        h('div', { class: 'enh-label' }, 'Модель'),
        h('div', { class: 'enh-models' }, ...models.map((k) => h('button', {
          class: 'enh-model' + (opts.model === k ? ' on' : ''), disabled: busy,
          onclick: () => { opts.model = k; if (k !== 'none' && image) opts.power = 75; draw(); },
        }, h('i', {}, MODELS[k].icon), h('div', {}, h('b', {}, image && k === 'quality' ? 'Нейросеть' : MODELS[k].label),
          h('span', {}, image && k === 'quality' ? 'Real-ESRGAN, как в PhotoForge' : MODELS[k].desc))))),
        h('div', { class: 'enh-label' }, 'Разрешение'),
        h('div', { class: 'enh-res' }, ...RES.map(([k, l]) => {
          const t = targetDims(w0, h0, k);
          return h('button', { class: opts.res === k ? 'on' : '', disabled: busy || t[0] <= w0, title: `${t[0]}×${t[1]}`, onclick: () => { opts.res = k; draw(); } }, l);
        })),
        h('div', { class: 'note' }, `${w0}×${h0} → ${tgt[0]}×${tgt[1]}`),
        h('div', { class: 'enh-label' }, opts.model === 'none' ? 'Резкость' : 'Сила', h('em', {}, `${opts.power}%`)),
        h('input', { type: 'range', min: 0, max: 100, step: 5, value: opts.power, disabled: busy,
          oninput: (e) => { opts.power = +e.target.value; e.target.previousSibling.lastChild.textContent = `${opts.power}%`; },
          onchange: () => draw() }),
        h('div', { class: 'note' }, opts.model === 'none' ? 'Без нейросети: Lanczos и лёгкая резкость.'
          : opts.power < 60 ? 'Мягко: нейросеть смешана с обычным увеличением — меньше «рисованности».'
            : 'Полная сила: максимально чисто и резко. Сравни кадр, прежде чем запускать.'),
        h('div', { class: 'grow' }),
        preview?.key === key && preview.eta ? h('div', { class: 'enh-eta' }, `≈ ${(1 / preview.per).toFixed(preview.per > 0.5 ? 2 : 1)} кадр/с · весь файл ≈ ${human(preview.eta)}`) : null,
        busy ? h('div', { class: 'enh-prog' }, h('div', { class: 'progress' }, h('i', { style: { width: `${Math.round((run.progress || 0) * 100)}%` } })),
          h('div', { class: 'note' }, run.message || 'Обработка…'),
          h('div', { class: 'note' }, 'Окно можно закрыть — обработка продолжится, результат подставится сам.')) : null,
        h('div', { class: 'btn-row' },
          busy ? h('button', { class: 'btn', onclick: () => cancel(m.id) }, 'Отменить')
            : h('button', { class: 'btn', disabled: !caps.enhance || pvBusy, onclick: doPreview }, pvBusy ? 'Считаю кадр…' : 'Предпросмотр кадра'),
          busy ? null : h('button', { class: 'btn primary', disabled: !caps.enhance || pvBusy, onclick: start }, m.enhanced ? 'Улучшить заново' : 'Улучшить')),
        h('div', { class: 'note' }, image ? '' : 'Улучшается весь файл — все куски этого видео в проекте.'));
    };

    async function doPreview() {
      pvBusy = true; draw();
      const key = `${opts.model}|${opts.res}|${opts.power}`;
      try {
        const r = await S.backend.enhancePreview(S.project.id, m, sourceTime(clip), { ...opts });
        preview = { ...r, key };
        cmp.show(r.before, r.after, r.w, r.h);
      } catch (e) { toast('Предпросмотр: ' + e.message, 'err'); }
      pvBusy = false; draw();
    }

    function start() {
      run(m, { ...opts }, draw).catch(() => {});
      draw();
    }

    // кадр под курсором для начала — чтобы сразу было что сравнивать
    cmp.placeholder(image ? 'Нажми «Предпросмотр кадра» — покажу, как станет' : 'Поставь курсор на нужный момент и нажми «Предпросмотр кадра»');
    const tick = setInterval(() => { if (!box.isConnected) clearInterval(tick); else if (running[m.id]) draw(); }, 700);
    draw();
  });
}

/** Запуск обработки. Прогресс — в running[mid] (и в окне, если оно открыто). */
async function run(m, opts, redraw) {
  const pid = S.project.id;
  running[m.id] = { progress: 0, message: 'Запуск…' };
  try {
    const r = await S.backend.enhance(pid, m, opts,
      (j) => { Object.assign(running[m.id], { progress: j.progress, message: j.message }); },
      (jobId) => { running[m.id].job = jobId; });
    if (S.project?.id !== pid) return;
    commit((p) => {
      const x = p.media.find((y) => y.id === m.id);
      if (!x) return;
      const from = x.enhanced?.from || [x.width, x.height];
      Object.assign(x, { width: r.width, height: r.height, enhanced: { ...opts, ...(r.enhanced || {}), from, at: r.enhanced?.at || Date.now() / 1000 } });
    });
    await refreshMedia(m.id);
    toast(`Готово: «${m.name}» улучшено до ${r.width}×${r.height}`, 'ok');
  } catch (e) {
    if (!/отмен/i.test(e.message)) toast('Улучшение: ' + e.message, 'err');
    else toast('Улучшение отменено');
    throw e;
  } finally {
    delete running[m.id];
    redraw?.();
  }
}

async function cancel(mid) {
  const job = running[mid]?.job;
  if (!job) return;
  await (S.backend.pc || S.backend).cancelJob(job).catch(() => {});
}

async function revert(m) {
  try {
    const r = await S.backend.unenhance(S.project.id, m);
    commit((p) => {
      const x = p.media.find((y) => y.id === m.id);
      if (!x) return;
      const [w, h] = r?.width ? [r.width, r.height] : x.enhanced?.from || [x.width, x.height];
      Object.assign(x, { width: w, height: h });
      delete x.enhanced;
    });
    await refreshMedia(m.id);
    toast('Вернул оригинал', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/** Свежие сведения о файле (новая лёгкая копия для превью) → плеер сам подхватит новый адрес. */
async function refreshMedia(mid) {
  const st = S.media[mid];
  if (st) { st.status = 'preparing'; delete st.img; }
  await loadMedia(mid);
  emit('media-ready');
}

// ---------------------------------------------------------------------------
//   Сравнение «до / после»: шторка, зум колёсиком/щипком, перетаскивание
// ---------------------------------------------------------------------------
function compareView(root) {
  const world = h('div', { class: 'enh-world' });
  const imA = h('img', { draggable: false, alt: '' });
  const imB = h('img', { draggable: false, alt: '' });
  const split = h('div', { class: 'enh-split' }, h('div', { class: 'enh-knob' }, '‹ ›'));
  const msg = h('div', { class: 'enh-msg' });
  world.append(imA, imB);
  root.append(world, split, h('span', { class: 'enh-tag l' }, 'До'), h('span', { class: 'enh-tag r' }, 'После'), msg);
  let W = 1, H = 1, s = 1, x = 0, y = 0, cut = 0.5, has = false;
  const apply = () => {
    world.style.width = W + 'px'; world.style.height = H + 'px';
    world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    const r = root.getBoundingClientRect();
    split.style.left = cut * r.width + 'px';
    const wx = Math.max(0, Math.min(W, (cut * r.width - x) / s));
    imB.style.clipPath = `inset(0 ${W - wx}px 0 0)`;
  };
  const fit = () => {
    const r = root.getBoundingClientRect();
    s = Math.min((r.width - 20) / W, (r.height - 20) / H);
    x = (r.width - W * s) / 2; y = (r.height - H * s) / 2;
    apply();
  };
  new ResizeObserver(() => has && fit()).observe(root);
  const ptrs = new Map();
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (!has) return;
    root.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { split: !!e.target.closest('.enh-split'), x: e.clientX, y: e.clientY, ox: x, oy: y, s, d: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), s, ox: x, oy: y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = root.getBoundingClientRect();
    if (drag.pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const k = Math.hypot(a.x - b.x, a.y - b.y) / drag.d;
      const ns = Math.min(16, Math.max(0.05, drag.s * k)), cx = drag.cx - r.left, cy = drag.cy - r.top;
      x = cx - (cx - drag.ox) * (ns / drag.s); y = cy - (cy - drag.oy) * (ns / drag.s); s = ns;
    } else if (drag.split) cut = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    else if (!drag.pinch) { x = drag.ox + e.clientX - drag.x; y = drag.oy + e.clientY - drag.y; }
    apply();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) drag = null; };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('wheel', (e) => {
    if (!has) return;
    e.preventDefault();
    const r = root.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    const ns = Math.min(16, Math.max(0.05, s * Math.exp(-e.deltaY * 0.0015)));
    x = cx - (cx - x) * (ns / s); y = cy - (cy - y) * (ns / s); s = ns;
    apply();
  }, { passive: false });
  root.addEventListener('dblclick', () => { if (has) fit(); });
  return {
    show(before, after, w, hh) {
      W = w; H = hh; has = true;
      imB.src = before; imA.src = after;
      root.classList.add('has');
      msg.textContent = '';
      fit();
    },
    placeholder(text) { msg.textContent = text; },
  };
}
