"""Фоновые задачи (превью, распознавание, экспорт) с прогрессом для интерфейса."""
import threading
import time
import traceback
import uuid

_jobs = {}
_lock = threading.Lock()
# тяжёлые задачи на видеокарте выполняем по одной, чтобы не делить память
gpu_lock = threading.Lock()


class Job:
    def __init__(self, kind, project, title):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.project = project
        self.title = title
        self.status = 'queued'   # queued | running | done | error | cancelled
        self.progress = 0.0
        self.message = ''
        self.result = None
        self.error = None
        self.created = time.time()
        self.cancel_requested = False
        self.procs = set()  # запущенные процессы ffmpeg, чтобы можно было отменить

    def update(self, progress=None, message=None):
        if progress is not None:
            self.progress = max(0.0, min(1.0, progress))
        if message is not None:
            self.message = message

    def check_cancel(self):
        if self.cancel_requested:
            raise JobCancelled()

    def to_dict(self):
        return {'id': self.id, 'kind': self.kind, 'project': self.project, 'title': self.title,
                'status': self.status, 'progress': round(self.progress, 4), 'message': self.message,
                'result': self.result, 'error': self.error}


class JobCancelled(Exception):
    pass


def start(kind, project, title, fn, *args, **kwargs):
    """Запускает fn(job, *args) в отдельном потоке."""
    job = Job(kind, project, title)
    with _lock:
        _jobs[job.id] = job

    def run():
        job.status = 'running'
        try:
            job.result = fn(job, *args, **kwargs)
            job.status = 'done'
            job.progress = 1.0
        except JobCancelled:
            job.status = 'cancelled'
            job.message = 'Отменено'
        except Exception as e:
            job.status = 'error'
            job.error = str(e) or e.__class__.__name__
            traceback.print_exc()
    threading.Thread(target=run, daemon=True).start()
    return job


def get(job_id):
    return _jobs.get(job_id)


def list_for(project=None):
    with _lock:
        items = [j for j in _jobs.values() if project is None or j.project == project]
    # старые завершённые задачи не нужны интерфейсу
    now = time.time()
    return [j.to_dict() for j in items if j.status in ('queued', 'running') or now - j.created < 600]


def cancel(job_id):
    job = _jobs.get(job_id)
    if not job:
        return False
    job.cancel_requested = True
    for proc in list(job.procs):
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass
    return True
