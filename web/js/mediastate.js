// Состояние каждого видео/звука проекта: готовность, миниатюры, волна, паузы, распознанные слова.
import { S, emit } from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadMedia(mid) {
  const pid = S.project.id;
  const st = (S.media[mid] ||= { status: 'preparing' });
  if (st.loading) return;
  st.loading = true;
  try {
    let hadProxy = false;
    for (;;) {
      if (!S.project || S.project.id !== pid) return;
      const r = await S.backend.mediaState(pid, mid).catch(() => null);
      if (r) {
        Object.assign(st, r);
        if (r.meta?.proxy && !hadProxy) { hadProxy = true; emit('media-ready'); }
        if (r.status === 'ready') break;
      }
      await sleep(1500);
    }
    const m = S.project?.media.find((x) => x.id === mid);
    if (m?.kind === 'image') {
      // фото: сама картинка — и кадр для превью, и миниатюра на таймлайне
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        st.meta = { ...st.meta, thumb_w: im.naturalWidth, thumb_h: im.naturalHeight, thumb_interval: 1e9, thumbs_per_tile: 1 };
        st.img = im;
        emit('media-ready');
      };
      im.src = await S.backend.mediaUrl(pid, m);
      st.tiles = [im];
    } else if (st.tileUrls) {
      st.tiles = st.tileUrls.map((u) => {
        const im = new Image();
        im.onload = () => emit('media-ready');
        im.src = u;
        return im;
      });
    }
    emit('media-ready');
  } finally {
    st.loading = false;
  }
}
