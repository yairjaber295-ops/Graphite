// Диагностика: журнал ошибок и проверка, что умеет устройство (видео-форматы, кодировщик, WebGL).
// На телефоне, подключённом к компу, журнал сам уходит на комп (папка logs) — так проблемы видно с компа.
import { S } from './store.js';
import { env } from './backend/index.js';

const LOG = [];
const MAX = 300;
let sendTimer = null;

export function log(kind, msg, extra) {
  LOG.push({ t: new Date().toISOString(), kind, msg: String(msg).slice(0, 2000), ...(extra ? { extra } : {}) });
  if (LOG.length > MAX) LOG.shift();
  if (kind === 'error') scheduleSend();
}
export const logs = () => LOG.slice();

// всё, что упало, попадает в журнал
window.addEventListener('error', (e) => log('error', `${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}`, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => log('error', `promise: ${e.reason?.message || e.reason}`, e.reason?.stack));
for (const k of ['error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); log(k === 'error' ? 'error' : 'warn', a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'object' ? safe(x) : x)).join(' ')); };
}
function safe(x) { try { return JSON.stringify(x).slice(0, 500); } catch { return String(x); } }

/** Куда слать журнал: комп по Wi-Fi (телефон) — да; сам комп — не нужно. */
function pcLink() {
  const b = S.backend;
  if (!b || env.desktopApp) return null;
  if (b.kind === 'remote') return b;
  return b.pc || null;
}

function scheduleSend() {
  if (!pcLink()) return;
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => sendReport().catch(() => {}), 3000);
}

const DEC = {
  'H.264 (обычное mp4)': 'avc1.640028',
  'H.265 / HEVC (часто с телефона)': 'hvc1.1.6.L120.B0',
  'VP9 (YouTube)': 'vp09.00.40.08',
  'AV1 (YouTube)': 'av01.0.08M.08',
};

/** Возможности устройства — всё, что влияет на превью и экспорт. */
export async function capabilities() {
  const c = { ua: navigator.userAgent, chrome: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '?',
    native: env.native, mode: S.backend?.kind, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}`, project: S.project ? `${S.project.canvas.w}×${S.project.canvas.h} ${S.project.canvas.fps}fps` : null };
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    c.webgl2 = gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'да') : 'НЕТ';
    c.maxTexture = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch (e) { c.webgl2 = 'ошибка: ' + e.message; }
  c.webcodecs = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
  c.decode = {};
  c.play = {};
  const v = document.createElement('video');
  for (const [name, codec] of Object.entries(DEC)) {
    try { c.decode[name] = c.webcodecs ? (await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })).supported : false; } catch { c.decode[name] = false; }
    c.play[name] = v.canPlayType(`video/mp4; codecs="${codec}"`) || 'нет';
  }
  c.encode = {};
  if (c.webcodecs) {
    for (const [w, hh, fps, br] of [[1080, 1920, 60, 12e6], [1080, 1920, 30, 8e6], [720, 1280, 30, 5e6]]) {
      for (const hw of ['no-preference', 'prefer-software']) {
        let ok = false;
        try { ok = (await VideoEncoder.isConfigSupported({ codec: 'avc1.640034', width: w, height: hh, framerate: fps, bitrate: br, hardwareAcceleration: hw })).supported; } catch { /* нет */ }
        c.encode[`${w}×${hh} ${fps}fps${hw === 'prefer-software' ? ' (программно)' : ''}`] = ok;
      }
    }
    try { c.aac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; } catch { c.aac = false; }
  }
  try { const est = await navigator.storage?.estimate?.(); if (est) c.storage = `${(est.usage / 1e6).toFixed(0)} МБ из ${(est.quota / 1e6).toFixed(0)} МБ`; } catch { /* нет */ }
  return c;
}

export async function sendReport(withCaps = false) {
  const b = pcLink();
  if (!b) throw new Error('Телефон не подключён к компу');
  const body = { t: new Date().toISOString(), device: navigator.userAgent, project: S.project?.id || null, log: LOG.slice(-120) };
  if (withCaps) body.caps = await capabilities();
  const r = await fetch(b.url('/api/log'), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('комп не принял журнал');
}

/** Текст отчёта для окна «Диагностика». */
export async function reportText() {
  const c = await capabilities();
  const yn = (x) => (x === true ? 'да' : x === false ? 'НЕТ' : x);
  const lines = [
    `Устройство: ${c.ua}`, `Chrome/WebView: ${c.chrome} · ядер ${c.cores} · память ${c.memoryGB ?? '?'} ГБ · экран ${c.screen}`,
    `Режим: ${c.mode}${c.native ? ' (приложение)' : ''} · проект ${c.project || '—'}`,
    `WebGL2: ${c.webgl2} (текстуры до ${c.maxTexture})`, `Движок превью: ${window.__engine || 'ещё не запускался (открой проект)'}`,
    `WebCodecs: ${yn(c.webcodecs)} · AAC-звук: ${yn(c.aac)}`, c.storage ? `Память под проекты: ${c.storage}` : null,
    '', 'Декодирование (экспорт) / проигрывание (превью):',
    ...Object.keys(c.decode).map((k) => `  ${k}: ${yn(c.decode[k])} / ${c.play[k] || 'нет'}`),
    '', 'Кодирование H.264 для экспорта:', ...Object.entries(c.encode).map(([k, v]) => `  ${k}: ${yn(v)}`),
    '', `Журнал (${LOG.length}):`, ...LOG.slice(-60).map((e) => `  ${e.t.slice(11, 19)} [${e.kind}] ${e.msg}`),
  ];
  return lines.filter((x) => x != null).join('\n');
}
