"""Очередь публикаций: несколько серий подряд в TikTok через загрузчик из папки «Скрипты».

Серии идут одна за другой (части не перемешиваются), между публикациями — заданный интервал.
Предупреждения об авторских правах загрузчик не прокликивает — такие части пропускаются.

  python schedule_queue.py --start "2026-10-29 18:00" --interval 6 "path/to/series1" "path/to/series2"
  --dry-run — заполнить форму для одной части и НЕ публиковать.
"""
import argparse
import asyncio
import datetime
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import SCRIPTS_DIR  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='Очередь публикаций в TikTok')
    ap.add_argument('series', nargs='+', help='папки серий по порядку')
    ap.add_argument('--start', help='первая публикация, «ГГГГ-ММ-ДД ЧЧ:ММ» (по умолчанию — через 30 минут)')
    ap.add_argument('--interval', type=float, default=6.0, help='часов между публикациями')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-pause', action='store_true', help='не ждать Enter в конце')
    a = ap.parse_args()
    if not SCRIPTS_DIR:
        print('❌ Не нашёл папку «Скрипты» с загрузчиком.')
        return 1
    sys.path.insert(0, os.path.join(SCRIPTS_DIR, 'lib'))
    import tiktok_upload as tu  # загрузчик: окно Firefox с твоим входом

    cfg = tu.load_config()
    cfg['interval_hours'] = a.interval
    start = (datetime.datetime.strptime(a.start, '%Y-%m-%d %H:%M') if a.start
             else tu.round_up_5min(datetime.datetime.now() + datetime.timedelta(minutes=30)))
    summary = []
    for d in a.series:
        if not os.path.isdir(d):
            print(f'⚠️ Нет папки: {d}')
            continue
        title, parts = tu.series_info(d)
        journal = tu.load_journal(d)
        parts = [p for p in parts if os.path.exists(p['path'])]
        plan, later = tu.build_plan(parts, journal, title, '', cfg['hashtags'], start, a.interval, cfg['max_schedule_days'])
        tu.print_plan(title, plan, later)
        if not plan:
            continue
        if a.dry_run:
            tu.report(asyncio.run(tu.run_plan(d, plan[:1], cfg, True)), d)
            break
        res = asyncio.run(tu.run_plan(d, plan, cfg, False))
        tu.report(res, d)
        summary.append((title, res, plan[0]['when'], plan[-1]['when'], len(later)))
        # следующая серия — сразу после последнего слота этой (даже если какая-то часть пропущена)
        start = plan[-1]['when'] + datetime.timedelta(hours=a.interval)

    print('\n===== ИТОГ =====')
    for title, res, first, last, later in summary:
        print(f'{title}: запланировано {res["scheduled"]}, без подтверждения {res["unconfirmed"]}, пропущено (АП) {res["warning"]}, '
              f'ошибок {res["failed"]}; {tu.fmt_dt(first)} … {tu.fmt_dt(last)}' + (f'; не влезло в 10 дней: {later}' if later else ''))
    if not a.no_pause:
        input('\nГотово. Нажми Enter, чтобы закрыть окно.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
