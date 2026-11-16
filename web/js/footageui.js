// Футажи и ИИ-режиссёр (только с сервером на компе):
//  • «Видео по описанию» — пишешь, что нужно; ИИ по описаниям выбирает футажи из библиотеки и собирает проект в редакторе;
//  • «Библиотека» — футажи и фоны с названием, описанием и тегами (по ним ИИ и подбирает); ИИ может описать их сам по кадрам
//    и нарисовать новые фоны;
//  • «ИИ» — свой ключ OpenAI / Anthropic / любой OpenAI-совместимый сервис.
import { S, emit } from './store.js';
import { h, field, modal, toast, fill, select as sel, seg, check } from './ui.js';

const api = (method, path, body) => S.backend.req(method, '/api/footage' + path, body);
const CAT = { footage: 'Футаж', background: 'Фон' };
const ASPECT = { '9:16': '9:16 · TikTok, Shorts', '16:9': '16:9 · YouTube', '1:1': '1:1 · квадрат' };

// состояние окна живёт, пока открыта страница: текст задания не пропадает, если закрыл окно случайно
const st = { tab: 'make', brief: '', duration: 30, aspect: '9:16', fit: 'contain', newBg: 0, items: [], ai: {}, q: '', cat: 'all', sel: null };

const fmtDur = (e) => (e.kind === 'image' ? 'картинка' : `${(e.duration || 0).toFixed(1)} с`);
const thumbUrl = (e) => S.backend.url(`/api/footage/thumb/${e.id}`);
const fileUrl = (e) => S.backend.url(`/api/footage/file/${e.id}`);
const isPc = () => !!S.backend?.caps?.pickPaths;   // окно на компе: можно выбирать файлы по путям и менять ключи

async function load() {
  const r = await api('GET', '');
  st.items = r.items;
  st.ai = r.ai || {};
  if (st.sel && !st.items.some((e) => e.id === st.sel)) st.sel = null;
}

export async function footageDialog() {
  try { await load(); } catch (e) { return toast(e.message, 'err'); }
  modal((box, close) => {
    box.classList.add('ft-modal');
    const body = h('div', { class: 'ft-body' });
    const status = h('div', { class: 'ft-status', hidden: true });
    const tabs = h('div', { class: 'seg ft-tabs' });
    const ctx = {
      close, body, status,
      redraw: () => draw(),
      /** Быстрая операция без задачи на сервере (загрузка файла). */
      async busy(label, fn) {
        status.hidden = false;
        status.replaceChildren(h('span', {}, label));
        try { return await fn(); } catch (e) { toast(e.message, 'err'); return null; } finally { status.hidden = true; }
      },
      /** Долгая операция: показываем прогресс, ошибки — в уведомление. */
      async run(label, start) {
        status.hidden = false;
        status.replaceChildren(h('span', {}, label), h('div', { class: 'bar' }, h('i', { style: { width: '3%' } })));
        try {
          const job = await start();
          const j = await S.backend.waitJob(job.id, (x) => {
            status.firstChild.textContent = x.message ? `${label} — ${x.message}` : label;
            status.querySelector('i').style.width = `${Math.max(3, Math.round((x.progress || 0) * 100))}%`;
          });
          return j.result;
        } catch (e) {
          toast(e.message, 'err');
          return null;
        } finally {
          status.hidden = true;
        }
      },
    };
    const draw = () => {
      tabs.replaceChildren(...[['make', 'Видео по описанию'], ['lib', `Библиотека · ${st.items.length}`], ['ai', 'ИИ']].map(([k, l]) =>
        h('button', { class: st.tab === k ? 'on' : '', onclick: () => { st.tab = k; draw(); } }, l)));
      fill(body, st.tab === 'make' ? makeTab(ctx) : st.tab === 'lib' ? libTab(ctx) : aiTab(ctx));
    };
    fill(box,
      h('div', { class: 'ft-head' }, h('h2', {}, 'Футажи и ИИ'), h('button', { class: 'icon-btn', title: 'Закрыть', onclick: close }, '✕')),
      tabs, status, body);
    draw();
  });
}

// ---------------------------------------------------------------------------
//   Видео по описанию
// ---------------------------------------------------------------------------
function makeTab(ctx) {
  const footage = st.items.filter((e) => e.category !== 'background' && !e.missing).length;
  const bgs = st.items.filter((e) => e.category === 'background' && !e.missing).length;
  const ready = st.ai.ready;
  const result = h('div', { class: 'ft-result' });
  const brief = h('textarea', { rows: 6, spellcheck: false, placeholder: 'Например: динамичный эдит на 30 секунд — самые смешные моменты, между ними тёмные фоны, на фонах крупные подписи. Начать с самого громкого футажа.' });
  brief.value = st.brief;
  brief.addEventListener('input', () => { st.brief = brief.value; });
  const go = h('button', { class: 'btn primary big', onclick: async () => {
    if (st.brief.trim().length < 3) return toast('Опиши, какое видео нужно');
    go.disabled = true;
    result.replaceChildren();
    const r = await ctx.run('ИИ собирает видео', () => api('POST', '/compose', {
      brief: st.brief, duration: st.duration, aspect: st.aspect, fit: st.fit, new_backgrounds: st.newBg }));
    go.disabled = false;
    if (!r) return;
    load().catch(() => {});
    result.replaceChildren(
      h('div', { class: 'note ok' }, `Готово: «${r.name}» — ${r.scenes} сцен, ${r.duration} с${r.generated ? `, нарисовано фонов: ${r.generated}` : ''}.`),
      r.notes ? h('div', { class: 'note' }, 'ИИ: ' + r.notes) : null,
      ...(r.warnings || []).map((w) => h('div', { class: 'note warn' }, w)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { ctx.close(); emit('open-project', r.pid); } }, 'Открыть в редакторе'),
        h('button', { class: 'btn', onclick: go.onclick }, 'Собрать заново')));
  } }, 'Собрать видео');

  return h('div', {},
    !ready ? h('div', { class: 'note warn' }, 'Сначала вставь ключ ИИ — вкладка «ИИ». ',
      h('button', { class: 'chip-btn', onclick: () => { st.tab = 'ai'; ctx.redraw(); } }, 'Открыть')) : null,
    !footage && !bgs ? h('div', { class: 'note warn' }, 'В библиотеке пока пусто — добавь футажи на вкладке «Библиотека».') : null,
    h('div', { class: 'note' }, `В библиотеке: футажей ${footage}, фонов ${bgs}. ИИ выбирает по названию, описанию и тегам — чем точнее описаны ролики, тем лучше подбор.`),
    field('Что должно получиться', brief),
    h('div', { class: 'ft-row' },
      field('Длина, секунд', h('input', { type: 'number', min: 5, max: 180, value: st.duration, onchange: (e) => { st.duration = Math.max(5, Math.min(180, +e.target.value || 30)); e.target.value = st.duration; } })),
      field('Кадр', sel(ASPECT, st.aspect, (v) => { st.aspect = v; })),
      field('Если ролик не по формату', seg({ contain: 'Целиком, фон размыт', cover: 'Обрезать под кадр' }, st.fit, (v) => { st.fit = v; ctx.redraw(); }))),
    h('div', { class: 'ft-row' },
      check('Разрешить ИИ рисовать новые фоны', st.newBg > 0, (v) => { st.newBg = v ? 2 : 0; ctx.redraw(); }),
      st.newBg > 0 ? field('', h('input', { type: 'number', min: 1, max: 4, value: st.newBg, title: 'Не больше стольки фонов за раз', onchange: (e) => { st.newBg = Math.max(1, Math.min(4, +e.target.value || 2)); } })) : null),
    st.newBg > 0 && !st.ai.image_ready ? h('div', { class: 'note warn' }, 'Для рисования фонов нужен ключ картинок (OpenAI или совместимый) — вкладка «ИИ». Без него ИИ соберёт видео только из библиотеки.') : null,
    h('div', { class: 'btn-row' }, go),
    result);
}

// ---------------------------------------------------------------------------
//   Библиотека
// ---------------------------------------------------------------------------
function libTab(ctx) {
  const grid = h('div', { class: 'ft-grid' });
  const edit = h('div', { class: 'ft-edit' });
  const count = h('div', { class: 'note' });

  const after = async (r, what) => {
    await load().catch(() => {});
    if (r) {
      const parts = [];
      if (r.added != null) parts.push(`добавлено ${r.added}${r.skipped ? `, уже были ${r.skipped}` : ''}`);
      if (r.rows != null) parts.push(`описаний применено ${r.done} из ${r.rows}`);
      if (r.done != null && r.rows == null) parts.push(`описано ${r.done}`);
      toast(`${what}: ${parts.join(', ') || 'готово'}`, 'ok');
      const bad = [...(r.errors || []), ...(r.missing || []).map((x) => `не найден файл: ${x}`)];
      if (bad.length) toast(bad.slice(0, 4).join('\n') + (bad.length > 4 ? `\n…и ещё ${bad.length - 4}` : ''), 'err');
    }
    ctx.redraw();
  };

  const addFiles = async (kind) => {
    if (isPc()) {
      const { paths } = await S.backend.req('POST', '/api/pick', { kind });
      if (!paths?.length) return;
      after(await ctx.run('Добавляю футажи', () => api('POST', '/import', { paths })), 'Футажи');
    } else {
      const input = h('input', { type: 'file', multiple: true, accept: 'video/*,image/*' });
      input.onchange = async () => {
        let n = 0;
        for (const f of input.files) {
          const r = await ctx.busy(`Загружаю ${f.name}`, async () => {
            const res = await fetch(S.backend.url(`/api/footage/upload?name=${encodeURIComponent(f.name)}`), { method: 'POST', body: f });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
            return d;
          });
          if (r) n++;
        }
        after({ added: n }, 'Футажи');
      };
      input.click();
    }
  };

  const visible = () => {
    const q = st.q.trim().toLowerCase();
    return st.items.filter((e) => (st.cat === 'all' || e.category === st.cat)
      && (!q || [e.title, e.description, (e.tags || []).join(' '), e.name].join(' ').toLowerCase().includes(q)));
  };

  const drawGrid = () => {
    const list = visible();
    count.textContent = `Показано ${list.length} из ${st.items.length}. Без описания: ${st.items.filter((e) => !e.description).length}.`;
    fill(grid, list.length ? list.map((e) => h('button', { class: `ft-card${st.sel === e.id ? ' on' : ''}${e.missing ? ' missing' : ''}`, onclick: () => { st.sel = e.id; drawGrid(); drawEdit(); } },
      h('img', { src: thumbUrl(e), loading: 'lazy', alt: '', onerror: (ev) => { ev.target.style.visibility = 'hidden'; } }),
      h('span', { class: 'cat' }, CAT[e.category] || 'Футаж'),
      h('b', {}, e.title || e.name),
      h('small', {}, e.missing ? 'файл не найден' : (e.description ? fmtDur(e) : `${fmtDur(e)} · нет описания`))))
      : h('div', { class: 'note' }, st.items.length ? 'Ничего не найдено.' : 'Пока пусто. «Добавить папку» — самый быстрый способ: все ролики из неё попадут в библиотеку.'));
  };

  const drawEdit = () => {
    const e = st.items.find((x) => x.id === st.sel);
    if (!e) return fill(edit, h('div', { class: 'note' }, 'Выбери футаж слева — здесь можно поправить название, описание и теги.'));
    const save = async (patch) => {
      try { Object.assign(e, await api('POST', '/update', { id: e.id, ...patch })); drawGrid(); } catch (err) { toast(err.message, 'err'); }
    };
    const title = h('input', { type: 'text', value: e.title || '', spellcheck: false });
    title.addEventListener('change', () => save({ title: title.value }));
    const desc = h('textarea', { rows: 5, spellcheck: false, placeholder: 'Что в ролике: кто, что делает, настроение. По этому тексту ИИ выбирает футаж.' });
    desc.value = e.description || '';
    desc.addEventListener('change', () => save({ description: desc.value }));
    const tags = h('input', { type: 'text', value: (e.tags || []).join(', '), spellcheck: false, placeholder: 'смех, реакция, стрим, ночь' });
    tags.addEventListener('change', () => save({ tags: tags.value }));
    fill(edit,
      e.missing ? h('div', { class: 'note warn' }, 'Файл не найден на диске (перенесён или удалён). Верни его на место или удали запись.')
        : e.kind === 'image' ? h('img', { class: 'ft-preview', src: fileUrl(e), alt: '' })
          : h('video', { class: 'ft-preview', src: fileUrl(e), controls: true, muted: true, preload: 'metadata', playsInline: true }),
      field('Название', title),
      field('Тип', seg(CAT, e.category || 'footage', (v) => save({ category: v }).then(drawEdit))),
      field('Описание', desc),
      field('Теги через запятую', tags),
      h('div', { class: 'note' }, `${e.name} · ${fmtDur(e)}${e.width ? ` · ${e.width}×${e.height}` : ''}${e.origin === 'generated' ? ' · нарисован ИИ' : ''}`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', disabled: !st.ai.ready || e.missing, title: st.ai.ready ? '' : 'Нужен ключ ИИ', onclick: async () => {
          const r = await ctx.run('ИИ описывает', () => api('POST', '/describe', { ids: [e.id], overwrite: true }));
          if (r) { await load(); drawGrid(); drawEdit(); }
        } }, '✨ Описать по кадрам'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(e.origin === 'generated' || e.origin === 'upload' ? 'Удалить из библиотеки вместе с файлом?' : 'Убрать из библиотеки? Сам файл на диске останется.')) return;
          await api('POST', '/remove', { id: e.id }).catch((err) => toast(err.message, 'err'));
          st.sel = null; await load(); ctx.redraw();
        } }, 'Убрать')));
  };

  const search = h('input', { type: 'search', placeholder: 'Поиск по названию, описанию, тегам…', value: st.q, spellcheck: false });
  search.addEventListener('input', () => { st.q = search.value; drawGrid(); });
  drawGrid();
  drawEdit();
  return h('div', {},
    h('div', { class: 'ft-bar' },
      h('button', { class: 'btn primary', onclick: () => addFiles('video') }, isPc() ? 'Добавить файлы' : 'Загрузить файлы'),
      isPc() ? h('button', { class: 'btn', onclick: () => addFiles('folder') }, 'Добавить папку') : null,
      isPc() ? h('button', { class: 'btn', onclick: () => catalogDialog(ctx, after) }, 'Список описаний…') : null,
      h('button', { class: 'btn', disabled: !st.ai.ready, title: st.ai.ready ? 'Для всех футажей, где описания ещё нет' : 'Нужен ключ ИИ', onclick: async () => {
        const ids = st.items.filter((e) => !e.description && !e.missing).map((e) => e.id);
        if (!ids.length) return toast('Все футажи уже с описанием');
        after(await ctx.run('ИИ описывает', () => api('POST', '/describe', { ids })), 'Описания');
      } }, '✨ Описать пустые'),
      h('button', { class: 'btn', disabled: !st.ai.image_ready, title: st.ai.image_ready ? '' : 'Нужен ключ картинок (вкладка «ИИ»)', onclick: () => backgroundDialog(ctx, after) }, '🎨 Нарисовать фон')),
    h('div', { class: 'ft-bar' }, search, sel({ all: 'Все', footage: 'Футажи', background: 'Фоны' }, st.cat, (v) => { st.cat = v; drawGrid(); })),
    count,
    h('div', { class: 'ft-split' }, grid, edit));
}

/** Список описаний: JSON или строки «файл ; название ; описание ; теги» (можно вставить из таблицы). */
function catalogDialog(ctx, after) {
  modal((box, close) => {
    box.classList.add('wide');
    let folder = '';
    const text = h('textarea', { rows: 12, spellcheck: false, placeholder: 'clip01.mp4 ; Смеётся над фейлом ; Крупный план, ржёт после неудачи ; смех, реакция\nclip02.mp4 ; Танцует ; Короткий танец на фоне ночного города ; танец, ночь\n\nили JSON: [{"file": "clip01.mp4", "title": "…", "description": "…", "tags": ["…"]}]' });
    const fol = h('input', { type: 'text', spellcheck: false, placeholder: 'Папка с файлами (если в списке только имена файлов)' });
    fol.addEventListener('input', () => { folder = fol.value; });
    fill(box,
      h('h2', {}, 'Список описаний'),
      h('div', { class: 'note' }, 'Каждая строка: имя файла, название, описание, теги — через «;», табуляцию или «|». Можно скопировать из таблицы вместе с заголовками (file, title, description, tags). Файлы ищутся по имени в библиотеке и в указанной папке; новые добавляются автоматически.'),
      field('Список', text),
      field('Папка с файлами', h('div', { class: 'row' }, fol,
        h('button', { class: 'btn', onclick: async () => { const { paths } = await S.backend.req('POST', '/api/pick', { kind: 'folder' }); if (paths?.[0]) { fol.value = folder = paths[0]; } } }, 'Выбрать…'))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (!text.value.trim()) return toast('Вставь список');
          close();
          after(await ctx.run('Применяю описания', () => api('POST', '/catalog', { text: text.value, folder })), 'Список');
        } }, 'Применить')));
  });
}

function backgroundDialog(ctx, after) {
  modal((box, close) => {
    const prompt = h('textarea', { rows: 4, spellcheck: false, placeholder: 'Тёмный неоновый город ночью, дождь, сине-фиолетовые огни, без людей и текста' });
    let vertical = true;
    fill(box,
      h('h2', {}, 'Нарисовать фон'),
      h('div', { class: 'note' }, 'ИИ нарисует картинку и добавит в библиотеку (тип «Фон»). Потом её можно брать в видео.'),
      field('Описание фона', prompt),
      field('Формат', seg({ v: 'Вертикальный', h: 'Горизонтальный' }, 'v', (k) => { vertical = k === 'v'; })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: close }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (prompt.value.trim().length < 3) return toast('Опиши фон');
          close();
          const r = await ctx.run('ИИ рисует фон', () => api('POST', '/background', { prompt: prompt.value, vertical }));
          if (r) { st.sel = r.id; await after({ added: 1 }, 'Фон'); }
        } }, 'Нарисовать')));
  });
}

// ---------------------------------------------------------------------------
//   Ключ ИИ
// ---------------------------------------------------------------------------
function aiTab(ctx) {
  if (!isPc()) return h('div', { class: 'note' }, `Ключи вводятся в окне на компе. ИИ ${st.ai.ready ? 'уже подключён' : 'пока не подключён'}.`);
  const a = st.ai;
  const prov = a.providers || {};
  const f = { provider: a.provider || 'openai', base_url: a.base_url || '', model: a.model || '', api_key: '',
    image: { base_url: a.image?.base_url || '', model: a.image?.model || '', size: a.image?.size || '', api_key: '' } };
  const keyHint = (k) => (k?.set ? `Сохранён${k.tail ? ` (…${k.tail})` : ''}. Оставь пустым, чтобы не менять` : 'Вставь ключ');
  const inp = (get, set, attrs = {}) => { const i = h('input', { type: 'text', spellcheck: false, autocomplete: 'off', value: get(), ...attrs }); i.addEventListener('input', () => set(i.value)); return i; };
  const sec = h('div', {});
  const drawProv = () => {
    const p = prov[f.provider] || {};
    fill(sec,
      field('Ключ API', inp(() => f.api_key, (v) => { f.api_key = v; }, { type: 'password', placeholder: keyHint(a.key) })),
      field('Модель', inp(() => f.model, (v) => { f.model = v; }, { placeholder: p.model ? `по умолчанию ${p.model}` : 'например gpt-4o-mini' })),
      field('Адрес API', inp(() => f.base_url, (v) => { f.base_url = v; }, { placeholder: p.base ? `по умолчанию ${p.base}` : 'https://…/v1 (обязательно)' })));
  };
  const save = async (extra = {}) => {
    try {
      st.ai = await api('POST', '/ai', { ...f, ...extra });
      toast('Сохранено', 'ok');
      ctx.redraw();
    } catch (e) { toast(e.message, 'err'); }
  };
  drawProv();
  return h('div', {},
    h('div', { class: 'note' }, 'Ключ хранится только на этом компе (settings.json) и уходит только выбранному сервису. Он нужен для подбора футажей, описаний и рисования фонов.'),
    field('Сервис', sel(Object.fromEntries(Object.entries(prov).map(([k, v]) => [k, v.label])), f.provider, (v) => { f.provider = v; drawProv(); })),
    sec,
    h('div', { class: 'note' }, st.ai.ready ? '✅ Текстовый ИИ подключён.' : 'Текстовый ИИ не подключён.'),
    h('details', { open: !st.ai.image_ready },
      h('summary', {}, 'Картинки (для «Нарисовать фон»)'),
      h('div', { class: 'note' }, 'Нужен OpenAI-совместимый сервис картинок. Если выше OpenAI или «другой» — подойдёт тот же ключ, поле можно не заполнять. С Anthropic картинки не рисуются — вставь здесь ключ OpenAI.'),
      field('Ключ картинок', inp(() => f.image.api_key, (v) => { f.image.api_key = v; }, { type: 'password', placeholder: keyHint(a.image?.key) })),
      field('Модель картинок', inp(() => f.image.model, (v) => { f.image.model = v; }, { placeholder: 'по умолчанию gpt-image-1' })),
      field('Адрес API картинок', inp(() => f.image.base_url, (v) => { f.image.base_url = v; }, { placeholder: 'по умолчанию https://api.openai.com/v1' })),
      field('Размер (необязательно)', inp(() => f.image.size, (v) => { f.image.size = v; }, { placeholder: 'например 1024x1536' })),
      h('div', { class: 'note' }, st.ai.image_ready ? '✅ Рисование фонов доступно.' : 'Рисование фонов не подключено.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => save() }, 'Сохранить'),
      a.key?.set ? h('button', { class: 'btn', onclick: () => save({ clear_key: true }) }, 'Стереть ключ') : null,
      a.image?.key?.set ? h('button', { class: 'btn', onclick: () => save({ clear_image_key: true }) }, 'Стереть ключ картинок') : null));
}
