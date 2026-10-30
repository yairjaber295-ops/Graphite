// Компоновщик кадра на WebGL2. Один и тот же код рисует превью и кадры экспорта.
//
// Порядок: для каждого активного клипа — фон (размытая копия или цвет) + видео с фильтром → слой;
// при переходе два слоя смешиваются шейдером; затем тряска/зум и эффекты на весь кадр;
// поверх — тексты (2D-холст) или обложка части.
import { VS, FS_COLOR, FS_BLUR, FS_TRANS, FS_POST, FS_OVER, FS_TRANS_LITE, FS_POST_LITE } from './shaders.js';
import { colorParams, POST_KEYS, TRANSITIONS } from './effects.js';
import { drawItem } from './text.js';
import { drawCover, drawCard, COVER_STYLES } from './covers.js';
import { adRect, hexRgb } from './ads.js';

function compile(gl, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Шейдер: ' + gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Шейдер: ' + gl.getProgramInfoLog(p));
  const uni = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    uni[name] = gl.getUniformLocation(p, name);
  }
  return { p, uni };
}

// матрицы 3×3 (по столбцам, как ждёт WebGL)
const mul = (a, b) => {
  const o = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
};
const T = (x, y) => new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);
const Sc = (x, y) => new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);
const R = (a) => new Float32Array([Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1]);
const chain = (...ms) => ms.reduce((acc, m) => mul(acc, m));

// облегчённые шейдеры не знают новых переходов — показываем похожий из тех, что есть
const LITE_KIND = { 49: 19, 50: 41, 51: 31, 52: 10, 53: 11, 54: 1, 55: 2, 56: 3, 57: 1, 58: 4, 59: 1, 60: 1, 45: 1, 46: 1, 47: 1, 48: 2,
  61: 1, 62: 1, 63: 1, 64: 4, 65: 1, 66: 1, 67: 1, 68: 2, 69: 1, 70: 1, 72: 41, 73: 1, 74: 1 };
const ID = T(0, 0);

export class Compositor {
  constructor(canvas, W, H) {
    this.canvas = canvas;
    this.W = W; this.H = H;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    // большие шейдеры переходов и эффектов на части телефонов не собираются — тогда облегчённые
    const heavy = (name, full, lite) => {
      try { return compile(gl, full); } catch (e) {
        console.warn(`[видеочип] ${name}: полная версия не собралась, включаю облегчённую. ${e.message}`);
        this.lite = true;
        return compile(gl, lite);
      }
    };
    this.prog = { color: compile(gl, FS_COLOR), blur: compile(gl, FS_BLUR), trans: heavy('переходы', FS_TRANS, FS_TRANS_LITE),
      post: heavy('эффекты', FS_POST, FS_POST_LITE), over: compile(gl, FS_OVER) };
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.src = [this.tex(), this.tex()];
    this.overlayTex = this.tex();
    this.adTex = this.tex();
    this.blackTex = this.tex(); // 1×1 чёрный — подложка рекламы на весь экран
    this.text = document.createElement('canvas');
    this.tctx = this.text.getContext('2d');
    this.resize(canvas.width, canvas.height);
  }

  tex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }

  fbo(w, h, old) {
    const gl = this.gl;
    if (old) { gl.deleteTexture(old.t); gl.deleteFramebuffer(old.f); }
    const t = this.tex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }

  resize(w, h) {
    w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
    this.canvas.width = w; this.canvas.height = h;
    this.outW = w; this.outH = h;
    const sw = Math.max(8, Math.round(w / 4)), sh = Math.max(8, Math.round(h / 4));
    this.A = this.fbo(w, h, this.A);
    this.B = this.fbo(w, h, this.B);
    this.L = this.fbo(w, h, this.L);
    this.s1 = this.fbo(sw, sh, this.s1);
    this.s2 = this.fbo(sw, sh, this.s2);
    this.text.width = w; this.text.height = h;
  }

  // --- низкоуровневое рисование ---
  bindTarget(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
    gl.viewport(0, 0, target ? target.w : this.outW, target ? target.h : this.outH);
    this.flip = target ? -1 : 1; // в текстуры пишем «как есть», на экран — с переворотом
  }

  draw(prog, M = ID, uvr = [0, 0, 1, 1]) {
    const gl = this.gl;
    // на экран: y вниз → переворот; в FBO: без переворота (тогда текстуры FBO читаются как видео)
    const m = this.flip < 0 ? mul(new Float32Array([1, 0, 0, 0, -1, 0, 0, 1, 1]), M) : M;
    gl.uniformMatrix3fv(prog.uni.M, false, m);
    gl.uniform4fv(prog.uni.uvr, uvr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  use(name) { const pr = this.prog[name]; this.gl.useProgram(pr.p); return pr; }

  setColor(pr, c, dim = 0, alpha = 1) {
    const gl = this.gl;
    gl.uniform1f(pr.uni.bright, c.bright); gl.uniform1f(pr.uni.contrast, c.contrast);
    gl.uniform1f(pr.uni.sat, c.sat); gl.uniform1f(pr.uni.temp, c.temp);
    gl.uniform1f(pr.uni.fade, c.fade); gl.uniform1f(pr.uni.teal, c.teal);
    gl.uniform1f(pr.uni.dim, dim); gl.uniform1f(pr.uni.alpha, alpha);
    gl.uniform4f(pr.uni.key, 0, 0, 0, 0);
    gl.uniform3f(pr.uni.rr, 0, 0, 0);
  }

  /** Хромакей для следующего рисования (после setColor). */
  setKey(pr, ch) {
    if (!ch?.enabled) return;
    const [r, g, b] = hexRgb(ch.color);
    this.gl.uniform4f(pr.uni.key, r, g, b, 1);
    this.gl.uniform3f(pr.uni.keyp, ch.sim ?? 0.4, ch.smooth ?? 0.08, ch.spill ?? 0.1);
  }

  /**
   * Гауссово размытие содержимого s1 (на месте). sigmaPx — в пикселях кадра (1080 по ширине).
   * Шаг ядра не больше 1,2 текселя (иначе появляется «клетка»), нужная сила набирается числом проходов:
   * n проходов по σ дают σ·√n. Так размытие одинаковое и в маленьком превью, и в экспорте 1080×1920.
   */
  gauss(sigmaPx) {
    const gl = this.gl;
    const sigmaSmall = sigmaPx * (this.s1.w / this.W);
    const KERNEL_SIGMA = 1.75; // σ нашего 9-точечного ядра при шаге 1
    let step = 1.2;
    let passes = Math.ceil(Math.pow(sigmaSmall / (KERNEL_SIGMA * step), 2));
    if (passes > 16) { passes = 16; step = sigmaSmall / (KERNEL_SIGMA * 4); }
    if (passes < 1) { passes = 1; step = Math.max(0.2, sigmaSmall / KERNEL_SIGMA); }
    const pr = this.use('blur');
    for (let i = 0; i < passes; i++) {
      this.bindTarget(this.s2); gl.bindTexture(gl.TEXTURE_2D, this.s1.t);
      gl.uniform2f(pr.uni.dir, step / this.s1.w, 0); this.draw(pr);
      this.bindTarget(this.s1); gl.bindTexture(gl.TEXTURE_2D, this.s2.t);
      gl.uniform2f(pr.uni.dir, 0, step / this.s1.h); this.draw(pr);
    }
  }

  blurInto(srcTex, sigmaPx) {
    const gl = this.gl;
    const pr = this.use('color');
    this.bindTarget(this.s1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    this.setColor(pr, { bright: 0, contrast: 0, sat: 0, temp: 0, fade: 0, teal: 0 });
    this.draw(pr);
    this.gauss(sigmaPx);
    return this.s1.t;
  }

  /**
   * Совместимый режим: на части Android-телефонов WebGL получает из <video> чёрный кадр.
   * Тогда кадр сначала копируется в обычный 2D-холст (до 1280 px) — так работает везде.
   */
  compatSource(src, w, h) {
    if (!this.compat || typeof HTMLVideoElement === 'undefined' || !(src instanceof HTMLVideoElement)) return src;
    const k = Math.min(1, 1280 / Math.max(w, h));
    const cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
    this.cc ||= document.createElement('canvas');
    if (this.cc.width !== cw || this.cc.height !== ch) { this.cc.width = cw; this.cc.height = ch; }
    this.cc.getContext('2d').drawImage(src, 0, 0, cw, ch);
    return this.cc;
  }

  /** Кадр целиком чёрный? (5 точек в середине) — для автовключения совместимого режима. */
  isBlack() {
    const gl = this.gl, px = new Uint8Array(4);
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.7, 0.6], [0.4, 0.7], [0.6, 0.3]]) {
      gl.readPixels(Math.floor(this.outW * fx), Math.floor(this.outH * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] > 6) return false;
    }
    return true;
  }

  /** Слой одного клипа: фон + видео. src — <video>, VideoFrame или null. */
  renderClip(slot, src, srcW, srcH, clip, bg, target) {
    const gl = this.gl;
    this.bindTarget(target);
    gl.disable(gl.BLEND);
    const col = colorParams(clip);
    const keyed = !!clip.chroma?.enabled;
    // с хромакеем под вырезанным фоном — цвет фона холста (размытая копия была бы того же зелёного)
    if (keyed) bg = { ...bg, mode: 'color' };
    if (bg.mode !== 'blur' || !src) {
      const c = parseInt((bg.color || '#000000').slice(1), 16);
      gl.clearColor((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (!src || !srcW) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src[slot]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.compatSource(src, srcW, srcH));
    const W = this.W, H = this.H;
    if (bg.mode === 'blur') {
      // фон: видео «по размеру кадра с обрезкой» в маленький буфер → размытие → растянуть
      let pr = this.use('color');
      this.bindTarget(this.s1);
      const s = Math.max(W / srcW, H / srcH);
      const cw = W / (srcW * s), ch = H / (srcH * s);
      this.setColor(pr, col);
      this.draw(pr, ID, [(1 - cw) / 2, (1 - ch) / 2, cw, ch]);
      if (bg.blur > 0) this.gauss(bg.blur);
      pr = this.use('color');
      this.bindTarget(target);
      gl.bindTexture(gl.TEXTURE_2D, this.s1.t);
      this.setColor(pr, { bright: 0, contrast: 0, sat: 0, temp: 0, fade: 0, teal: 0 }, bg.dim || 0);
      this.draw(pr);
      gl.bindTexture(gl.TEXTURE_2D, this.src[slot]);
    }
    // видео: ширина = scale × ширина кадра, центр + смещение, поворот
    const pr = this.use('color');
    this.bindTarget(target);
    // sx/sy — растяг клипа по ширине/высоте (1 — без растяга)
    const fw = W * (clip.scale ?? 1) * (clip.sx || 1), fh = W * (clip.scale ?? 1) * srcH / srcW * (clip.sy || 1);
    const M = chain(Sc(1 / W, 1 / H), T(W / 2 + (clip.x || 0), H / 2 + (clip.y || 0)), R((clip.rot || 0) * Math.PI / 180), Sc(fw, fh), T(-0.5, -0.5));
    this.setColor(pr, col);
    if (keyed) {
      this.setKey(pr, clip.chroma);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    }
    this.draw(pr, M);
    gl.disable(gl.BLEND);
  }

  /** Реклама поверх кадра (после эффектов, под текстами). Возвращает рамки — рекламу можно двигать в превью. */
  drawAds(ads) {
    const gl = this.gl, W = this.W, H = this.H, k = this.outW / W;
    const boxes = [];
    for (const ad of ads || []) {
      if (!ad.src || !ad.w) continue;
      const r = adRect(ad, W, H);
      if (!r) continue;
      this.bindTarget(null);
      gl.enable(gl.BLEND);
      if (ad.mode === 'full' && !ad.chroma) {
        // на весь экран: затемняем видео под рекламой
        const po = this.use('over');
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.blackTex);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(po.uni.alpha, ad.alpha);
        this.draw(po);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.adTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.compatSource(ad.src, ad.w, ad.h));
      const pr = this.use('color');
      this.setColor(pr, { bright: 0, contrast: 0, sat: 0, temp: 0, fade: 0, teal: 0 }, 0, ad.alpha);
      if (ad.chroma) this.setKey(pr, ad.chroma);
      if (ad.radius > 0) gl.uniform3f(pr.uni.rr, ad.radius * Math.min(r.w, r.h) * k, r.w * k, r.h * k);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      this.draw(pr, chain(Sc(1 / W, 1 / H), T(r.cx, r.cy), Sc(r.w, r.h), T(-0.5, -0.5)));
      gl.disable(gl.BLEND);
      boxes.push({ item: { kind: 'ad', id: ad.id }, box: { x: r.cx - r.w / 2, y: r.cy - r.h / 2, w: r.w, h: r.h } });
    }
    return boxes;
  }

  /**
   * Кадр целиком.
   * f = { layers: [{src, w, h, clip}], trans: {kind, p} | null, bg, fx (evalEffects), texts: [items], t,
   *       cover: {title, label, font, accent} | null }
   */
  render(f) {
    const gl = this.gl;
    const W = this.W, H = this.H;
    let layerTex;
    if (f.layers.length >= 2 && f.trans) {
      this.renderClip(0, f.layers[0].src, f.layers[0].w, f.layers[0].h, f.layers[0].clip, f.bg, this.A);
      this.renderClip(1, f.layers[1].src, f.layers[1].w, f.layers[1].h, f.layers[1].clip, f.bg, this.B);
      const pr = this.use('trans');
      this.bindTarget(this.L);
      gl.uniform1i(pr.uni.A, 0); gl.uniform1i(pr.uni.B, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.A.t);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.B.t);
      gl.uniform1f(pr.uni.p, Math.max(0, Math.min(1, f.trans.p)));
      gl.uniform1i(pr.uni.kind, this.lite ? LITE_KIND[f.trans.kind] ?? f.trans.kind : f.trans.kind);
      gl.uniform4fv(pr.uni.tp, f.trans.tp || TRANSITIONS[f.trans.type]?.tp || [0, 0, 0, 0]);
      gl.uniform2f(pr.uni.res, W, H);
      this.draw(pr);
      gl.activeTexture(gl.TEXTURE0);
      layerTex = this.L.t;
    } else {
      const l = f.layers[0] || { src: null, clip: {} };
      this.renderClip(0, l.src, l.w, l.h, l.clip, f.bg, this.L);
      layerTex = this.L.t;
    }

    gl.activeTexture(gl.TEXTURE0);
    if (f.cover) {
      // обложка: размытый и затемнённый кадр (или просто притемнённый — по стилю) + оформление
      const blur = COVER_STYLES[f.cover.style]?.blur !== false;
      const src = blur ? this.blurInto(layerTex, 45) : layerTex; // размытие переключает шейдер — до use('color')
      const pr = this.use('color');
      this.bindTarget(null);
      gl.bindTexture(gl.TEXTURE_2D, src);
      this.setColor(pr, { bright: 0, contrast: 0, sat: -0.1, temp: 0, fade: 0, teal: 0 }, blur ? 0.55 : 0.2);
      this.draw(pr);
      this.tctx.setTransform(1, 0, 0, 1, 0, 0);
      this.tctx.clearRect(0, 0, this.outW, this.outH);
      drawCover(this.tctx, f.cover, this.outW / W, W, H);
      this.overlay();
      return;
    }

    // тряска, зум и эффекты на весь кадр
    const fx = f.fx || { scale: 1, tx: 0, ty: 0, rot: 0 };
    const pr = this.use('post');
    this.bindTarget(null);
    gl.bindTexture(gl.TEXTURE_2D, layerTex);
    // выходная точка → точка слоя: обратная трансформация вокруг центра (в пикселях, чтобы поворот был без искажений)
    const uvM = chain(Sc(1 / W, 1 / H), T(W / 2, H / 2), R(-fx.rot), Sc(1 / (fx.scale * (fx.stx || 1)), 1 / (fx.scale * (fx.sty || 1))), T(-W / 2 - fx.tx * W, -H / 2 - fx.ty * H), Sc(W, H));
    gl.uniformMatrix3fv(pr.uni.uvM, false, uvM);
    gl.uniform2f(pr.uni.res, this.outW, this.outH);
    gl.uniform2f(pr.uni.frame, W, H);
    gl.uniform1f(pr.uni.time, f.t || 0);
    for (const k of POST_KEYS) gl.uniform1f(pr.uni[k], fx[k] || 0);
    gl.uniform3fv(pr.uni.tintC, fx.tintC || [1, 1, 1]);
    gl.uniform2fv(pr.uni.mdir, fx.mdir || [0, 0]);
    // семейства эффектов: тип/параметры (на облегчённом шейдере этих uniform нет — вызовы просто ничего не делают)
    gl.uniform1f(pr.uni.wtype, fx.wtype || 0);
    gl.uniform1f(pr.uni.gridn, fx.gridn || 0);
    gl.uniform1f(pr.uni.ftype, fx.ftype || 0);
    gl.uniformMatrix3fv(pr.uni.cgm, false, fx.cg?.m || [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.uniform3fv(pr.uni.cga, fx.cg?.a || [0, 0, 0]);
    const pt = fx.part || {};
    gl.uniform1f(pr.uni.pshape, pt.shape || 0); gl.uniform1f(pr.uni.psize, pt.size || 0.1); gl.uniform1f(pr.uni.pdens, pt.dens || 0);
    gl.uniform1f(pr.uni.psway, pt.sway || 0); gl.uniform1f(pr.uni.pglow, pt.glow || 0); gl.uniform1f(pr.uni.prain, pt.rain || 0);
    gl.uniform2fv(pr.uni.pvel, pt.vel || [0, 0]);
    gl.uniform3fv(pr.uni.pcol, pt.col || [1, 1, 1]);
    this.draw(pr);
    const adBoxes = this.drawAds(f.ads);

    // тексты и карточка истории
    if ((f.texts && f.texts.length) || f.card) {
      const k = this.outW / W;
      this.tctx.setTransform(1, 0, 0, 1, 0, 0);
      this.tctx.clearRect(0, 0, this.outW, this.outH);
      const boxes = [...adBoxes];
      for (const it of f.texts || []) {
        const b = drawItem(this.tctx, it, f.t, k);
        if (b) boxes.push({ item: it, box: b });
      }
      if (f.card) drawCard(this.tctx, f.card, k, W, H);
      this.overlay();
      return boxes;
    }
    return adBoxes;
  }

  overlay() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.text);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const pr = this.use('over');
    this.bindTarget(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(pr.uni.alpha, 1);
    this.draw(pr);
    gl.disable(gl.BLEND);
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
