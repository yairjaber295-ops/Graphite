// Публикации в TikTok: какие серии готовы, что уже запланировано, очередь с интервалом.
// Сам загрузчик — твой из папки «Скрипты» (окно Firefox с твоим входом). Предупреждения об авторских правах
// он не прокликивает: такие части пропускаются, решение за тобой.
import { S } from './store.js';
import { h, field, modal, toast, fill, select as sel, check } from './ui.js';

const RU_TAG = /#[^\s#]*[а-яё][^\s#]*/i;
const LATIN_SET = '#cs2 #csgo #counterstrike2 #counterstrike #cs2clips #cs2moments #cs2highlights';

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmt = (d) => d.toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Серии, ждущие выкладки (для значков на карточках проектов). */
export async function pendingSeries() {
  try { return (await S.backend.req('GET', '/api/publish')).pending; } catch { return []; }
}

/**
 * Окно публикаций. project — открыто из проекта: отмечена только его серия; если он ещё не экспортирован —
 * предлагается «Экспортировать и запланировать».
 */
export async function publishDialog({ project = null } = {}) {
  let info;
  try { info = await S.backend.req('GET', '/api/publish'); } catch (e) { return toast(e.message, 'err'); }
  const own = project ? info.pending.filter((s) => s.project === project.id) : [];
  const picked = new Set((project ? own : info.pending).map((s) => s.dir));
  // серии проекта — первыми
  const order = [...own, ...info.pending.filter((s) => !own.includes(s))].map((s) => s.dir);
  let interval = info.interval_hours || 6;
  let hashtags = info.hashtags || '';
  const future = info.scheduled.filter((x) => x.status === 'scheduled' && x.when && new Date(x.when) > new Date());
  const lastPlanned = future.length ? new Date(future[future.length - 1].when) : null;
  let start = lastPlanned ? new Date(lastPlanned.getTime() + interval * 3600e3) : new Date(Date.now() + 30 * 60e3);
  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);

  modal((box, close) => {
    box.classList.add('wide');
    const draw = () => {
      const series = order.map((d) => info.pending.find((s) => s.dir === d)).filter(Boolean);
      // план: серии подряд, каждая часть — через interval часов
      const plan = [];
      let t = new Date(start);
      for (const s of series) {
        if (!picked.has(s.dir)) continue;
        for (const f of s.files) { plan.push({ series: s.title, file: f, when: new Date(t) }); t = new Date(t.getTime() + interval * 3600e3); }
      }
      const limit = Date.now() + (info.max_days || 10) * 864e5 - 10 * 60e3;
      const inLimit = plan.filter((x) => x.when.getTime() <= limit).length;
      const move = (d, k) => { const i = order.indexOf(d); const j = i + k; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; draw(); };
      const ru = RU_TAG.test(hashtags);
      const quick = (label, d) => h('button', { class: 'chip-btn', onclick: () => { start = d; draw(); } }, label);
      const at = (days, hh) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hh, 0, 0, 0); return d; };
      const run = async (dry) => {
        const dirs = order.filter((d) => picked.has(d));
        if (!dirs.length) return toast('Выбери хотя бы одну серию');
        try {
          await S.backend.req('POST', '/api/publish/config', { hashtags, interval_hours: interval });
          await S.backend.req('POST', '/api/publish/run', { dirs, start: toLocal(start), interval, dry });
          toast(dry ? 'Тест: откроется окно и Firefox — форма заполнится, но публикации не будет' : 'Запущено: смотри окно загрузчика. Прогресс — здесь, кнопка «Обновить»', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
      fill(box,
        h('h2', {}, 'Публикации в TikTok'),
        !info.uploader ? h('div', { class: 'note warn' }, 'Не нашёл папку «Скрипты» с загрузчиком на рабочем столе.') : null,
        info.running ? h('div', { class: 'note warn' }, '⏳ Сейчас идёт публикация — окно загрузчика открыто. Новую очередь можно будет запустить после.') : null,
        project && !own.length ? h('div', { class: 'group' },
          h('b', {}, `«${project.name}» ещё не экспортирован`),
          h('div', { class: 'note', style: { margin: '4px 0 0' } }, 'Сначала части нужно отрендерить. Нажми — экспорт по частям, и сразу после него откроется это окно с ним.'),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { close(); import('./exportui.js').then((m) => m.openExport({ thenPublish: true })); } },
            'Экспортировать и запланировать'))) : null,
        h('h3', {}, `Готово к выкладке · ${series.length}`),
        series.length ? h('div', { class: 'pub-list' }, ...series.map((s) => h('div', { class: 'pub-row' + (picked.has(s.dir) ? ' on' : '') },
          check('', picked.has(s.dir), (v) => { if (v) picked.add(s.dir); else picked.delete(s.dir); draw(); }),
          h('div', { class: 'pub-title' }, h('b', {}, s.title), h('small', {}, `${s.count} видео`)),
          h('button', { class: 'icon-btn', title: 'Выше', onclick: () => move(s.dir, -1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Ниже', onclick: () => move(s.dir, 1) }, '↓'))))
          : h('div', { class: 'note' }, 'Нет экспортированных серий. Экспорт «По частям» кладёт их в папку нарезок.'),
        h('h3', { style: { marginTop: '14px' } }, 'Расписание'),
        h('div', { class: 'row' },
          field('Интервал между видео', sel({ 2: '2 часа', 3: '3 часа', 4: '4 часа', 5: '5 часов', 6: '6 часов', 8: '8 часов', 12: '12 часов', 24: 'раз в сутки' },
            String(interval), (v) => { interval = +v; draw(); })),
          field('Первая публикация', (() => { const i = h('input', { type: 'datetime-local', value: toLocal(start) }); i.onchange = () => { if (i.value) { start = new Date(i.value); draw(); } }; return i; })())),
        h('div', { class: 'chips' },
          quick('Через 30 минут', new Date(Date.now() + 30 * 60e3)), quick('Сегодня 18:00', at(0, 18)), quick('Завтра 18:00', at(1, 18)),
          quick('Через 2 дня 18:00', at(2, 18)),
          lastPlanned ? quick('После уже запланированных', new Date(lastPlanned.getTime() + interval * 3600e3)) : null),
        interval < 4 ? h('div', { class: 'note warn' }, 'Чаще раза в 4 часа TikTok может резать охват новых видео. Надёжнее 4–6 часов.') : null,
        field('Хэштеги (ко всем частям)', (() => { const ta = h('textarea', { rows: 2, spellcheck: false }, hashtags); ta.oninput = () => { hashtags = ta.value; }; ta.onchange = draw; return ta; })()),
        ru ? h('div', { class: 'note warn' }, 'Русские хэштеги TikTok через автозагрузку не превращает в ссылки (они уйдут текстом). Латинские — превращает.',
          h('div', { class: 'btn-row', style: { marginTop: '6px' } }, h('button', { class: 'btn', onclick: () => { hashtags = LATIN_SET; draw(); } }, 'Заменить на латинские: ' + LATIN_SET))) : null,
        plan.length ? h('div', { class: 'note' }, `План: ${plan.length} видео, с ${fmt(plan[0].when)} по ${fmt(plan[plan.length - 1].when)}.` +
          (inLimit < plan.length ? ` TikTok планирует максимум на ${info.max_days || 10} дней — сейчас уйдут ${inLimit}, остальные запусти позже (продолжится с того же места).` : '')) : null,
        plan.length ? h('details', {}, h('summary', {}, 'Показать всё расписание'),
          h('div', { class: 'file-list' }, ...plan.map((x) => h('div', {}, `${fmt(x.when)} — ${x.file.replace(/\.mp4$/i, '')}`)))) : null,
        h('h3', { style: { marginTop: '14px' } }, `Уже запланировано · ${future.length}`),
        future.length ? h('div', { class: 'file-list' }, ...future.slice(0, 60).map((x) => h('div', {}, `${fmt(new Date(x.when))} — ${x.file.replace(/\.mp4$/i, '')}`)))
          : h('div', { class: 'note' }, 'Пока ничего.'),
        info.scheduled.some((x) => x.status !== 'scheduled') ? h('details', {}, h('summary', {}, 'Проблемные части (пропущены/ошибки)'),
          h('div', { class: 'file-list' }, ...info.scheduled.filter((x) => x.status !== 'scheduled').map((x) => h('div', {}, `${x.status}: ${x.file} — ${x.error}`)))) : null,
        info.log.length ? h('details', {}, h('summary', {}, 'Журнал загрузчика'), h('pre', { class: 'diag' }, info.log.join('\n'))) : null,
        h('div', { class: 'note' }, 'Откроется окно Firefox с твоим входом в TikTok — не закрывай его, пока идёт загрузка. Если TikTok найдёт проблему с авторскими правами, часть пропускается.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: async () => { close(); publishDialog(); } }, 'Обновить'),
          h('button', { class: 'btn', disabled: info.running || !plan.length, onclick: () => run(true) }, 'Тест без публикации'),
          h('button', { class: 'btn primary', disabled: info.running || !plan.length, onclick: () => run(false) }, `Запланировать ${plan.length ? `(${Math.min(plan.length, inLimit)})` : ''}`)));
    };
    draw();
  });
}
