// Шейдеры движка. Координаты кадра: (0,0) — левый верхний угол, (1,1) — правый нижний.

// Прямоугольник с произвольной матрицей: M переводит единичный квадрат в координаты кадра.
export const VS = `#version 300 es
in vec2 p;
uniform mat3 M;
uniform vec4 uvr;
out vec2 uv;
void main() {
  vec3 q = M * vec3(p, 1.0);
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
  uv = uvr.xy + p * uvr.zw;
}`;

// Текстура + цветокоррекция (фильтры клипа). Для фона и для самого видео.
export const FS_COLOR = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D tex;
uniform float bright, contrast, sat, temp, fade, teal, dim, alpha;
uniform vec4 key;   // хромакей: rgb цвета, w > 0 — включён
uniform vec3 keyp;  // близость, мягкость края, подавление ореола
uniform vec3 rr;    // скругление углов: радиус, ширина, высота (в пикселях вывода)
out vec4 o;
vec2 cbcr(vec3 c) { return vec2(dot(c, vec3(-0.169, -0.331, 0.5)) + 0.5, dot(c, vec3(0.5, -0.419, -0.081)) + 0.5); }
void main() {
  vec3 c = texture(tex, uv).rgb;
  float a = alpha;
  if (key.w > 0.0) {
    // как в OBS: расстояние по цветности, мягкий край и обесцвечивание зелёного ореола
    float base = distance(cbcr(c), cbcr(key.rgb)) - keyp.x;
    a *= pow(clamp(base / max(keyp.y, 0.001), 0.0, 1.0), 1.5);
    float sp = pow(clamp(base / max(keyp.z, 0.001), 0.0, 1.0), 1.5);
    c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, sp);
  }
  if (rr.x > 0.0) {
    vec2 q = abs(uv - 0.5) * rr.yz - (rr.yz * 0.5 - rr.x);
    a *= clamp(rr.x - length(max(q, 0.0)) + 0.5, 0.0, 1.0);
  }
  c = (c - 0.5) * (1.0 + contrast) + 0.5 + bright * 0.25;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + sat);
  c += vec3(0.07, 0.015, -0.07) * temp;
  // «кино»: тени в бирюзу, света в оранжевый
  c += teal * (vec3(0.06, 0.0, -0.06) * l - vec3(0.06, -0.02, -0.07) * (1.0 - l));
  c = c * (1.0 - fade * 0.45) + fade * 0.18; // «выцветание»: приподнятые тени
  o = vec4(clamp(c, 0.0, 1.0) * (1.0 - dim), a);
}`;

// Раздельное гауссово размытие (9 отсчётов).
export const FS_BLUR = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D tex;
uniform vec2 dir;
out vec4 o;
void main() {
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec4 c = texture(tex, uv) * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(tex, uv + dir * float(i)) * w[i];
    c += texture(tex, uv - dir * float(i)) * w[i];
  }
  o = c;
}`;

// Переходы между клипами A → B, p от 0 до 1.
export const FS_TRANS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D A, B;
uniform float p;
uniform int kind;
uniform vec2 res;
uniform vec4 tp; // параметры семейства переходов (направление, фигура, цвет…)
out vec4 o;
float ease(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
vec4 at(sampler2D t, vec2 q) { return texture(t, clamp(q, 0.0, 1.0)); }
vec4 dirBlur(sampler2D t, vec2 q, vec2 d) {
  vec4 c = vec4(0.0);
  for (int i = -6; i <= 6; i++) c += at(t, q + d * float(i) / 6.0);
  return c / 13.0;
}
float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
// шторка: 1 там, где уже B; v — координата вдоль движения (0 — откуда начинается), w — мягкость края
float wipe(float v, float e, float w) { float pos = e * (1.0 + 2.0 * w) - w; return 1.0 - smoothstep(pos - w, pos + w, v); }
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0);
mat2 rot2(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
// пятиконечная звезда (расстояние со знаком; < 0 — внутри), r — радиус, rf — «толщина» лучей
float star5(vec2 q, float r, float rf) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-0.809016994, -0.587785252);
  q.x = abs(q.x);
  q -= 2.0 * max(dot(k1, q), 0.0) * k1;
  q -= 2.0 * max(dot(k2, q), 0.0) * k2;
  q.x = abs(q.x);
  q.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(q, ba) / dot(ba, ba), 0.0, r);
  return length(q - ba * h) * sign(q.y * ba.x - q.x * ba.y);
}
// «окно»: следующий клип в фигуре поверх затемнённого текущего (как вклейки в эдитах).
// shape: 0 — карточка с наклоном и перспективой, 1 — круг, 2 — звезда
vec4 windowTrans(int shape, float asp, vec2 c) {
  float k1 = ease(clamp(p / 0.62, 0.0, 1.0)), k2 = ease(clamp((p - 0.62) / 0.38, 0.0, 1.0));
  // фон: текущий клип наезжает, темнеет и размывается
  vec2 qa = 0.5 + (uv - 0.5) / (1.0 + 0.18 * k1);
  vec4 bg = dirBlur(A, qa, (qa - 0.5) * 0.06 * k1);
  bg = vec4(bg.rgb * (1.0 - 0.3 * k1), 1.0); // фон под окном темнеет чуть-чуть, а не на 60%
  if (shape == 0) {
    float sc = mix(mix(0.1, 0.48, k1), 1.0, k2);
    float ang = mix(mix(-0.42, -0.1, k1), 0.0, k2);
    vec2 l = rot2(-ang) * c / sc;
    l.x *= 1.0 + 0.35 * l.y * (1.0 - k1) * (1.0 - k2);           // перспектива: карточка «наклонена» к зрителю
    vec2 q = l / vec2(asp, 1.0) + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
      vec2 d = max(abs(q - 0.5) - 0.5, 0.0) * vec2(asp, 1.0) * sc;
      return vec4(bg.rgb * (1.0 - 0.5 * exp(-length(d) * 40.0) * (1.0 - k2)), 1.0); // мягкая тень вокруг
    }
    return at(B, q);
  }
  if (shape == 1) {
    float r = mix(mix(0.04, 0.3, k1), 1.2, k2);
    if (length(c) > r) return bg;
    float z = mix(1.6, 1.0, max(k1 * 0.4, k2));                    // внутри круга — крупно, потом отъезжает
    vec4 col = at(B, 0.5 + (uv - 0.5) / z);
    float rim = smoothstep(r - 0.012, r, length(c)) * (1.0 - k2);
    return mix(col, vec4(1.0), rim * 0.8);
  }
  float d = star5(rot2((1.0 - k1) * 1.4) * vec2(c.x, -c.y), mix(mix(0.02, 0.36, k1), 2.6, k2 * k2), 0.45);
  if (d > 0.0) return mix(bg, vec4(1.0), smoothstep(0.012, 0.0, d) * 0.9 * (1.0 - k2));
  return at(B, uv);
}
// --- для эдитов: края кадра при повороте/отъезде — зеркально (как в After Effects), без полос по краям ---
vec2 mr(vec2 q) { return 1.0 - abs(1.0 - mod(q, 2.0)); }
vec4 atm(sampler2D t, vec2 q) { return texture(t, mr(q)); }
// размытие вращением: кадр, повёрнутый на ang, смазанный по дуге spread; z > 1 — чуть ближе
vec4 rotBlur(sampler2D t, vec2 c, float asp, float ang, float spread, float z) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) acc += atm(t, rot2(ang + spread * (float(i) / 11.0 - 0.5)) * c / z / vec2(asp, 1.0) + 0.5);
  return acc / 12.0;
}
// зум с радиальным смазом: z — во сколько раз ближе, amt — длина смаза
vec4 zoomBlur(sampler2D t, vec2 q, float z, float amt) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 14; i++) acc += atm(t, 0.5 + (q - 0.5) / (z * (1.0 + amt * float(i) / 13.0)));
  return acc / 14.0;
}
// плотный смаз по направлению (24 отсчёта, со сдвигом по шуму — без ступенек на длинном смазе)
vec4 dirBlurHQ(sampler2D t, vec2 q, vec2 d) {
  vec4 c0 = vec4(0.0);
  float j = hash(q * 913.7) - 0.5;
  for (int i = 0; i < 24; i++) c0 += at(t, q + d * ((float(i) + j) / 23.0 - 0.5) * 2.0);
  return c0 / 24.0;
}
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// фигуры для семейства «фигура раскрывается»: < 0 — внутри; r — «радиус»
float shapeSd(int sh, vec2 q, float r) {
  if (sh == 0) return length(q) - r;                                                   // круг
  if (sh == 1) return (abs(q.x) + abs(q.y)) / 1.41 - r;                                // ромб
  if (sh == 2) return star5(vec2(q.x, -q.y), r * 1.3, 0.45);                           // звезда
  if (sh == 3) { vec2 hq = q / max(r, 1e-4) * 1.1; hq.y = -hq.y + 0.25;                // сердце
    return (pow(hq.x * hq.x + hq.y * hq.y - 1.0, 3.0) - hq.x * hq.x * hq.y * hq.y * hq.y) * r; }
  if (sh == 4) { vec2 a2 = abs(q); return max(a2.x * 0.866 + a2.y * 0.5, a2.y) - r; } // шестиугольник
  if (sh == 5) { vec2 a2 = abs(q); return min(max(a2.x - r * 0.38, a2.y - r * 1.3), max(a2.y - r * 0.38, a2.x - r * 1.3)); } // крест
  if (sh == 6) { vec2 t = vec2(abs(q.x), -q.y); return max(t.x * 0.866 + t.y * 0.5, -t.y) - r * 0.6; } // треугольник
  if (sh == 7) return max(abs(q.x), abs(q.y)) - r;                                     // квадрат
  return abs(length(q) - r * 0.7) - r * 0.45;                                          // кольцо
}
// семейства с параметрами tp: десятки вариантов из одного кода
vec4 familyTrans(int k, float asp, vec2 c, float e, float s) {
  if (k == 61) {                                                                        // шторка под углом tp.x, мягкость tp.y
    vec2 d = vec2(cos(tp.x), sin(tp.x));
    float v = dot(c, d) / (0.5 * (asp * abs(d.x) + abs(d.y))) * 0.5 + 0.5;
    return mix(at(A, uv), at(B, uv), wipe(v, e, max(0.01, tp.y)));
  }
  if (k == 62) {                                                                        // фигура tp.x растёт из центра, вращение tp.y
    vec2 q = rot2(tp.y * (1.0 - e)) * c;
    float sd = shapeSd(int(tp.x + 0.5), q, e * (tp.z > 0.0 ? tp.z : 0.65)); // tp.z — «радиус», при котором фигура закрывает кадр
    return p > 0.97 ? at(B, uv) : mix(at(B, uv), at(A, uv), smoothstep(-0.004, 0.004, sd));
  }
  if (k == 63) {                                                                        // сдвиг по направлению tp.x, смаз tp.y, отскок tp.z
    vec2 d = vec2(cos(tp.x), sin(tp.x));
    float e2 = tp.z > 0.0 ? e + 0.12 * sin(3.14159 * clamp((p - 0.55) / 0.45, 0.0, 1.0)) : e; // отскок — в конце
    vec2 qa = uv - d * e2, qb = uv - d * (e2 - 1.0);
    bool inB = qb.x >= 0.0 && qb.x <= 1.0 && qb.y >= 0.0 && qb.y <= 1.0;
    vec2 bd = d * s * tp.y;
    return inB ? (tp.y > 0.0 ? dirBlurHQ(B, qb, bd) : at(B, qb)) : (tp.y > 0.0 ? dirBlurHQ(A, mr(qa), bd) : at(A, mr(qa)));
  }
  if (k == 64) {                                                                        // зум tp.x (+ ближе, − дальше), вращение tp.y, смаз tp.z
    float kk = p < 0.5 ? ease(p * 2.0) : 1.0 - ease(p * 2.0 - 1.0);
    float z = tp.x > 0.0 ? 1.0 + tp.x * kk * kk : 1.0 / (1.0 - tp.x * kk * kk);
    float ang = tp.y * (p < 0.5 ? kk : -kk);
    vec2 q = rot2(ang) * c / z / vec2(asp, 1.0) + 0.5;
    return tp.z > 0.0 ? (p < 0.5 ? zoomBlur(A, q, 1.0, tp.z * kk) : zoomBlur(B, q, 1.0, tp.z * kk)) : (p < 0.5 ? atm(A, q) : atm(B, q));
  }
  if (k == 65) {                                                                        // жалюзи: полос tp.x, угол tp.y, волна tp.z
    vec2 d = vec2(cos(tp.y), sin(tp.y));
    float v = dot(uv - 0.5, d) + 0.5;
    float i = floor(v * tp.x), f = fract(v * tp.x);
    float kk = clamp(p * (1.0 + tp.z) - tp.z * i / tp.x, 0.0, 1.0);
    return f < ease(kk) ? at(B, uv) : at(A, uv);
  }
  if (k == 66) {                                                                        // мозаика: клеток tp.x, порядок tp.y (0 случайно, 1 по диагонали, 2 из центра)
    vec2 cell = floor(uv * vec2(tp.x, tp.x / asp));
    vec2 cn = (cell + 0.5) / vec2(tp.x, tp.x / asp);
    float t0 = tp.y < 0.5 ? hash(cell) : tp.y < 1.5 ? (cn.x + cn.y) * 0.5 : length((cn - 0.5) * vec2(asp, 1.0)) / (0.5 * sqrt(asp * asp + 1.0));
    float m = smoothstep(t0, t0 + 0.12, p * 1.12);
    return mix(at(A, uv), at(B, uv), m);
  }
  if (k == 67) {                                                                        // панели разъезжаются: панелей tp.x, поперёк tp.y
    bool horiz = tp.y > 0.5;
    float v = horiz ? uv.y : uv.x;
    float i = floor(v * tp.x);
    float dv = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
    float kk = ease(clamp((p - i / tp.x * 0.3) / 0.7, 0.0, 1.0));
    vec2 sh = horiz ? vec2(dv, 0.0) : vec2(0.0, dv);
    vec2 qa = uv + sh * kk, qb = uv + sh * (kk - 1.0);
    bool inB = horiz ? (qb.x >= 0.0 && qb.x <= 1.0) : (qb.y >= 0.0 && qb.y <= 1.0);
    return inB ? at(B, qb) : at(A, qa);
  }
  if (k == 68) {                                                                        // через цвет tp.xyz
    vec4 col = vec4(tp.xyz, 1.0);
    return p < 0.5 ? mix(at(A, uv), col, ease(p * 2.0)) : mix(col, at(B, uv), ease(p * 2.0 - 1.0));
  }
  if (k == 69) {                                                                        // глитч: режим tp.x
    float tt = floor(p * 24.0);
    vec4 base = p < 0.5 ? at(A, uv) : at(B, uv);
    if (tp.x < 0.5) {                                                                   // блоки меняются местами
      vec2 blk = floor(uv * vec2(8.0, 14.0));
      float r = hash(blk + tt);
      vec2 q = uv + (vec2(hash(blk + tt + 3.0), hash(blk + tt + 7.0)) - 0.5) * 0.12 * s * step(0.6, r);
      return (r < p ? at(B, q) : at(A, q));
    }
    if (tp.x < 1.5) {                                                                   // строки сдвигаются
      float row = floor(uv.y * 90.0);
      vec2 q = uv + vec2((hash(vec2(row, tt)) - 0.5) * 0.25 * s, 0.0);
      return p < 0.5 ? at(A, q) : at(B, q);
    }
    if (tp.x < 2.5) {                                                                   // сильный RGB с дрожью
      vec2 off = vec2(0.03 + 0.03 * hash(vec2(tt, 1.0)), 0.01) * s;
      vec4 r0 = p < 0.5 ? at(A, uv + off) : at(B, uv + off), b0 = p < 0.5 ? at(A, uv - off) : at(B, uv - off);
      return vec4(r0.r, base.g, b0.b, 1.0);
    }
    if (tp.x < 3.5) {                                                                   // цифровой шум
      float n = hash(floor(uv * res / 4.0) + tt);
      return mix(base, vec4(vec3(n), 1.0), s * 0.8 * step(0.5, hash(floor(uv * vec2(6.0, 30.0)) + tt)));
    }
    float col = floor(uv.x * 20.0);                                                     // вертикальный разрыв
    vec2 q = uv + vec2(0.0, (hash(vec2(col, tt)) - 0.5) * 0.3 * s);
    return p < 0.5 ? at(A, q) : at(B, q);
  }
  if (k == 70) {                                                                        // искажение: режим tp.x
    vec2 q = uv;
    if (tp.x < 0.5) q.x += sin(uv.y * 25.0 + p * 20.0) * 0.04 * s;                      // волна
    else if (tp.x < 1.5) { float ang = s * 8.0 * max(0.0, 1.0 - length(c) / 0.8); q = rot2(ang) * c / vec2(asp, 1.0) + 0.5; } // смерч
    else if (tp.x < 2.5) { vec2 cc = c * (1.0 - s * 0.6 * (1.0 - smoothstep(0.0, 0.7, length(c)))); q = cc / vec2(asp, 1.0) + 0.5; } // выпуклость
    else if (tp.x < 3.5) { vec2 cc = c * (1.0 + s * 0.9 * (1.0 - smoothstep(0.0, 0.7, length(c)))); q = cc / vec2(asp, 1.0) + 0.5; } // втягивание
    else q.y -= s * 0.35 * hash(vec2(floor(uv.x * 60.0), 1.0)) * smoothstep(0.0, 1.0, uv.y);   // стекает вниз
    return mix(atm(A, q), atm(B, q), smoothstep(0.4, 0.6, p));
  }
  if (k == 72) {                                                                        // свет: цвет tp.xyz, режим tp.w (0 вспышка, 1 плёнка горит, 2 блик)
    vec4 base = mix(at(A, uv), at(B, uv), smoothstep(0.4, 0.6, p));
    if (tp.w < 0.5) return mix(base, vec4(tp.xyz, 1.0), pow(s, 1.5));
    if (tp.w < 1.5) { float g = s * (1.4 - length(uv - vec2(1.1 - p * 1.2, 0.5 + 0.3 * sin(p * 6.0))) * 1.3);
      vec3 burn = clamp(tp.xyz * g * 2.2, 0.0, 1.0); return vec4(1.0 - (1.0 - base.rgb) * (1.0 - burn), 1.0); }
    float g = exp(-length(c) * 3.0) * s * 2.0;
    return vec4(base.rgb + tp.xyz * g, 1.0);
  }
  if (k == 73) {                                                                        // смаз по направлению tp.x
    vec2 d = vec2(cos(tp.x), sin(tp.x)) * 0.12 * s;
    return mix(dirBlurHQ(A, uv, d), dirBlurHQ(B, uv, d), e);
  }
  if (k == 74) {                                                                        // растяжение по оси tp.x (0 — ширина, 1 — высота)
    float z = 1.0 + 3.0 * s * s;
    vec2 q = 0.5 + (uv - 0.5) / (tp.x < 0.5 ? vec2(z, 1.0) : vec2(1.0, z));
    vec2 bd = (tp.x < 0.5 ? vec2(0.06, 0.0) : vec2(0.0, 0.06)) * s;
    return p < 0.5 ? dirBlur(A, q, bd) : dirBlur(B, q, bd);
  }
  return mix(at(A, uv), at(B, uv), e);
}
void main() {
  float e = ease(p);
  float asp = res.x / res.y;
  vec2 c = (uv - 0.5) * vec2(asp, 1.0);
  float s = sin(p * 3.14159);
  vec4 a, b;
  if (kind >= 61) { o = familyTrans(kind, asp, c, e, s); return; }
  if (kind >= 45 && kind <= 47) { o = windowTrans(kind - 45, asp, c); return; }   // карточка, круг, звезда
  if (kind == 49) {                                                                   // поворот со смазом: камера «крутится» через склейку
    float ang = p < 0.5 ? 1.9 * pow(p * 2.0, 2.0) : -1.9 * pow(2.0 - p * 2.0, 2.0);
    float sp = 0.7 * s, z = 1.0 + 0.3 * s;
    o = p < 0.5 ? rotBlur(A, c, asp, ang, sp, z) : rotBlur(B, c, asp, ang, sp, z); return;
  }
  if (kind == 50) {                                                                   // вспышка-взрыв: наезд в темноту → белый кадр → из пересвета с отъездом
    if (p < 0.38) { float k = p / 0.38; vec4 ca = zoomBlur(A, uv, 1.0 + 0.35 * k * k, 0.3 * k); o = vec4(ca.rgb * (1.0 - 0.55 * k * k), 1.0); return; } // темнеет до ~45%, не в чёрное
    float k = clamp((p - 0.38) / 0.62, 0.0, 1.0);
    vec4 cb = zoomBlur(B, uv, 1.4 - 0.4 * ease(k), 0.35 * (1.0 - k));
    float wh = p < 0.45 ? 1.0 : pow(1.0 - (p - 0.45) / 0.55, 2.2);
    o = vec4(mix(min(cb.rgb * (1.0 + 0.9 * (1.0 - k)), 1.0), vec3(1.0), wh), 1.0); return;
  }
  if (kind == 51) {                                                                   // зум-рывок: влёт в кадр со смазом и цветным расслоением
    float k = p < 0.5 ? ease(p * 2.0) : 1.0 - ease(p * 2.0 - 1.0);
    float z = 1.0 + 1.8 * k * k, bl = 0.55 * k;
    vec2 ab = (uv - 0.5) * 0.04 * k;
    vec4 r, g, bb;
    if (p < 0.5) { r = zoomBlur(A, uv + ab, z, bl); g = zoomBlur(A, uv, z, bl); bb = zoomBlur(A, uv - ab, z, bl); }
    else { r = zoomBlur(B, uv + ab, z, bl); g = zoomBlur(B, uv, z, bl); bb = zoomBlur(B, uv - ab, z, bl); }
    o = vec4(r.r, g.g, bb.b, 1.0); return;
  }
  if (kind == 52 || kind == 53) {                                                     // свайп со смазом (резче «рывка»), новый кадр доезжает наездом
    vec2 d = kind == 52 ? vec2(-1.0, 0.0) : vec2(1.0, 0.0);
    float e2 = ease(p), bl = s * 0.28;
    vec2 qa = uv - d * e2, qb = uv - d * (e2 - 1.0);
    bool inB = qb.x >= 0.0 && qb.x <= 1.0;
    float zb = 1.0 + 0.15 * (1.0 - e2);
    o = inB ? dirBlurHQ(B, 0.5 + (qb - 0.5) / zb, d * bl) : dirBlurHQ(A, qa, d * bl); return;
  }
  if (kind == 54) {                                                                   // зеркальный разлом: кадр размножается зеркально и тянется
    float m = s;
    vec2 q = mr((uv - 0.5) * vec2(1.0 + 2.2 * m, 1.0 + 1.2 * m) + 0.5);
    vec2 bd = vec2(0.09 * m, 0.0);
    o = p < 0.5 ? dirBlur(A, q, bd) : dirBlur(B, q, bd); return;
  }
  if (kind == 55) {                                                                   // ирис: кадр сжимается в круг на чёрном, новый выезжает наездом
    // вокруг круга — не чёрное, а размытый следующий кадр: переход не «проваливается» в темноту
    vec4 behind = zoomBlur(B, uv, 1.3, 0.25);
    behind = vec4(behind.rgb * 0.55, 1.0);
    if (p < 0.55) {
      float r = (1.0 - ease(p / 0.55)) * 0.5 * sqrt(asp * asp + 1.0);
      float m = smoothstep(r, r - 0.01, length(c));
      o = mix(behind, at(A, uv), m); return;
    }
    float k = ease((p - 0.55) / 0.45);
    vec4 cb = zoomBlur(B, uv, 1.3 - 0.3 * k, 0.25 * (1.0 - k));
    o = vec4(cb.rgb * (0.55 + 0.45 * k), 1.0); return;
  }
  if (kind == 56) {                                                                   // тряска-склейка: толчки камеры со смазом вокруг склейки
    float k = exp(-abs(p - 0.5) * 7.0), tt = floor(p * 30.0);
    vec2 sh = (vec2(hash(vec2(tt, 1.0)), hash(vec2(tt, 2.0))) - 0.5) * 0.14 * k;
    vec2 q = 0.5 + (uv - 0.5 + sh) / (1.0 + 0.25 * k);
    o = p < 0.5 ? dirBlur(A, q, sh * 1.6) : dirBlur(B, q, sh * 1.6);
    o = mix(o, vec4(1.0), exp(-abs(p - 0.5) * 30.0) * 0.5); return;
  }
  if (kind == 57) {                                                                   // по яркости: сначала проступают светлые места нового кадра
    vec4 ta = at(A, uv), tb = at(B, uv);
    float l = dot(tb.rgb, vec3(0.299, 0.587, 0.114));
    float th = 1.0 - e * 1.3;
    o = mix(ta, tb, smoothstep(th, th + 0.25, l)); return;
  }
  if (kind == 58) {                                                                   // мягкий наезд: растворение с лёгким движением камеры
    vec2 qa = 0.5 + (uv - 0.5) / (1.0 + 0.08 * e), qb = 0.5 + (uv - 0.5) / (1.08 - 0.08 * e);
    o = mix(at(A, qa), at(B, qb), smoothstep(0.15, 0.85, p)); return;
  }
  if (kind == 59) {                                                                   // сжатие: кадр схлопывается в полоску, новый раскрывается
    float w = p < 0.5 ? 1.0 - ease(p * 2.0) : ease(p * 2.0 - 1.0);
    float qx = 0.5 + (uv.x - 0.5) / max(w, 0.001);
    if (qx < 0.0 || qx > 1.0) { vec4 bg = p < 0.5 ? zoomBlur(B, uv, 1.2, 0.3) : zoomBlur(A, uv, 1.2, 0.3); o = vec4(bg.rgb * 0.5, 1.0); return; }
    vec2 bd = vec2(0.12 * (1.0 - w), 0.0);
    o = p < 0.5 ? dirBlur(A, vec2(qx, uv.y), bd) : dirBlur(B, vec2(qx, uv.y), bd); return;
  }
  if (kind == 60) {                                                                   // чернила: неровная граница расползается слева направо
    vec2 nq = uv * vec2(asp, 1.0);
    float n = 0.6 * vnoise(nq * 4.0) + 0.3 * vnoise(nq * 9.0) + 0.1 * vnoise(nq * 21.0);
    o = mix(at(A, uv), at(B, uv), wipe(uv.x * 0.65 + n * 0.35, e, 0.02)); return;
  }
  if (kind == 48) {                                                                   // улёт карточкой: A уменьшается и улетает, B прилетает
    float k = p < 0.5 ? ease(p * 2.0) : 1.0 - ease(p * 2.0 - 1.0);
    float sc = 1.0 - 0.78 * k, ang = (p < 0.5 ? 0.6 : -0.6) * k;
    vec2 l = rot2(-ang) * (c - vec2(0.0, (p < 0.5 ? -0.25 : 0.25) * k)) / sc;
    vec2 q = l / vec2(asp, 1.0) + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
      // фон — размытый другой клип, а не чёрный
      vec4 bg = p < 0.5 ? zoomBlur(B, uv, 1.2, 0.3) : zoomBlur(A, uv, 1.2, 0.3);
      o = vec4(bg.rgb * 0.5, 1.0); return;
    }
    vec2 bd = (q - 0.5) * 0.08 * s;
    o = p < 0.5 ? dirBlur(A, q, bd) : dirBlur(B, q, bd); return;
  }
  if (kind == 16) { float n = hash(floor(uv * res / 8.0)); o = mix(at(A, uv), at(B, uv), wipe(n, e, 0.08)); return; }   // рассыпание
  if (kind == 17 || kind == 18) {                                                     // рывок вверх / вниз
    vec2 d = kind == 17 ? vec2(0, -1) : vec2(0, 1);
    vec2 qa = uv - d * e, qb = uv - d * (e - 1.0);
    bool inB = all(greaterThanEqual(qb, vec2(0.0))) && all(lessThanEqual(qb, vec2(1.0)));
    o = inB ? dirBlur(B, qb, d * s * 0.18) : dirBlur(A, qa, d * s * 0.18); return;
  }
  if (kind == 19) {                                                                   // зум с вращением
    float ang = (p < 0.5 ? e : e - 1.0) * 1.6;
    vec2 cc = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c / (1.0 + s * 1.4);
    vec2 q = cc / vec2(asp, 1.0) + 0.5;
    vec2 bd = (q - 0.5) * 0.12 * s;
    o = p < 0.5 ? dirBlur(A, q, bd) : dirBlur(B, q, bd); return;
  }
  if (kind == 20) {                                                                   // отскок: влёт в A, вылет из B с пружиной
    if (p < 0.5) { float k = p * 2.0; vec2 q = 0.5 + (uv - 0.5) / (1.0 + k * k * 2.5); o = dirBlur(A, q, (q - 0.5) * 0.1 * k); }
    else { float k = (p - 0.5) * 2.0; float z = 1.0 + (1.0 - k) * (1.0 - k) * 2.5 - sin(k * 3.14159) * 0.1; vec2 q = 0.5 + (uv - 0.5) / z; o = dirBlur(B, q, (q - 0.5) * 0.1 * (1.0 - k)); }
    return;
  }
  if (kind == 21) {                                                                   // растяжение
    vec2 q = vec2(0.5 + (uv.x - 0.5) / (1.0 + s * 5.0), 0.5 + (uv.y - 0.5) * (1.0 + s * 0.15));
    o = mix(p < 0.5 ? at(A, q) : at(B, q), vec4(1.0), s * s * 0.35); return;
  }
  if (kind >= 22 && kind <= 26) {                                                     // шторки: влево, вправо, вверх, вниз, по диагонали
    float v = kind == 22 ? 1.0 - uv.x : kind == 23 ? uv.x : kind == 24 ? 1.0 - uv.y : kind == 25 ? uv.y : (uv.x + 1.0 - uv.y) * 0.5;
    o = mix(at(A, uv), at(B, uv), wipe(v, e, 0.04)); return;
  }
  if (kind == 27) { float v = (abs(c.x) + abs(c.y)) / (0.5 * asp + 0.5); o = mix(at(A, uv), at(B, uv), wipe(v, e, 0.05)); return; } // ромб
  if (kind == 28) { o = mix(at(A, uv), at(B, uv), wipe(fract(uv.y * 8.0), e, 0.05)); return; }                                   // жалюзи
  if (kind == 29) {                                                                   // двери: A разъезжается из центра
    float sh = e * 0.5;
    vec2 qa = uv.x < 0.5 ? uv + vec2(sh, 0.0) : uv - vec2(sh, 0.0);
    bool inA = uv.x < 0.5 ? qa.x < 0.5 : qa.x > 0.5;
    vec4 bb = at(B, 0.5 + (uv - 0.5) / (0.8 + 0.2 * e));
    o = inA ? at(A, qa) : vec4(bb.rgb * (0.6 + 0.4 * e), 1.0); return;
  }
  if (kind == 30) {                                                                   // сердце
    vec2 hq = c / (p * p * 1.5 + 0.0001) * 1.25; hq.y = -hq.y + 0.25;  // растёт плавно: сердце видно большую часть перехода
    float f = pow(hq.x * hq.x + hq.y * hq.y - 1.0, 3.0) - hq.x * hq.x * hq.y * hq.y * hq.y;
    o = (f < 0.0 || p > 0.97) ? at(B, uv) : at(A, uv); return;
  }
  if (kind == 31) {                                                                   // зум-блюр
    vec2 qa = 0.5 + (uv - 0.5) / (1.0 + e * 0.6), qb = 0.5 + (uv - 0.5) / (1.6 - e * 0.6);
    vec4 ca = vec4(0.0), cb = vec4(0.0);
    for (int i = 0; i < 16; i++) { float k = 1.0 - float(i) * 0.02 * s; ca += at(A, 0.5 + (qa - 0.5) * k); cb += at(B, 0.5 + (qb - 0.5) * k); }
    o = mix(ca / 16.0, cb / 16.0, smoothstep(0.4, 0.6, p)); return;
  }
  if (kind == 32) {                                                                   // пиксели
    vec2 bl = mix(res, vec2(10.0, 10.0 / asp), pow(s, 0.6));
    vec2 q = (floor(uv * bl) + 0.5) / bl;
    o = p < 0.5 ? at(A, q) : at(B, q); return;
  }
  if (kind == 33) {                                                                   // RGB-разлом
    vec2 off = vec2(0.05, 0.012) * s;
    float m = smoothstep(0.45, 0.55, p);
    vec2 q = 0.5 + (uv - 0.5) / (1.0 + 0.15 * s);
    vec4 r = mix(at(A, q + off), at(B, q + off), m), g = mix(at(A, q), at(B, q), m), bl = mix(at(A, q - off), at(B, q - off), m);
    o = vec4(r.r, g.g, bl.b, 1.0); return;
  }
  if (kind == 34) {                                                                   // рябь
    float d = length(c);
    vec2 dir = d > 0.0 ? c / d : vec2(0.0);
    vec2 q = uv + dir * sin(d * 45.0 - p * 30.0) * 0.025 * s / vec2(asp, 1.0);
    o = mix(at(A, q), at(B, q), smoothstep(0.3, 0.7, p)); return;
  }
  if (kind == 35) {                                                                   // водоворот
    float ang = s * 5.0 * max(0.0, 1.0 - length(c) / 0.9);
    vec2 q = (mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c) / vec2(asp, 1.0) + 0.5;
    o = mix(at(A, q), at(B, q), smoothstep(0.4, 0.6, p)); return;
  }
  if (kind == 36) {                                                                   // засвет плёнки
    vec4 base = mix(at(A, uv), at(B, uv), smoothstep(0.35, 0.65, p));
    float g = s * (1.2 - length(uv - vec2(0.1 + p * 0.8, 0.3)) * 1.1);
    vec3 leak = clamp(vec3(1.0, 0.55, 0.18) * g * 1.6 + vec3(1.0, 0.9, 0.7) * pow(max(g, 0.0), 3.0), 0.0, 1.0);
    o = vec4(1.0 - (1.0 - base.rgb) * (1.0 - leak), 1.0); return;
  }
  if (kind == 37) {                                                                   // удар: склейка с толчком, зумом и вспышкой
    float k = exp(-abs(p - 0.5) * 9.0);
    float t = floor(p * 40.0);
    vec2 sh = (vec2(hash(vec2(t, 1.0)), hash(vec2(t, 7.0))) - 0.5) * 0.07 * k;
    vec2 q = 0.5 + (uv - 0.5 + sh) / (1.0 + 0.3 * k);
    o = mix(p < 0.5 ? at(A, q) : at(B, q), vec4(1.0), exp(-abs(p - 0.5) * 25.0) * 0.85); return;
  }
  if (kind == 38) {                                                                   // куб
    vec2 u2 = 0.5 + (uv - 0.5) / (1.0 - 0.18 * s);
    if (u2.x < 0.0 || u2.x > 1.0 || u2.y < 0.0 || u2.y > 1.0) { o = BLACK; return; }
    float bnd = 1.0 - e;
    if (u2.x < bnd) {
      float ux = u2.x / max(bnd, 1e-4), y = 0.5 + (u2.y - 0.5) / (1.0 - 0.22 * e * (1.0 - ux));
      o = (y < 0.0 || y > 1.0) ? BLACK : vec4(at(A, vec2(ux, y)).rgb * (1.0 - 0.5 * e), 1.0);
    } else {
      float ux = (u2.x - bnd) / max(1.0 - bnd, 1e-4), y = 0.5 + (u2.y - 0.5) / (1.0 - 0.22 * (1.0 - e) * ux);
      o = (y < 0.0 || y > 1.0) ? BLACK : vec4(at(B, vec2(ux, y)).rgb * (0.5 + 0.5 * e), 1.0);
    }
    return;
  }
  if (kind == 39) {                                                                   // переворот карточкой
    float sx = abs(cos(p * 3.14159));
    float qx = 0.5 + (uv.x - 0.5) / max(sx, 1e-3);
    float y = 0.5 + (uv.y - 0.5) / (1.0 - 0.15 * (1.0 - sx) * (uv.x - 0.5) * (p < 0.5 ? 2.0 : -2.0));
    if (qx < 0.0 || qx > 1.0 || y < 0.0 || y > 1.0) { o = BLACK; return; }
    o = vec4((p < 0.5 ? at(A, vec2(qx, y)) : at(B, vec2(qx, y))).rgb * (0.55 + 0.45 * sx), 1.0); return;
  }
  if (kind == 40) { o = abs(uv.y - 0.5) > 0.5 - 0.52 * s ? BLACK : (p < 0.5 ? at(A, uv) : at(B, uv)); return; }   // кино-шторки
  if (kind == 41) { o = p < 0.5 ? mix(at(A, uv), vec4(1.0), p * 2.0) : mix(vec4(1.0), at(B, uv), p * 2.0 - 1.0); return; } // через белый
  if (kind == 42) {                                                                   // двойная экспозиция
    vec4 ta = at(A, uv), tb = at(B, uv);
    vec3 scr = 1.0 - (1.0 - ta.rgb) * (1.0 - tb.rgb);
    o = vec4(mix(mix(ta.rgb, tb.rgb, e), scr, s * 0.7), 1.0); return;
  }
  if (kind == 43) {                                                                   // затвор (диафрагма)
    float r = abs(p * 2.0 - 1.0) * 0.5 * sqrt(asp * asp + 1.0);
    o = length(c) < r ? (p < 0.5 ? at(A, uv) : at(B, uv)) : BLACK; return;
  }
  if (kind == 44) {                                                                   // полосы разъезжаются вверх-вниз
    float i = floor(uv.x * 6.0);
    float dv = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
    float k = ease(clamp((p - i / 6.0 * 0.3) / 0.7, 0.0, 1.0));
    vec2 qa = uv + vec2(0.0, dv * k), qb = uv + vec2(0.0, dv * (k - 1.0));
    o = (qb.y >= 0.0 && qb.y <= 1.0) ? at(B, qb) : at(A, qa); return;
  }
  if (kind == 1) { o = mix(at(A, uv), at(B, uv), e); return; }                       // растворение
  if (kind == 2) { o = p < 0.5 ? mix(at(A, uv), vec4(0,0,0,1), p * 2.0) : mix(vec4(0,0,0,1), at(B, uv), p * 2.0 - 1.0); return; }  // через чёрный
  if (kind == 3) { float f = 1.0 - abs(p * 2.0 - 1.0); vec4 base = p < 0.5 ? at(A, uv) : at(B, uv); o = mix(base, vec4(1.0), f * f); return; } // вспышка
  if (kind == 4) {                                                                    // приближение
    vec2 qa = 0.5 + (uv - 0.5) / (1.0 + e * 1.2);
    vec2 qb = 0.5 + (uv - 0.5) / (0.6 + e * 0.4);
    a = dirBlur(A, qa, (qa - 0.5) * 0.08 * e); b = dirBlur(B, qb, (qb - 0.5) * 0.08 * (1.0 - e));
    o = mix(a, b, smoothstep(0.35, 0.65, p)); return;
  }
  if (kind == 5) {                                                                    // отдаление
    vec2 qa = 0.5 + (uv - 0.5) * (1.0 + e * 0.6);
    vec2 qb = 0.5 + (uv - 0.5) * (1.6 - e * 0.6);
    o = mix(at(A, qa), at(B, qb), smoothstep(0.3, 0.7, p)); return;
  }
  if (kind >= 6 && kind <= 9) {                                                       // сдвиг (толкание)
    vec2 d = kind == 6 ? vec2(-1, 0) : kind == 7 ? vec2(1, 0) : kind == 8 ? vec2(0, -1) : vec2(0, 1);
    vec2 qa = uv - d * e, qb = uv - d * (e - 1.0);
    bool inB = all(greaterThanEqual(qb, vec2(0.0))) && all(lessThanEqual(qb, vec2(1.0)));
    o = inB ? at(B, qb) : at(A, qa); return;
  }
  if (kind == 10 || kind == 11) {                                                     // рывок (свайп с размытием)
    vec2 d = kind == 10 ? vec2(-1, 0) : vec2(1, 0);
    float blur = sin(p * 3.14159) * 0.18;
    vec2 qa = uv - d * e, qb = uv - d * (e - 1.0);
    bool inB = all(greaterThanEqual(qb, vec2(0.0))) && all(lessThanEqual(qb, vec2(1.0)));
    o = inB ? dirBlur(B, qb, d * blur) : dirBlur(A, qa, d * blur); return;
  }
  if (kind == 12) {                                                                   // вращение
    float ang = e * 6.28318;
    float s = 1.0 + sin(p * 3.14159) * 0.8;
    vec2 c = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c * s;
    vec2 q = c / vec2(res.x / res.y, 1.0) + 0.5;
    o = p < 0.5 ? at(A, q) : at(B, q); return;
  }
  if (kind == 13) {                                                                   // глитч
    float f = sin(p * 3.14159);
    float band = floor(uv.y * 30.0);
    float r = hash(vec2(band, floor(p * 18.0)));
    vec2 q = uv + vec2((r - 0.5) * 0.3 * f * step(0.45, r), 0.0);
    vec2 off = vec2(0.02 * f, 0.0);
    vec4 src0 = p < 0.5 ? at(A, q - off) : at(B, q - off);
    vec4 src1 = p < 0.5 ? at(A, q) : at(B, q);
    vec4 src2 = p < 0.5 ? at(A, q + off) : at(B, q + off);
    o = vec4(src0.r, src1.g, src2.b, 1.0); return;
  }
  if (kind == 14) {                                                                   // размытие
    float f = sin(p * 3.14159) * 0.025;
    vec4 ca = vec4(0.0), cb = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float an = float(i) * 0.5236;
      vec2 off = vec2(cos(an), sin(an)) * f * vec2(res.y / res.x, 1.0);
      ca += at(A, uv + off); cb += at(B, uv + off);
    }
    o = mix(ca / 12.0, cb / 12.0, e); return;
  }
  if (kind == 15) {                                                                   // круг
    vec2 c = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    float r = e * 1.2;
    o = length(c) < r ? at(B, uv) : at(A, uv); return;
  }
  o = p < 0.5 ? at(A, uv) : at(B, uv);
}`;

// Пост-обработка всего кадра: трансформация (тряска/зум) + эффекты.
export const FS_POST = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D tex;
uniform mat3 uvM;
uniform vec2 res;
uniform vec2 frame; // размер кадра проекта (1080×1920): эффекты считаются в его пикселях — превью = экспорт
uniform float time;
uniform float flash, black, blurA, glitch, rgb, vhs, bw, invert, pixel, vign, grain, wave, sepia;
uniform float tint, mirror, kaleido, fish, rblur, glow, crt, bars, poster, split, leak, edges, ghost, tear, mblur, pstretch;
uniform vec3 tintC;
uniform vec2 mdir; // размытие движения: смещение кадра за 1/30 с (доли кадра)
// семейства эффектов: деформация, сетка, цветокоррекция (матрица), растр, строки, тилт-шифт, рамки, частицы
uniform float wtype, wamt, gridn, halft, scan, tilt, cgk, ftype, famt;
uniform mat3 cgm;
uniform vec3 cga;
uniform float pamt, pshape, psize, pdens, psway, pglow, prain;
uniform vec2 pvel;
uniform vec3 pcol;
out vec4 o;
float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 at(vec2 q) { return texture(tex, clamp(q, 0.0, 1.0)).rgb; }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
mat2 rot2(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// частицы: 3 слоя глубины; форма pshape (0 точка, 1 штрих, 2 конфетти, 3 пузырь, 4 сердце, 5 искра-звёздочка)
vec4 particles(vec2 uv0, float asp) {
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  vec2 pp = vec2(uv0.x * asp, uv0.y);
  for (int L = 0; L < 3; L++) {
    float fl = float(L), sc = 1.0 - fl * 0.25;
    float n = 5.0 + fl * 4.0;
    vec2 g = (pp - pvel * time * sc) * n;
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h1 = hash(id + fl * 13.1), h2 = hash(id + fl * 7.7 + 3.1), h3 = hash(id + fl * 2.3 + 9.4);
    if (h3 > pdens) continue;
    vec2 off = (vec2(h1, h2) - 0.5) * 0.6 + vec2(sin(time * (1.0 + h1 * 2.0) + h2 * 6.28) * psway, 0.0);
    vec2 d = f - off;
    float sz = psize * (0.6 + 0.8 * h2) * sc;
    float m;
    if (pshape < 0.5) m = smoothstep(sz, sz * 0.2, length(d));
    else if (pshape < 1.5) m = smoothstep(sz * 0.25, 0.0, abs(d.x)) * smoothstep(sz * 4.0, 0.0, abs(d.y));
    else if (pshape < 2.5) { vec2 r = rot2(time * (2.0 + h1 * 3.0) + h2 * 6.0) * d; m = step(max(abs(r.x), abs(r.y) * 1.6), sz * 0.6); }
    else if (pshape < 3.5) m = smoothstep(sz * 0.18, 0.0, abs(length(d) - sz)) * 0.8;
    else if (pshape < 4.5) { vec2 hq = d / sz * 1.2; hq.y = -hq.y + 0.25; m = step(pow(dot(hq, hq) - 1.0, 3.0) - hq.x * hq.x * hq.y * hq.y * hq.y, 0.0); }
    else { float tw = 0.5 + 0.5 * sin(time * (3.0 + h1 * 5.0) + h2 * 6.28);
      m = (smoothstep(sz * 0.12, 0.0, abs(d.x)) * smoothstep(sz * 1.6, 0.0, abs(d.y)) + smoothstep(sz * 0.12, 0.0, abs(d.y)) * smoothstep(sz * 1.6, 0.0, abs(d.x)) + smoothstep(sz * 0.5, 0.0, length(d))) * tw; }
    if (pglow > 0.0) m += pglow * smoothstep(sz * 3.5, 0.0, length(d)) * 0.5;
    m = clamp(m, 0.0, 1.0) * (1.0 - fl * 0.2);
    vec3 col = prain > 0.5 ? 0.55 + 0.45 * cos(6.2831 * (h1 + vec3(0.0, 0.33, 0.67))) : pcol;
    acc = mix(acc, col, m);
    alpha = max(alpha, m);
  }
  return vec4(acc, alpha);
}
void main() {
  vec2 q = (uvM * vec3(uv, 1.0)).xy;
  float asp = frame.x / frame.y;
  if (wamt > 0.0) {                                                           // деформации: смерч, выпуклость, линза, вода, марево, желе
    vec2 cc = (q - 0.5) * vec2(asp, 1.0);
    float r = length(cc);
    if (wtype < 1.5) cc = rot2(wamt * 3.0 * max(0.0, 1.0 - r / 0.7)) * cc;
    else if (wtype < 2.5) cc *= 1.0 - wamt * 0.5 * (1.0 - smoothstep(0.0, 0.6, r));
    else if (wtype < 3.5) cc *= 1.0 + wamt * 0.6 * (1.0 - smoothstep(0.0, 0.6, r));
    else if (wtype < 4.5) cc += (r > 0.0 ? cc / r : vec2(0.0)) * sin(r * 40.0 - time * 6.0) * 0.012 * wamt;
    else if (wtype < 5.5) cc.x += (vnoise(vec2(cc.y * 14.0, time * 3.0)) - 0.5) * 0.035 * wamt;
    else { cc.x += sin(cc.y * 9.0 + time * 9.0) * 0.03 * wamt; cc.y += sin(cc.x * 7.0 + time * 7.0) * 0.015 * wamt; }
    q = cc / vec2(asp, 1.0) + 0.5;
  }
  if (gridn > 1.5) q = fract(q * gridn);                                      // сетка N×N
  if (split > 0.5) q.y = 0.3333 + fract(q.y * 3.0) * 0.3333;                 // тройной кадр: середина ×3
  if (mirror > 0.5) q.x = q.x < 0.5 ? q.x : 1.0 - q.x;                        // зеркало
  if (kaleido > 0.0) {                                                        // калейдоскоп (6 лучей, медленно крутится)
    vec2 cc = (q - 0.5) * vec2(asp, 1.0);
    float sg = 6.2831853 / 6.0;
    float an = mod(atan(cc.y, cc.x) + time * 0.4, sg);
    an = abs(an - sg * 0.5);
    vec2 kq = vec2(cos(an), sin(an)) * length(cc) / vec2(asp, 1.0) + 0.5;
    q = mix(q, kq, step(0.01, kaleido));
  }
  if (fish > 0.0) {                                                           // рыбий глаз: середина вздувается
    vec2 cc = (q - 0.5) * vec2(asp, 1.0);
    cc *= 1.0 - fish * 0.45 * (1.0 - min(dot(cc, cc) * 2.0, 1.0));
    q = cc / vec2(asp, 1.0) + 0.5;
  }
  if (wave > 0.0) q.x += sin(q.y * 18.0 + time * 7.0) * 0.012 * wave;
  if (pixel > 0.0) { vec2 blocks = mix(frame / 2.0, vec2(28.0, 50.0), pixel); q = (floor(q * blocks) + 0.5) / blocks; }
  if (glitch > 0.0) {
    float band = floor(q.y * 26.0);
    float r = hash(vec2(band, floor(time * 16.0)));
    if (r < glitch * 0.5) q.x += (hash(vec2(band, floor(time * 23.0))) - 0.5) * 0.18 * glitch;
  }
  if (pstretch > 0.0) {                                                       // растяг пикселей («баг экрана»): узкая полоса середины тянется на пол-кадра
    float hb = 0.36 * pstretch;
    if (abs(q.y - 0.5) < hb) q.y = 0.5 + (q.y - 0.5) * 0.06;
    else q.y -= sign(q.y - 0.5) * hb * 0.94;
  }
  if (tear > 0.0) {                                                           // разрыв: кадр режется на 3–5 широких полос со сдвигом
    float tt = floor(time * 10.0);
    float n = 3.0 + floor(hash(vec2(tt, 3.0)) * 3.0);
    float band = floor((q.y + hash(vec2(tt, 9.0)) * 0.3) * n);
    q.x += (hash(vec2(band, tt)) - 0.5) * 0.5 * tear;
    q.y += (hash(vec2(band, tt + 5.0)) - 0.5) * 0.04 * tear;
  }
  vec3 c;
  float sh = 0.012 * rgb + 0.01 * glitch + 0.004 * vhs;
  if (sh > 0.0) c = vec3(at(q + vec2(sh, 0.0)).r, at(q).g, at(q - vec2(sh, 0.0)).b);
  else c = at(q);
  if (blurA > 0.0) {
    vec3 acc = c;
    for (int i = 0; i < 16; i++) {
      float an = float(i) * 0.3927;
      float rr = (float(i % 4) + 1.0) / 4.0;
      acc += at(q + vec2(cos(an), sin(an)) * rr * 0.02 * blurA * vec2(res.y / res.x, 1.0));
    }
    c = acc / 17.0;
  }
  if (mblur > 0.0 && length(mdir) > 0.0005) {                                 // размытие по направлению движения кадра
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) acc += at(q + mdir * mblur * (float(i) / 11.0 - 0.5) * 2.5);
    c = acc / 12.0;
  }
  if (rblur > 0.0) {                                                          // радиальное размытие (зум-блюр)
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 14; i++) acc += at(0.5 + (q - 0.5) * (1.0 - float(i) * 0.012 * rblur));
    c = acc / 14.0;
  }
  if (ghost > 0.0) c = mix(c, c * 0.55 + at(q + vec2(0.045, 0.012) * ghost) * 0.55, ghost); // двойное изображение
  if (glow > 0.0) {                                                           // свечение ярких мест
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) { float an = float(i) * 0.5236; acc += max(at(q + vec2(cos(an) / asp, sin(an)) * 0.018) - 0.55, 0.0); }
    c += acc / 12.0 * 2.4 * glow;
  }
  if (edges > 0.0) {                                                          // неоновые контуры
    vec2 px = 1.5 / frame;
    float lx = lum(at(q + vec2(px.x, 0.0))) - lum(at(q - vec2(px.x, 0.0)));
    float ly = lum(at(q + vec2(0.0, px.y))) - lum(at(q - vec2(0.0, px.y)));
    float ed = clamp(length(vec2(lx, ly)) * 5.0, 0.0, 1.0);
    vec3 neon = 0.5 + 0.5 * cos(6.2831 * (q.y + time * 0.3 + vec3(0.0, 0.33, 0.67)));
    c = mix(c, c * 0.12 + neon * ed * 1.3, edges);
  }
  if (poster > 0.0) { float lv = mix(24.0, 3.0, poster); c = floor(c * lv + 0.5) / lv; }   // постер
  if (vhs > 0.0) {
    float line = 0.84 + 0.16 * sin(q.y * frame.y * 0.7);           // полосы ~9 px кадра
    c = mix(c, c * line, vhs);
    c += (hash(floor(q * frame / 3.0) + floor(time * 30.0)) - 0.5) * 0.14 * vhs; // «снег» ячейками 3 px
    c = mix(c, c * vec3(1.05, 0.95, 1.08), vhs);
  }
  if (tilt > 0.0) {                                                           // тилт-шифт: верх и низ размыты, как макро
    float bl = smoothstep(0.18, 0.48, abs(uv.y - 0.5)) * tilt;
    if (bl > 0.0) { vec3 acc = c; for (int i = 0; i < 12; i++) { float an = float(i) * 0.5236; acc += at(q + vec2(cos(an) / asp, sin(an)) * 0.014 * bl); } c = acc / 13.0; }
  }
  if (cgk > 0.0) c = mix(c, clamp(cgm * c + cga, 0.0, 1.0), cgk);             // цветокоррекция (готовые «луты»)
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), bw);
  c = mix(c, vec3(l) * vec3(1.07, 0.92, 0.72), sepia);
  c = mix(c, 1.0 - c, invert);
  if (halft > 0.0) {                                                          // растр (как в комиксе)
    vec2 cell = fract(uv * frame / 14.0) - 0.5;
    float rad = sqrt(max(0.0, 1.0 - lum(c))) * 0.62;
    float dm = smoothstep(rad, rad - 0.08, length(cell));
    c = mix(c, mix(vec3(1.0), c * 0.35, dm), halft);
  }
  if (scan > 0.0) c *= mix(1.0, 0.72 + 0.28 * sin(uv.y * frame.y * 1.4), scan);   // строки развёртки
  if (vign > 0.0) { vec2 d = (uv - 0.5) * vec2(1.0, res.y / res.x) * 0.9; c *= mix(1.0, smoothstep(0.85, 0.25, length(d)), vign); }
  if (grain > 0.0) c += (hash(floor(uv * frame / 2.0) + floor(time * 24.0) * 7.31) - 0.5) * 0.18 * grain;
  if (crt > 0.0) {                                                            // CRT-телевизор: строки и RGB-маска
    float sl = 0.72 + 0.28 * sin(uv.y * frame.y * 1.1);
    float mx = uv.x * frame.x * 2.1;
    vec3 mask = 1.0 + 0.14 * vec3(sin(mx), sin(mx + 2.1), sin(mx + 4.2));
    c = mix(c, c * sl * mask * 1.12, crt);
  }
  if (leak > 0.0) {                                                           // засвет: плывущее тёплое пятно
    vec2 lp = vec2(0.5 + 0.6 * sin(time * 0.7), 0.3 + 0.3 * cos(time * 0.5));
    float g = max(0.0, 1.0 - length((uv - lp) * vec2(1.0, 0.7)) * 1.4);
    vec3 lc = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.2, 0.5), 0.5 + 0.5 * sin(time * 0.9));
    c = 1.0 - (1.0 - c) * (1.0 - lc * g * g * 1.3 * leak);
  }
  if (tint > 0.0) c = mix(c, 1.0 - (1.0 - c) * (1.0 - tintC), tint);         // цветная вспышка
  if (bars > 0.0) { float bb = bars * 0.13; if (uv.y < bb || uv.y > 1.0 - bb) c = vec3(0.0); } // кино-полосы
  if (pamt > 0.0) { vec4 pt = particles(uv, asp); c = mix(c, pt.rgb, pt.a * pamt); }   // частицы
  if (famt > 0.0) {                                                           // рамки
    vec2 px = uv * frame;
    vec3 cf = c;
    if (ftype < 1.5) {                                                        // плёнка: полосы с перфорацией по краям
      float bw0 = frame.x * 0.085;
      if (px.x < bw0 || px.x > frame.x - bw0) {
        cf = vec3(0.05);
        vec2 hc = vec2(px.x < bw0 ? bw0 * 0.5 : frame.x - bw0 * 0.5, (floor(px.y / 72.0) + 0.5) * 72.0);
        if (abs(px.x - hc.x) < bw0 * 0.26 && abs(px.y - hc.y) < 17.0) cf = vec3(0.9);
      }
    } else if (ftype < 2.5) {                                                 // полароид
      float b0 = frame.x * 0.06;
      if (px.x < b0 || px.x > frame.x - b0 || px.y < b0 || px.y > frame.y - b0 * 3.2) cf = vec3(0.97, 0.96, 0.93);
    } else if (ftype < 3.5) {                                                 // скруглённая чёрная рамка
      vec2 q2 = abs(px - frame * 0.5) - (frame * 0.5 - vec2(46.0) - 90.0);
      if (length(max(q2, 0.0)) - 90.0 > 0.0) cf = vec3(0.0);
    } else if (ftype < 4.5) {                                                 // видоискатель: уголки, REC
      vec2 e2 = min(px, frame - px);
      float inset = 70.0, len = 130.0, th = 6.0;
      bool corner = (e2.x > inset && e2.x < inset + th && e2.y > inset && e2.y < inset + len) || (e2.y > inset && e2.y < inset + th && e2.x > inset && e2.x < inset + len);
      if (corner) cf = vec3(1.0);
      if (length(px - vec2(inset + 40.0, inset + 50.0)) < 16.0 && fract(time) < 0.6) cf = vec3(1.0, 0.1, 0.1);
    } else if (ftype < 5.5) {                                                 // неоновая рамка
      float ed = min(min(px.x, frame.x - px.x), min(px.y, frame.y - px.y));
      vec3 nc = 0.5 + 0.5 * cos(6.2831 * (time * 0.3 + px.y / frame.y + vec3(0.0, 0.33, 0.67)));
      cf = c + nc * exp(-ed / 26.0) * 1.3;
    } else if (ftype < 6.5) {                                                 // мечтательные края (светлая дымка)
      float vd = length((uv - 0.5) * vec2(1.0, frame.y / frame.x));
      cf = mix(c, vec3(1.0), smoothstep(0.32, 0.8, vd) * 0.85);
    } else {                                                                  // старый телевизор: скруглённый экран
      vec2 cc = (uv - 0.5) * 2.0;
      float sd = pow(pow(abs(cc.x), 6.0) + pow(abs(cc.y), 6.0), 1.0 / 6.0);
      cf = sd > 0.96 ? vec3(0.02) : c * (1.0 - 0.5 * smoothstep(0.6, 0.96, sd));
    }
    c = mix(c, cf, famt);
  }
  c = mix(c, vec3(1.0), flash);
  c = mix(c, vec3(0.0), black);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Облегчённые версии — если большой шейдер не собрался на телефоне (строгие драйверы Mali/PowerVR/старые Adreno).
// Переходы: растворение, через чёрный/белый, вспышка, сдвиги, рывки, зум; остальные — растворением.
export const FS_TRANS_LITE = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D A, B;
uniform float p;
uniform int kind;
out vec4 o;
vec4 at(sampler2D t, vec2 q) { return texture(t, clamp(q, 0.0, 1.0)); }
void main() {
  float e = p * p * (3.0 - 2.0 * p);
  if (kind == 2) { o = p < 0.5 ? mix(at(A, uv), vec4(0.0, 0.0, 0.0, 1.0), p * 2.0) : mix(vec4(0.0, 0.0, 0.0, 1.0), at(B, uv), p * 2.0 - 1.0); return; }
  if (kind == 41 || kind == 3) { vec4 w = vec4(1.0); o = p < 0.5 ? mix(at(A, uv), w, p * 2.0) : mix(w, at(B, uv), p * 2.0 - 1.0); return; }
  if ((kind >= 6 && kind <= 11) || kind == 17 || kind == 18) {
    vec2 d = (kind == 6 || kind == 10) ? vec2(-1.0, 0.0) : (kind == 7 || kind == 11) ? vec2(1.0, 0.0) : (kind == 8 || kind == 17) ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
    vec2 qa = uv - d * e, qb = uv - d * (e - 1.0);
    bool inB = qb.x >= 0.0 && qb.x <= 1.0 && qb.y >= 0.0 && qb.y <= 1.0;
    o = inB ? at(B, qb) : at(A, qa); return;
  }
  if (kind == 4 || kind == 19 || kind == 31) { vec2 qa = 0.5 + (uv - 0.5) / (1.0 + e), qb = 0.5 + (uv - 0.5) / (0.6 + e * 0.4); o = mix(at(A, qa), at(B, qb), smoothstep(0.35, 0.65, p)); return; }
  o = mix(at(A, uv), at(B, uv), e);
}`;

// Эффекты: тряска/зум (трансформация) + вспышка, затемнение, Ч/Б, сепия, негатив, виньетка, цветная вспышка, RGB.
export const FS_POST_LITE = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D tex;
uniform mat3 uvM;
uniform vec2 res;
uniform float flash, black, bw, sepia, invert, vign, rgb, glitch, tint;
uniform vec3 tintC;
out vec4 o;
vec3 at(vec2 q) { return texture(tex, clamp(q, 0.0, 1.0)).rgb; }
void main() {
  vec2 q = (uvM * vec3(uv, 1.0)).xy;
  float sh = 0.012 * rgb + 0.01 * glitch;
  vec3 c = sh > 0.0 ? vec3(at(q + vec2(sh, 0.0)).r, at(q).g, at(q - vec2(sh, 0.0)).b) : at(q);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), bw);
  c = mix(c, vec3(l) * vec3(1.07, 0.92, 0.72), sepia);
  c = mix(c, 1.0 - c, invert);
  if (vign > 0.0) { vec2 d = (uv - 0.5) * vec2(1.0, res.y / res.x) * 0.9; c *= mix(1.0, smoothstep(0.85, 0.25, length(d)), vign); }
  if (tint > 0.0) c = mix(c, 1.0 - (1.0 - c) * (1.0 - tintC), tint);
  c = mix(c, vec3(1.0), flash);
  c = mix(c, vec3(0.0), black);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Наложение (текст, обложка) с прозрачностью; текстура уже с премультиплицированной альфой.
export const FS_OVER = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D tex;
uniform float alpha;
out vec4 o;
void main() { o = texture(tex, uv) * alpha; }`;
