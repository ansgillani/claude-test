/* A Beautiful Accident — a 60-second motion-graphics short, drawn entirely in code.
 * Everything on screen is a pure function of time t (seconds), so the same code
 * drives the live player and the frame-by-frame MP4 render.
 */
(function () {
'use strict';

const W = 1920, H = 1080, DUR = 60;
const TAU = Math.PI * 2;
const T_IMP = 16.4;

/* ------------------------------------------------------------------ utils */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const EASE = {
  lin: t => t,
  io: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function tk(keys) {
  return t => {
    if (t <= keys[0][0]) return keys[0][1];
    const n = keys.length;
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    for (let i = 1; i < n; i++) {
      if (t < keys[i][0]) {
        const k0 = keys[i - 1], k1 = keys[i];
        const u = (t - k0[0]) / (k1[0] - k0[0]);
        return lerp(k0[1], k1[1], EASE[k1[2] || 'io'](u));
      }
    }
    return keys[n - 1][1];
  };
}
// Smooth box window: rises over ri starting at a, falls over ro starting at b.
function win(t, a, b, ri = 0.2, ro = ri) {
  const u = ri > 0 ? smooth(clamp((t - a) / ri)) : (t >= a ? 1 : 0);
  const d = ro > 0 ? 1 - smooth(clamp((t - b) / ro)) : (t < b ? 1 : 0);
  return u * d;
}
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 101.3), hash(i + 1 + seed * 101.3), u) * 2 - 1;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixc(a, b, t) {
  const A = rgb(a), B = rgb(b);
  const r = A.map((v, i) => Math.round(lerp(v, B[i], t)));
  return '#' + ((1 << 24) | (r[0] << 16) | (r[1] << 8) | r[2]).toString(16).slice(1);
}
function rgba(h, a) { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; }
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, Math.abs(rx)), Math.max(0.01, Math.abs(ry)), rot, 0, TAU); }
function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.01, r), 0, TAU); }

/* ------------------------------------------------------------ canvases */
let canvas = null, ctx = null, Q = 1, CW = W, CH = H;
let bg, bgx, chain = [], up = [], bloomC = [];
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function setup(cv, width) {
  canvas = cv; ctx = cv.getContext('2d');
  CW = Math.round(width); CH = Math.round(width * 9 / 16); Q = CW / W;
  cv.width = CW; cv.height = CH;
  bg = mk(CW, CH); bgx = bg.getContext('2d');
  chain = [bg]; up = [null];
  for (let i = 1; i <= 5; i++) { chain.push(mk(CW / 2 ** i, CH / 2 ** i)); up.push(mk(CW / 2 ** i, CH / 2 ** i)); }
  bloomC = [mk(CW / 2, CH / 2), mk(CW / 4, CH / 4), mk(CW / 8, CH / 8), mk(CW / 16, CH / 16)];
}
let grain = null;
function grainTile() {
  if (grain) return grain;
  grain = mk(256, 256);
  const g = grain.getContext('2d'), id = g.createImageData(256, 256), r = mulberry32(99);
  for (let i = 0; i < id.data.length; i += 4) { const v = 90 + r() * 76; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  return grain;
}

/* ------------------------------------------------------------- camera */
// A point (X, Y) at depth scale s lands on screen at W/2 + (X - fx)*z*s — so
// parallax and perspective both fall out of a single number per layer.
function camT(c, cam, s) {
  const k = cam.z * s;
  c.setTransform(Q, 0, 0, Q, 0, 0);
  c.translate(W / 2 + cam.sx, H / 2 + cam.sy);
  if (cam.rot) c.rotate(cam.rot);
  c.scale(k, k);
  c.translate(-cam.fx, -cam.fy);
}
function screenT(c) { c.setTransform(Q, 0, 0, Q, 0, 0); }

/* ---------------------------------------------------------- characters */
const L1 = 86, L2 = 84, TL = 148, UA = 78, FA = 72, FOOT = 11;
function mkChar(o) {
  const P = Object.assign({}, o.pal);
  P.skinD = mixc(P.skin, '#6b3b2a', 0.2);
  P.skinDD = mixc(P.skin, '#5a2f22', 0.42);
  P.topD = mixc(P.top, '#2b1d2a', 0.2);
  P.pantsD = mixc(P.pants, '#140d14', 0.28);
  P.hairL = mixc(P.hair, '#b09080', 0.3);
  P.hairD = mixc(P.hair, '#000000', 0.25);
  P.shoeD = mixc(P.shoe, '#3a2a2a', 0.3);
  P.iris = P.iris || '#4A2C1C';
  P.line = mixc(P.hair, '#000000', 0.2);
  return Object.assign({ size: 1, eye: 1, lash: false, outfit: 'hoodie', hair: 'boy', stride: 230 }, o, { P });
}
const CH_BOY = mkChar({ id: 'boy', hair: 'boy', outfit: 'hoodie', size: 1, pal: { skin: '#C98E62', hair: '#211715', top: '#EFA33A', pants: '#2F3A56', shoe: '#F6F1EA', accent: '#E4604E', iris: '#3F2517' } });
const CH_GIRL = mkChar({ id: 'girl', hair: 'girl', outfit: 'cardigan', size: 0.95, eye: 1.1, lash: true, bag: true, stride: 200, pal: { skin: '#EDC19C', hair: '#2A1C1A', top: '#B7A6D9', inner: '#FFF6EC', pants: '#5E6E96', shoe: '#F6F1EA', accent: '#F0B64A', bag: '#EADBC2', iris: '#4B2D22' } });
const CH_FRIEND = mkChar({ id: 'friend', hair: 'cap', outfit: 'tee', size: 1.05, pal: { skin: '#8E5A3C', hair: '#150F0D', top: '#3E9C8E', pants: '#6B5A4E', shoe: '#2E2A2A', accent: '#E4604E' } });

function E() { return { open: 1, lx: 0.6, ly: 0, happy: 0, brow: 0, worry: 0, smile: 0.3, mouth: 0, o: 0, wavy: 0, blush: 0, sweat: 0, blink: 0 }; }
function baseSt(x, face) {
  return { x, face, headRel: 1, walk: 0, phase: 0, kneel: 0, sit: 0, brace: 0, lean: 0.04, tilt: 0, bob: 0, hN: null, hF: null, e: E(), s: 1 };
}
const Lp = (x, y) => ({ x, y });
const Wp = (x, y) => ({ x, y, world: true });

function legPose(i, st) {
  const p = st.phase + i * Math.PI;
  let a = st.walk * 0.44 * Math.sin(p);
  let b = 0.06 + st.walk * 0.9 * Math.pow(Math.max(0, Math.cos(p)), 1.4);
  a = lerp(a, i ? -0.22 : 0.2, st.brace); b = lerp(b, i ? 0.14 : 0.1, st.brace);
  a = lerp(a, i ? 0.9 : 1.9, st.kneel); b = lerp(b, i ? 2.47 : 1.9, st.kneel);
  a = lerp(a, i ? 1.45 : 1.57, st.sit); b = lerp(b, i ? 1.38 : 1.5, st.sit);
  const kx = L1 * Math.sin(a), ky = L1 * Math.cos(a);
  const s = a - b;
  const ax = kx + L2 * Math.sin(s), ay = ky + L2 * Math.cos(s);
  let fa = -s * 0.7;
  if (i === 1) fa = lerp(fa, 2.75, smooth(clamp((st.kneel - 0.35) / 0.65)));
  const tx = ax + Math.cos(fa) * 36, ty = ay + Math.sin(fa) * 36;
  return { a, b, s, kx, ky, ax, ay, fa, tx, ty };
}
function ik(S, T, l1, l2) {
  let dx = T.x - S.x, dy = T.y - S.y, d = Math.hypot(dx, dy);
  const maxd = l1 + l2 - 0.5;
  let hx = T.x, hy = T.y;
  if (d > maxd) { hx = S.x + dx / d * maxd; hy = S.y + dy / d * maxd; dx = hx - S.x; dy = hy - S.y; d = maxd; }
  d = Math.max(d, 1e-3);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dy, dx);
  const e1 = { x: S.x + l1 * Math.cos(base + a), y: S.y + l1 * Math.sin(base + a) };
  const e2 = { x: S.x + l1 * Math.cos(base - a), y: S.y + l1 * Math.sin(base - a) };
  const sc = e => e.y - 0.5 * e.x;
  return { el: sc(e1) > sc(e2) ? e1 : e2, hand: { x: hx, y: hy } };
}
// Hand choreography: a list of [time, target|null(idle), blendDuration].
function seqTarget(seq, t) {
  if (!seq) return null;
  let i = 0;
  while (i + 1 < seq.length && seq[i + 1][0] <= t) i++;
  if (t < seq[0][0]) return { a: null, b: null, u: 1 };
  const cur = seq[i], prev = i > 0 ? seq[i - 1] : [0, null, 0];
  const u = cur[2] > 0 ? EASE.io(clamp((t - cur[0]) / cur[2])) : 1;
  const ev = v => (typeof v === 'function' ? v(t) : v);
  return { a: ev(prev[1]), b: ev(cur[1]), u };
}
function rig(C, st) {
  const S = C.size, fs = st.face >= 0 ? 1 : -1;
  const legs = [legPose(0, st), legPose(1, st)];
  let low = 0;
  for (const l of legs) low = Math.max(low, l.ay + FOOT, l.ty + 6, l.ky + 13);
  const hip = { x: 0, y: -low };
  const lean = st.lean, ux = Math.sin(lean), uy = -Math.cos(lean);
  const sh = { x: hip.x + ux * TL, y: hip.y + uy * TL + st.bob };
  const ht = lean + st.tilt;
  const head = { x: sh.x + Math.sin(ht) * 58, y: sh.y - Math.cos(ht) * 58 };
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const oN = rot({ x: 2, y: 14 }, lean), oF = rot({ x: -10, y: 12 }, lean);
  const shs = [{ x: sh.x + oN.x, y: sh.y + oN.y }, { x: sh.x + oF.x, y: sh.y + oF.y }];
  const arms = [];
  for (let i = 0; i < 2; i++) {
    const sw = st.walk * 0.5 * Math.sin(st.phase + (i ? 0 : Math.PI));
    const idle = { x: shs[i].x + Math.sin(sw) * 136 + 6, y: shs[i].y + Math.cos(sw) * 136 };
    const resolve = T => {
      if (!T) return idle;
      if (T.world) return { x: (T.x - st.x) / (S * fs), y: T.y / S };
      return { x: shs[i].x + T.x, y: shs[i].y + T.y };
    };
    const q = seqTarget(i ? st.hF : st.hN, st.t);
    let target = idle;
    if (q) { const A = resolve(q.a), B = resolve(q.b); target = { x: lerp(A.x, B.x, q.u), y: lerp(A.y, B.y, q.u) }; }
    const k = ik(shs[i], target, UA, FA);
    arms.push({ sh: shs[i], el: k.el, hand: k.hand });
  }
  const toW = p => ({ x: st.x + p.x * S * st.face, y: p.y * S });
  return { legs, hip, sh, head, arms, toW, fs, handW: [toW(arms[0].hand), toW(arms[1].hand)], headW: toW(head) };
}

/* ---- character drawing (local space: +x = facing direction, y down) */
function drawLeg(c, C, L, hip, far) {
  const P = C.P;
  c.save(); c.translate(hip.x, hip.y);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = far ? P.pantsD : P.pants;
  c.lineWidth = 32; c.beginPath(); c.moveTo(0, 0); c.lineTo(L.kx, L.ky); c.stroke();
  c.lineWidth = 28; c.beginPath(); c.moveTo(L.kx, L.ky); c.lineTo(L.ax, L.ay); c.stroke();
  c.translate(L.ax, L.ay); c.rotate(L.fa);
  c.fillStyle = far ? P.shoeD : P.shoe; rr(c, -15, -6, 52, 19, 9); c.fill();
  c.fillStyle = far ? mixc(P.shoeD, '#000000', 0.2) : mixc(P.shoe, '#8a7a70', 0.35); rr(c, -15, 8, 52, 6, 3); c.fill();
  if (C.P.accent && C.outfit !== 'tee') { c.fillStyle = far ? mixc(P.accent, '#000', .25) : P.accent; rr(c, 6, -2, 16, 5, 2.5); c.fill(); }
  c.restore();
}
function drawArm(c, C, A, far) {
  const P = C.P;
  c.lineCap = 'round'; c.lineJoin = 'round';
  const dx = A.hand.x - A.el.x, dy = A.hand.y - A.el.y, d = Math.hypot(dx, dy) || 1;
  const cuff = { x: A.hand.x - dx / d * 9, y: A.hand.y - dy / d * 9 };
  const skin = far ? P.skinD : P.skin;
  if (C.outfit === 'tee' || C.outfit === 'apron') {
    c.strokeStyle = skin; c.lineWidth = 18;
    c.beginPath(); c.moveTo(A.sh.x, A.sh.y); c.lineTo(A.el.x, A.el.y); c.lineTo(A.hand.x, A.hand.y); c.stroke();
    const mid = { x: lerp(A.sh.x, A.el.x, 0.55), y: lerp(A.sh.y, A.el.y, 0.55) };
    c.strokeStyle = far ? P.topD : P.top; c.lineWidth = 27;
    c.beginPath(); c.moveTo(A.sh.x, A.sh.y); c.lineTo(mid.x, mid.y); c.stroke();
  } else {
    c.strokeStyle = far ? P.topD : P.top; c.lineWidth = 24;
    c.beginPath(); c.moveTo(A.sh.x, A.sh.y); c.lineTo(A.el.x, A.el.y); c.lineTo(cuff.x, cuff.y); c.stroke();
    c.strokeStyle = far ? mixc(P.topD, '#000', .12) : P.topD; c.lineWidth = 22;
    c.beginPath(); c.moveTo(cuff.x - dx / d * 6, cuff.y - dy / d * 6); c.lineTo(cuff.x, cuff.y); c.stroke();
  }
  c.fillStyle = skin; circ(c, A.hand.x, A.hand.y, 10.5); c.fill();
}
function torsoPath(c) {
  const top = -TL - 6;
  c.beginPath();
  c.moveTo(-36, 10);
  c.bezierCurveTo(-40, -40, -44, top + 40, -30, top + 6);
  c.quadraticCurveTo(-18, top - 2, 0, top);
  c.quadraticCurveTo(26, top, 34, top + 14);
  c.bezierCurveTo(42, top + 50, 38, -30, 36, 10);
  c.quadraticCurveTo(0, 18, -36, 10);
  c.closePath();
}
function drawTorso(c, C, R, st) {
  const P = C.P, top = -TL - 6;
  c.save(); c.translate(R.hip.x, R.hip.y + st.bob * 0.4); c.rotate(st.lean);
  c.fillStyle = P.skinD; rr(c, -9, top - 22, 19, 36, 8); c.fill();
  torsoPath(c); c.fillStyle = P.top; c.fill();
  c.save(); torsoPath(c); c.clip();
  if (C.outfit === 'hoodie') {
    c.fillStyle = P.topD; c.globalAlpha = 0.35; ell(c, -46, -70, 22, 110); c.fill(); c.globalAlpha = 1;
    c.fillStyle = mixc(P.top, '#000', 0.08); rr(c, -2, -66, 38, 36, 10); c.fill();
    c.strokeStyle = P.topD; c.lineWidth = 2.5; rr(c, -2, -66, 38, 36, 10); c.stroke();
    c.fillStyle = P.topD; rr(c, -40, -8, 80, 20, 6); c.fill();
    c.strokeStyle = '#FFF4E4'; c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(12, top + 10); c.lineTo(10, top + 44); c.moveTo(22, top + 10); c.lineTo(22, top + 40); c.stroke();
  } else if (C.outfit === 'cardigan') {
    c.fillStyle = P.inner; c.beginPath(); c.moveTo(4, top); c.lineTo(28, top); c.lineTo(26, 12); c.lineTo(8, 12); c.closePath(); c.fill();
    c.fillStyle = P.topD; c.globalAlpha = 0.35; ell(c, -46, -70, 22, 110); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = P.topD; c.lineWidth = 2.4; c.beginPath(); c.moveTo(4, top + 2); c.lineTo(8, 12); c.stroke();
    c.fillStyle = P.topD; rr(c, -40, -6, 48, 18, 5); c.fill();
    c.fillStyle = '#FFFFFF'; circ(c, 6.5, -60, 2.6); c.fill(); circ(c, 7.3, -30, 2.6); c.fill();
    c.strokeStyle = mixc(P.top, '#fff', .25); c.lineWidth = 1.6; c.globalAlpha = .5;
    for (let y = top + 20; y < -10; y += 12) { c.beginPath(); c.moveTo(-36, y); c.lineTo(2, y + 2); c.stroke(); }
    c.globalAlpha = 1;
  } else if (C.outfit === 'tee') {
    c.fillStyle = P.topD; c.globalAlpha = 0.35; ell(c, -46, -70, 22, 110); c.fill(); c.globalAlpha = 1;
    c.fillStyle = '#FFF4E4'; circ(c, 10, -92, 14); c.fill();
    c.fillStyle = P.accent; circ(c, 10, -92, 8); c.fill();
    c.fillStyle = P.topD; rr(c, -40, 0, 80, 14, 5); c.fill();
  } else if (C.outfit === 'apron') {
    c.fillStyle = '#F4F1EA'; rr(c, -10, top + 30, 48, 190, 8); c.fill();
  }
  c.restore();
  if (C.outfit === 'hoodie') {
    c.fillStyle = P.topD; ell(c, -16, top + 6, 24, 12, -0.15); c.fill();
    c.fillStyle = mixc(P.top, '#000', 0.3); ell(c, -12, top + 4, 14, 6, -0.15); c.fill();
  } else if (C.outfit === 'tee') {
    c.strokeStyle = P.topD; c.lineWidth = 4; c.beginPath(); c.arc(4, top + 2, 13, 0.1, Math.PI - 0.1); c.stroke();
  } else if (C.outfit === 'cardigan') {
    c.fillStyle = P.topD; c.beginPath(); c.moveTo(-14, top + 2); c.quadraticCurveTo(4, top - 6, 10, top + 18); c.lineTo(2, top + 20); c.quadraticCurveTo(-4, top + 4, -14, top + 8); c.closePath(); c.fill();
  }
  c.restore();
}
function drawBag(c, C, R, st, t) {
  const P = C.P;
  const sw = Math.sin(st.phase) * 6 * st.walk;
  const bx = R.hip.x - 44 + sw, by = R.hip.y - 30;
  c.strokeStyle = mixc(P.bag, '#6b5040', 0.35); c.lineWidth = 6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(R.arms[1].sh.x - 4, R.arms[1].sh.y - 6); c.lineTo(bx + 10, by); c.stroke();
  c.save(); c.translate(bx, by); c.rotate(0.06 + sw * 0.01);
  c.fillStyle = P.bag; rr(c, -30, 0, 60, 72, 8); c.fill();
  c.fillStyle = mixc(P.bag, '#6b5040', 0.15); rr(c, -30, 0, 60, 10, 4); c.fill();
  c.fillStyle = '#E4604E'; circ(c, 0, 38, 7); c.fill();
  c.fillStyle = '#F0B64A'; circ(c, 0, 38, 3); c.fill();
  c.restore();
}
function withHead(c, R, st, fn) {
  c.save(); c.translate(R.head.x, R.head.y); c.rotate(st.lean + st.tilt); c.scale(st.headRel, 1); fn(); c.restore();
}
function facePath(c) {
  c.beginPath();
  c.moveTo(-44, -4);
  c.bezierCurveTo(-46, -40, -22, -54, 2, -54);
  c.bezierCurveTo(30, -54, 48, -38, 48, -8);
  c.bezierCurveTo(48, 20, 38, 42, 16, 50);
  c.bezierCurveTo(0, 55, -26, 48, -38, 30);
  c.bezierCurveTo(-44, 20, -44, 8, -44, -4);
  c.closePath();
}
function drawEye(c, C, e, cx, cy, sx) {
  const P = C.P, sc = C.eye;
  if (e.happy > 0.5) {
    c.strokeStyle = P.line; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - 8 * sx, cy + 3); c.quadraticCurveTo(cx, cy - 9, cx + 8 * sx, cy + 3); c.stroke();
    return;
  }
  const wide = Math.max(1, e.open);
  const open = clamp(e.open * (1 - e.blink));
  const rx = 8.4 * sc * sx * wide, ry = 10.4 * sc * wide;
  c.save();
  ell(c, cx, cy, rx, ry); c.clip();
  c.fillStyle = '#FFFDF8'; c.fillRect(cx - rx - 1, cy - ry - 1, rx * 2 + 2, ry * 2 + 2);
  const ix = cx + e.lx * 2.3 * sx, iy = cy + e.ly * 2.2;
  c.fillStyle = P.iris; ell(c, ix, iy, 6.8 * sc * sx, 7.4 * sc); c.fill();
  c.fillStyle = '#120B09'; ell(c, ix, iy, 3.6 * sc * sx, 4 * sc); c.fill();
  c.fillStyle = '#FFFFFF'; circ(c, ix + 2.3 * sx, iy - 2.8, 2.3 * sc); c.fill(); circ(c, ix - 2 * sx, iy + 2.6, 1.1 * sc); c.fill();
  const lr = ry * (2 * open - 1);
  c.fillStyle = P.skin;
  c.beginPath(); c.moveTo(cx - rx - 2, cy);
  if (lr >= 0) c.ellipse(cx, cy, rx + 0.6, Math.max(0.01, lr), 0, Math.PI, TAU, false);
  else c.ellipse(cx, cy, rx + 0.6, Math.max(0.01, -lr), 0, Math.PI, 0, true);
  c.lineTo(cx + rx + 3, cy - ry - 4); c.lineTo(cx - rx - 3, cy - ry - 4); c.closePath(); c.fill();
  c.restore();
  // cover the anti-aliased rim of the clip above the lid
  c.fillStyle = P.skin;
  c.beginPath(); c.moveTo(cx - rx - 1.6, cy);
  if (lr >= 0) c.ellipse(cx, cy, rx, Math.max(0.01, lr), 0, Math.PI, TAU, false);
  else c.ellipse(cx, cy, rx, Math.max(0.01, -lr), 0, Math.PI, 0, true);
  c.lineTo(cx + rx + 1.6, cy);
  c.ellipse(cx, cy, rx + 1.6, ry + 1.6, 0, 0, Math.PI, true);
  c.closePath(); c.fill();
  c.strokeStyle = P.line; c.lineWidth = C.lash ? 3.4 : 2.8; c.lineCap = 'round';
  c.beginPath();
  if (lr >= 0) c.ellipse(cx, cy, rx, Math.max(0.01, lr), 0, Math.PI + 0.12, TAU - 0.12, false);
  else c.ellipse(cx, cy, rx, Math.max(0.01, -lr), 0, Math.PI - 0.12, 0.12, true);
  c.stroke();
  if (C.lash && open > 0.25) {
    const side = sx > 0.9 ? 1 : -1;
    const ex = cx + side * rx * 0.96, ey = cy - Math.max(0, lr) * 0.3;
    c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + side * 5, ey - 4); c.stroke();
  }
}
function drawMouth(c, C, e) {
  const mx = 15, my = 30, P = C.P;
  const sm = e.smile;
  if (e.mouth > 0.04) {
    const o = e.mouth, w = 8.5 + o * 3 + sm * 2;
    c.save();
    c.beginPath();
    c.moveTo(mx - w, my - sm * 3);
    c.quadraticCurveTo(mx, my + 1 - sm * 1, mx + w, my - sm * 3.5);
    c.quadraticCurveTo(mx + w * 0.6, my + 4 + o * 16, mx, my + 4 + o * 16);
    c.quadraticCurveTo(mx - w * 0.6, my + 4 + o * 16, mx - w, my - sm * 3);
    c.closePath();
    c.fillStyle = '#6E2C2E'; c.fill();
    c.clip();
    c.fillStyle = '#E07A76'; ell(c, mx, my + 5 + o * 15, w * 0.7, 6); c.fill();
    if (o > 0.35) { c.fillStyle = '#FFFDF8'; c.fillRect(mx - w, my - 6, w * 2, 4.5 + sm); }
    c.restore();
  } else if (e.o > 0.04) {
    c.fillStyle = '#6E2C2E'; ell(c, mx, my + 2, 3 + e.o * 3.4, 3.6 + e.o * 4.4); c.fill();
  } else if (e.wavy > 0.04) {
    c.strokeStyle = P.skinDD; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i <= 10; i++) { const x = mx - 8 + i * 1.6, y = my + 1 + Math.sin(i * 1.3) * 2 * e.wavy; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  } else {
    c.strokeStyle = P.skinDD; c.lineWidth = 3.1; c.lineCap = 'round';
    c.beginPath(); c.moveTo(mx - 8, my - sm * 2); c.quadraticCurveTo(mx, my + 1 + sm * 6, mx + 8, my - sm * 2.6); c.stroke();
  }
}
function drawBrows(c, C, e) {
  const by = -17 - e.brow * 6, w = e.worry * 5;
  c.strokeStyle = C.P.hair; c.lineWidth = C.lash ? 3.6 : 4.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(13, by + 2 - w); c.quadraticCurveTo(22, by - 3, 31, by + 1 + w * 1.1); c.stroke();
  c.beginPath(); c.moveTo(-17, by + 1 + w * 1.1); c.quadraticCurveTo(-10, by - 3, -3, by + 2 - w); c.stroke();
}
function hairBackGirl(c, C, sway) {
  const P = C.P;
  c.fillStyle = P.hairD;
  c.beginPath();
  c.moveTo(-20, -66);
  c.bezierCurveTo(-60, -58, -68, -8, -62, 40);
  c.bezierCurveTo(-58, 92, -62 + sway, 140, -48 + sway, 178);
  c.quadraticCurveTo(-28 + sway, 192, -10 + sway, 174);
  c.quadraticCurveTo(4 + sway, 184, 14 + sway, 160);
  c.bezierCurveTo(8, 120, 4, 80, 6, 30);
  c.lineTo(20, -60); c.closePath(); c.fill();
  c.beginPath();
  c.moveTo(28, -62);
  c.bezierCurveTo(58, -54, 64, -10, 58, 30);
  c.bezierCurveTo(56, 56, 60 + sway * 0.3, 74, 50 + sway * 0.3, 90);
  c.quadraticCurveTo(42, 70, 44, 40);
  c.lineTo(38, -20); c.closePath(); c.fill();
}
function drawHairFront(c, C, t) {
  const P = C.P;
  c.fillStyle = P.hair;
  if (C.hair === 'boy' || C.hair === 'short') {
    c.beginPath();
    c.moveTo(-47, 12);
    c.bezierCurveTo(-58, -30, -34, -70, 4, -68);
    c.bezierCurveTo(38, -66, 58, -44, 52, -12);
    c.lineTo(46, -6); c.quadraticCurveTo(42, -18, 33, -22);
    c.lineTo(31, -8); c.quadraticCurveTo(24, -22, 12, -26);
    c.lineTo(8, -13); c.quadraticCurveTo(-2, -26, -16, -26);
    c.quadraticCurveTo(-30, -24, -36, -12);
    c.quadraticCurveTo(-40, -2, -38, 12);
    c.closePath(); c.fill();
    if (C.hair === 'boy') {
      c.beginPath(); c.moveTo(-20, -64); c.quadraticCurveTo(-16, -84, -2, -86); c.quadraticCurveTo(-10, -76, -5, -66); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-4, -66); c.quadraticCurveTo(8, -82, 20, -80); c.quadraticCurveTo(10, -74, 10, -64); c.closePath(); c.fill();
    }
    c.strokeStyle = P.hairL; c.lineWidth = 3; c.globalAlpha = 0.55; c.lineCap = 'round';
    c.beginPath(); c.arc(2, -20, 38, -2.4, -1.55); c.stroke(); c.globalAlpha = 1;
  } else if (C.hair === 'girl' || C.hair === 'bob' || C.hair === 'bun') {
    c.beginPath();
    const len = C.hair === 'girl' ? 52 : 30;
    c.moveTo(-52, len - 12);
    c.bezierCurveTo(-62, -20, -40, -72, 4, -70);
    c.bezierCurveTo(42, -68, 58, -40, 50, -6);
    c.quadraticCurveTo(40, -18, 30, -18);
    c.quadraticCurveTo(20, -6, 8, -20);
    c.quadraticCurveTo(-4, -32, -18, -26);
    c.quadraticCurveTo(-32, -18, -38, 0);
    c.quadraticCurveTo(-42, len - 28, -40, len);
    c.quadraticCurveTo(-46, len + 6, -52, len - 12);
    c.closePath(); c.fill();
    if (C.hair === 'bun') { circ(c, -28, -70, 18); c.fill(); }
    c.strokeStyle = P.hairL; c.lineWidth = 3; c.globalAlpha = 0.5; c.lineCap = 'round';
    c.beginPath(); c.arc(0, -18, 42, -2.5, -1.7); c.stroke(); c.globalAlpha = 1;
    if (C.hair === 'girl') {
      c.save(); c.translate(-32, -40); c.rotate(-0.7);
      c.fillStyle = P.accent; rr(c, -9, -3.5, 18, 7, 3.5); c.fill();
      c.fillStyle = '#FFF4E4'; circ(c, 5, 0, 1.6); c.fill();
      c.restore();
    }
  } else if (C.hair === 'cap') {
    c.beginPath(); c.moveTo(-46, 4); c.bezierCurveTo(-52, -30, -30, -58, 0, -58); c.bezierCurveTo(30, -58, 50, -40, 48, -18); c.lineTo(-40, -8); c.closePath(); c.fill();
    c.fillStyle = P.accent;
    c.beginPath(); c.moveTo(-50, -12); c.bezierCurveTo(-54, -58, -12, -74, 18, -66); c.bezierCurveTo(42, -60, 54, -40, 50, -22); c.quadraticCurveTo(0, -30, -50, -12); c.closePath(); c.fill();
    c.fillStyle = mixc(P.accent, '#000', 0.25); rr(c, -70, -24, 30, 11, 5); c.fill();
    c.fillStyle = mixc(P.accent, '#000', 0.15); circ(c, 0, -66, 5); c.fill();
  }
}
function drawHead(c, C, st) {
  const P = C.P, e = st.e;
  if (C.hair === 'hijab') {
    c.fillStyle = P.scarf; ell(c, -2, 6, 60, 66); c.fill();
    c.beginPath(); c.moveTo(-58, 20); c.quadraticCurveTo(-60, 90, -40, 110); c.lineTo(40, 110); c.quadraticCurveTo(56, 80, 52, 30); c.closePath(); c.fill();
  }
  if (C.hair !== 'girl' && C.hair !== 'hijab' && C.hair !== 'bob') {
    c.fillStyle = P.skinD; ell(c, -37, 6, 8, 11); c.fill();
    c.fillStyle = P.skinDD; ell(c, -36, 7, 3.5, 5.5); c.fill();
  }
  facePath(c); c.fillStyle = P.skin; c.fill();
  c.save(); facePath(c); c.clip();
  c.fillStyle = P.skinD; c.globalAlpha = 0.4; ell(c, -54, 8, 24, 62); c.fill(); c.globalAlpha = 1;
  c.restore();
  if (e.blush > 0.01) {
    c.fillStyle = `rgba(236,104,110,${0.45 * clamp(e.blush)})`;
    ell(c, 28, 19, 10, 5.5); c.fill(); ell(c, -12, 19, 8.5, 5); c.fill();
  }
  drawEye(c, C, e, 22, 4, 1);
  drawEye(c, C, e, -9, 4, 0.8);
  c.strokeStyle = P.skinDD; c.lineWidth = 2.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(38, 8); c.quadraticCurveTo(44, 15, 37, 18); c.stroke();
  drawMouth(c, C, e);
  if (C.hair === 'hijab') {
    c.save(); c.strokeStyle = P.scarf; c.lineWidth = 12; facePath(c); c.clip(); facePath(c); c.stroke(); c.restore();
    c.fillStyle = P.scarf; c.beginPath(); c.moveTo(-48, -10); c.bezierCurveTo(-52, -52, -20, -62, 6, -62); c.bezierCurveTo(36, -62, 54, -42, 50, -18); c.quadraticCurveTo(10, -44, -48, -10); c.closePath(); c.fill();
  } else {
    drawHairFront(c, C);
  }
  drawBrows(c, C, e);
  if (e.sweat > 0.02) {
    c.save(); c.globalAlpha = clamp(e.sweat); c.translate(-48, -30);
    c.fillStyle = '#BFE3F5'; c.beginPath(); c.moveTo(0, -12); c.quadraticCurveTo(8, 2, 0, 6); c.quadraticCurveTo(-8, 2, 0, -12); c.fill();
    c.fillStyle = '#FFFFFF'; circ(c, -1.5, 1, 1.6); c.fill();
    c.restore();
  }
}
function drawChar(c, C, st, R) {
  c.save();
  c.translate(st.x, 0);
  c.scale(C.size * st.face, C.size);
  if (!st.noShadow) {
    c.fillStyle = 'rgba(70,40,25,.2)';
    ell(c, st.kneel * 18, 0, 70 + st.kneel * 26, 9); c.fill();
  }
  drawArm(c, C, R.arms[1], true);
  drawLeg(c, C, R.legs[1], R.hip, true);
  if (C.bag) drawBag(c, C, R, st);
  if (C.hair === 'girl') withHead(c, R, st, () => hairBackGirl(c, C, Math.sin(st.t * 2.1 + st.phase) * 3 * (0.4 + st.walk)));
  drawLeg(c, C, R.legs[0], R.hip, false);
  drawTorso(c, C, R, st);
  withHead(c, R, st, () => drawHead(c, C, st));
  drawArm(c, C, R.arms[0], false);
  c.restore();
}

/* ------------------------------------------------------ choreography */
const blinkAt = (t, seed) => { const per = 3.2 + seed; const ph = (t + seed * 2.1) % per; return ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0; };
const talkM = (t, seed) => 0.12 + 0.42 * Math.abs(Math.sin(t * 14.3 + seed)) * (0.6 + 0.4 * Math.sin(t * 5.1 + seed * 3));
const story = t => (t < T_IMP ? t : t < 18 ? T_IMP + (t - T_IMP) * 0.35 : T_IMP + 0.56 + (t - 18));
const filmOf = s => (s < T_IMP ? s : s < T_IMP + 0.56 ? T_IMP + (s - T_IMP) / 0.35 : 18 + (s - T_IMP - 0.56));

// Boy
const boyXpre = t => -60 - 150 * (T_IMP - t);
const bxPost = tk([[16.4, -60], [17.7, -165, 'out'], [25.2, -165], [26.2, -132], [51.9, -132], [52.7, -172], [53.3, -172]]);
const boyX = t => (t < T_IMP ? boyXpre(t) + 14 * Math.exp(-Math.pow((t - 6.8) / 0.22, 2)) : t < 53.3 ? bxPost(t) : -172 - 135 * (t - 53.3));
const boyFace = tk([[53.0, 1], [53.35, -1]]);
const boyHead = tk([[12.95, 1], [13.25, -1], [15.75, -1], [16.0, 1], [51.45, 1], [51.62, -1], [52.0, -1], [52.18, 1], [55.6, 1], [55.8, -1], [57.0, -1], [57.2, 1]]);
const boyWalk = tk([[16.4, 1], [16.8, 0.55], [17.7, 0], [51.9, 0], [52.05, 0.45], [52.65, 0.45], [52.8, 0], [53.15, 0], [53.5, 1]]);
const boyKneel = tk([[24.7, 0], [26.0, 1], [49.95, 1], [51.0, 0]]);
const boyLaugh = t => clamp(win(t, 3.15, 4.6, 0.15, 0.25) + win(t, 4.9, 6.1, 0.15, 0.25) + win(t, 6.85, 7.9, 0.12, 0.3) + win(t, 13.6, 15.5, 0.2, 0.25));
const BOY_N = [[0, null, 0],
  [0.5, t => Lp(46 + 8 * Math.sin(t * 5), 40 + 8 * Math.sin(t * 7.3)), 0.35], [2.5, null, 0.4],
  [3.2, Lp(34, 104), 0.3], [4.7, null, 0.35], [4.95, Lp(30, 66), 0.3], [6.2, null, 0.4],
  [16.42, Lp(40, 8), 0.14], [19.4, Lp(34, 80), 0.6], [24.6, null, 0.6],
  [26.55, Wp(-48, -10), 0.45], [27.0, Lp(62, 94), 0.35], [28.25, Lp(58, 100), 0.2], [28.5, null, 0.4],
  [30.95, Wp(8, -12), 0.6], [32.2, Lp(56, 82), 0.4],
  [43.3, Wp(6, -176), 0.9], [45.3, Lp(44, 112), 0.6], [49.9, null, 0.8],
  [51.9, Lp(-16, -26), 0.35], [52.85, t => Lp(42 + 8 * Math.sin(t * 16), -46), 0.2], [53.3, null, 0.4]];
const BOY_F = [[0, null, 0], [3.2, Lp(40, 110), 0.3], [4.7, null, 0.4],
  [16.45, Lp(32, 22), 0.16], [19.4, Lp(30, 86), 0.6], [24.6, null, 0.6],
  [27.35, Wp(-14, -9), 0.45], [27.8, Lp(58, 102), 0.35],
  [28.6, Wp(8, -172), 0.7], [29.85, Lp(48, 112), 0.45], [49.9, null, 0.8]];
function boyState(t) {
  const s = baseSt(boyX(t), boyFace(t));
  s.t = t; s.headRel = boyHead(t);
  s.walk = boyWalk(t); s.phase = s.x * TAU / CH_BOY.stride * (s.face >= 0 ? 1 : -1);
  s.kneel = boyKneel(t);
  s.brace = win(t, 16.42, 19.8, 0.15, 0.7);
  const laugh = boyLaugh(t);
  const floorReach = win(t, 26.45, 27.05, 0.4, 0.35) + win(t, 27.3, 27.85, 0.35, 0.35) + win(t, 30.95, 32.25, 0.5, 0.45);
  s.lean = 0.05 - 0.07 * laugh + s.kneel * 0.24 + 0.5 * floorReach + 0.14 * win(t, 28.6, 29.9, 0.5, 0.4) + 0.14 * win(t, 43.3, 45.3, 0.7, 0.5) - 0.06 * s.brace;
  s.tilt = -0.16 * laugh + 0.14 * win(t, 22.3, 33.9, 0.5, 0.6) - 0.12 * floorReach + 0.1 * win(t, 51.9, 52.8, 0.3, 0.3);
  s.bob = laugh * 3 * Math.sin(t * 16);
  s.hN = BOY_N; s.hF = BOY_F;
  const e = s.e;
  const talking = clamp(win(t, 0.5, 2.4, 0.1, 0.1) + win(t, 9.0, 10.4, 0.1, 0.1) + win(t, 11.2, 12.6, 0.1, 0.1) + win(t, 28.1, 30.5, 0.1, 0.15) + win(t, 43.6, 45.3, 0.1, 0.15));
  const surprise = win(t, 16.2, 19.8, 0.08, 0.8);
  e.smile = 0.45;
  e.mouth = talking * talkM(t, 1) + laugh * (0.5 + 0.3 * Math.abs(Math.sin(t * 16)));
  e.happy = laugh > 0.55 ? 1 : 0;
  e.open = 1 + 0.18 * surprise; e.brow = surprise; e.lx = 0.8;
  e.o = 0.8 * win(t, 16.25, 18.4, 0.08, 0.5);
  if (e.o > 0.1) e.mouth *= 0.2;
  e.smile = lerp(e.smile, 0, surprise);
  const down = win(t, 22.3, 33.8, 0.4, 0.5);
  e.ly = lerp(e.ly, 2.4, down); e.open = lerp(e.open, 0.82, down); e.brow = Math.max(e.brow, 0.3 * down);
  const her = win(t, 28.3, 29.5, 0.3, 0.3);
  e.ly = lerp(e.ly, 0.2, her); e.lx = lerp(e.lx, 1.8, her); e.open = lerp(e.open, 1, her); e.worry = 0.35 * down;
  const g = win(t, 34.0, 99, 0.9, 0);
  e.lx = lerp(e.lx, 1.7, g); e.ly = lerp(e.ly, 0.1, g); e.open = lerp(e.open, 1.05, g); e.worry = lerp(e.worry, 0, g);
  e.o = Math.max(e.o, 0.22 * win(t, 34.6, 38.2, 0.5, 0.6));
  e.smile = lerp(e.smile, 0.35, win(t, 22.3, 33, 0.5, 0.5)) + 0.3 * win(t, 39.5, 99, 1.5, 0);
  const phoneLook = win(t, 43.4, 44.7, 0.3, 0.3);
  e.ly = lerp(e.ly, 1.4, phoneLook);
  e.smile += 0.3 * win(t, 48.6, 99, 0.3, 0);
  e.blush = 0.35 * win(t, 37, 58, 2, 1.5) + 0.25 * win(t, 51.9, 53, 0.3, 0.5);
  e.happy = Math.max(e.happy, win(t, 52.0, 52.75, 0.1, 0.1) > 0.5 ? 1 : 0);
  if (t > 53.3) { e.lx = 1.2; e.ly = 0; e.open = 1; }
  e.blink = e.happy ? 0 : blinkAt(t, 0.3);
  return s;
}

// Girl
const gxPost = tk([[16.4, 60], [17.7, 172, 'out'], [22.3, 172], [23.2, 150], [53.7, 150]]);
const girlX = t => (t < T_IMP ? 60 + 105 * (T_IMP - t) : t < 53.7 ? gxPost(t) : 150 + 100 * (t - 53.7));
const girlFace = tk([[53.4, -1], [53.72, 1]]);
const girlHead = tk([[55.85, 1], [56.05, -1], [57.3, -1], [57.5, 1]]);
const girlWalk = tk([[16.4, 0.85], [16.8, 0.5], [17.7, 0], [53.45, 0], [53.9, 0.85]]);
const girlKneel = tk([[22.3, 0], [23.4, 1], [49.95, 1], [51.0, 0]]);
const GIRL_N = [[0, Lp(44, 62), 0],
  [16.42, Lp(40, -24), 0.12], [16.9, Lp(34, 34), 0.6],
  [20.55, Lp(18, -40), 0.4],
  [22.35, t => Lp(40 + 7 * Math.sin(t * 11), 26 + 5 * Math.sin(t * 9)), 0.5],
  [24.1, Lp(46, 96), 0.4],
  [25.65, Wp(34, -12), 0.45], [26.3, Lp(70, 94), 0.35], [26.9, Lp(46, 100), 0.4],
  [29.2, Wp(8, -172), 0.6], [29.85, Lp(70, 98), 0.35], [30.35, Lp(46, 100), 0.4],
  [30.95, Wp(22, -40), 0.7], [31.8, Lp(34, 52), 0.35],
  [44.45, Wp(6, -176), 0.7], [45.25, Lp(34, 50), 0.6]];
const GIRL_F = [[0, Lp(10, 128), 0], [16.45, Lp(30, 36), 0.16], [24.15, Wp(70, -16), 0.5], [24.9, Lp(72, 108), 0.45], [49.9, Lp(36, 66), 0.9]];
function girlState(t) {
  const s = baseSt(girlX(t), girlFace(t));
  s.t = t; s.headRel = girlHead(t);
  s.walk = girlWalk(t); s.phase = s.x * TAU / CH_GIRL.stride * (s.face >= 0 ? 1 : -1);
  s.kneel = girlKneel(t);
  s.brace = win(t, 16.42, 20.5, 0.15, 0.7);
  const floorReach = win(t, 24.1, 24.95, 0.45, 0.35) + win(t, 25.6, 26.35, 0.45, 0.35) + win(t, 30.95, 31.8, 0.55, 0.3);
  s.lean = 0.06 + s.kneel * 0.24 + 0.5 * floorReach + 0.12 * win(t, 29.2, 29.9, 0.5, 0.4) + 0.12 * win(t, 44.4, 45.3, 0.6, 0.5) - 0.08 * s.brace;
  const phoneLook = win(t, -1, 16.35, 0, 0.08);
  s.tilt = 0.12 * phoneLook + 0.14 * win(t, 22.4, 33.3, 0.4, 0.8) - 0.12 * floorReach + 0.06 * win(t, 46.6, 48.2, 0.4, 0.5) + 0.08 * win(t, 51.4, 52.3, 0.3, 0.4);
  s.hN = GIRL_N; s.hF = GIRL_F;
  const e = s.e;
  let open = 1, ly = 0, lx = 0.8, smile = 0.25, brow = 0, worry = 0, o = 0, wavy = 0, blush = 0.1;
  open = lerp(open, 0.3, phoneLook); ly = lerp(ly, 2.6, phoneLook); brow = 0.25 * phoneLook; lx = lerp(lx, 1.2, phoneLook);
  smile += 0.35 * win(t, 12.3, 13.7, 0.3, 0.4); blush += 0.15 * win(t, 12.3, 13.7, 0.3, 0.4);
  const st = win(t, 16.35, 20.6, 0.06, 0.5);
  open = lerp(open, 1.16, st); ly = lerp(ly, -0.3, st); brow = st; o = 0.85 * win(t, 16.35, 18.6, 0.06, 0.4);
  smile = lerp(smile, 0, st);
  worry = 0.85 * win(t, 18.2, 33.2, 0.5, 0.6);
  wavy = 0.7 * win(t, 18.6, 30.8, 0.3, 0.3);
  const fl = win(t, 22.4, 33.3, 0.4, 0.2);
  open = lerp(open, 0.85, fl); ly = lerp(ly, 2.6, fl);
  lx = lerp(lx, 0.8 + 1.1 * Math.sin(t * 6.5), fl * win(t, 22.4, 27.5, 0.2, 0.4));
  const touch = win(t, 31.4, 32.4, 0.15, 0.5);
  open = lerp(open, 1.06, touch); ly = lerp(ly, 1.9, touch);
  const g = win(t, 33.35, 99, 1.1, 0);
  open = lerp(open, 1.0, g); ly = lerp(ly, -0.4, g); lx = lerp(lx, 1.6, g); worry = lerp(worry, 0, g); wavy = lerp(wavy, 0, g);
  o = Math.max(o, 0.18 * win(t, 34.4, 38.4, 0.6, 0.6));
  smile = lerp(smile, 0.2, g) + 0.2 * win(t, 40.5, 99, 1.5, 0) + 0.2 * win(t, 46.6, 99, 0.5, 0);
  const ph2 = win(t, 43.5, 45.5, 0.3, 0.4);
  ly = lerp(ly, 1.8, ph2);
  const shy = win(t, 46.7, 48.0, 0.3, 0.4) + win(t, 51.4, 52.3, 0.3, 0.4);
  open = lerp(open, 0.12, shy); ly = lerp(ly, 1.8, shy);
  blush += 0.45 * win(t, 20.4, 33, 0.6, 0.5) + 0.35 * win(t, 31.75, 33, 0.2, 0.3) + 0.55 * win(t, 34.5, 60, 2.5, 1) + 0.25 * win(t, 46.6, 53, 0.5, 1);
  const talking = clamp(win(t, 23.2, 25.5, 0.08, 0.1) + win(t, 25.7, 27.3, 0.08, 0.1) + win(t, 46.8, 47.9, 0.08, 0.12));
  e.mouth = talking * talkM(t, 2.2) * (1 - 0.3 * win(t, 46.6, 48.2));
  if (talking > 0.3) wavy = 0;
  if (t > 53.7) { lx = 1.2; ly = 0.3; open = 0.95; }
  Object.assign(e, { open, ly, lx, smile, brow, worry, o, wavy, blush, sweat: win(t, 20.7, 28.6, 0.3, 0.8) });
  e.blink = blinkAt(t, 1.1);
  return s;
}

// Friend
const friendX = t => (t < 11 ? boyXpre(t) - 118 : t < 13.2 ? lerp(boyXpre(11) - 118, -700, (t - 11) / 2.2) : -700);
const friendS = tk([[11, 0.95], [13.2, 0.86]]);
const friendSit = tk([[13.3, 0], [13.9, 1]]);
const FR_N = [[0, null, 0],
  [1.9, t => Lp(44 + 6 * Math.sin(t * 6), 50 + 6 * Math.sin(t * 8)), 0.3], [3.0, null, 0.4],
  [6.5, Wp(0, -300), 0.18], [6.9, null, 0.4],
  [13.35, Lp(56, 92), 0.5],
  [13.6, t => Lp(50 + 6 * Math.sin(t * 6), 30 + 6 * Math.sin(t * 7)), 0.3], [15.5, Lp(56, 92), 0.4],
  [16.6, Lp(20, -30), 0.3], [19.0, Lp(56, 92), 0.6],
  [49.95, t => Lp(34 + 12 * Math.sin(t * 15), -80), 0.25], [51.3, Lp(56, 92), 0.5],
  [57.4, t => Lp(34 + 12 * Math.sin(t * 15), -80), 0.3]];
const FR_F = [[0, null, 0], [13.35, Lp(52, 100), 0.5]];
function friendState(t) {
  const x = friendX(t);
  const s = baseSt(x, 1);
  s.t = t; s.s = friendS(t);
  if (t < 11) s.x = x;
  s.walk = t < 12.9 ? 1 : tk([[12.9, 1], [13.3, 0]])(t);
  s.phase = x * TAU / CH_FRIEND.stride;
  s.sit = friendSit(t);
  const laugh = clamp(win(t, 3.15, 4.6, 0.15, 0.25) + win(t, 5.0, 6.0, 0.15, 0.25) + win(t, 6.9, 7.8, 0.12, 0.3) + win(t, 14.2, 15.4, 0.2, 0.3) + win(t, 19.2, 21.5, 0.3, 0.5));
  s.lean = 0.05 + 0.06 * s.sit - 0.08 * laugh;
  s.tilt = -0.14 * laugh;
  s.bob = laugh * 2.5 * Math.sin(t * 15 + 1);
  s.hN = FR_N; s.hF = FR_F;
  const e = s.e;
  const talking = clamp(win(t, 1.9, 3.0, 0.1, 0.1) + win(t, 13.6, 14.2, 0.1, 0.1) + win(t, 49.95, 51.3, 0.1, 0.1) + win(t, 57.4, 59, 0.1, 0.1));
  e.smile = 0.6; e.lx = 1;
  e.mouth = talking * talkM(t, 3) + laugh * (0.5 + 0.3 * Math.abs(Math.sin(t * 15)));
  e.happy = laugh > 0.55 ? 1 : 0;
  const sur = win(t, 16.5, 19.0, 0.2, 0.4);
  e.open = 1 + 0.15 * sur; e.brow = sur + 0.4 * win(t, 49.95, 51.3); e.o = 0.6 * sur;
  if (sur > 0.3) { e.mouth = 0; e.happy = 0; }
  e.blink = e.happy ? 0 : blinkAt(t, 2.2);
  return s;
}

/* ------------------------------------------------ background people */
const CROWD_PAL = [
  { skin: '#D9A47E', hair: '#2A1D18', top: '#8FB3C9', pants: '#4A4A5A', shoe: '#EDE6DC' },
  { skin: '#E2B58F', hair: '#3A2A22', top: '#C99AA5', pants: '#5A5046', shoe: '#EDE6DC', scarf: '#6F8FA8' },
  { skin: '#A86B4A', hair: '#1A1210', top: '#D9C38E', pants: '#3E4658', shoe: '#EDE6DC' },
  { skin: '#F0C8A6', hair: '#6B4A36', top: '#9FB89A', pants: '#4D4A5E', shoe: '#EDE6DC' },
  { skin: '#C48A63', hair: '#231816', top: '#E0B08F', pants: '#3D3A4A', shoe: '#EDE6DC', scarf: '#B25F5F' },
  { skin: '#7E4E34', hair: '#120C0B', top: '#B8A0C9', pants: '#3F3B38', shoe: '#EDE6DC' },
];
const TABLES = [-2300, -1450, -640, 650, 1600, 2600];
const SEATED = [
  { x: -2440, f: 1, p: 0, hair: 'short' }, { x: -2165, f: -1, p: 1, hair: 'hijab' },
  { x: -1590, f: 1, p: 3, hair: 'bun' }, { x: -1310, f: -1, p: 2, hair: 'short' },
  { x: -470, f: -1, p: 4, hair: 'bob' },
  { x: 510, f: 1, p: 2, hair: 'bob' }, { x: 790, f: -1, p: 0, hair: 'short' },
  { x: 1460, f: 1, p: 1, hair: 'hijab' }, { x: 1745, f: -1, p: 3, hair: 'short' },
  { x: 2470, f: 1, p: 5, hair: 'bun' },
].map((o, i) => Object.assign(o, { C: mkChar({ hair: o.hair, outfit: i % 3 === 0 ? 'tee' : 'hoodie', size: 0.96 + (i % 3) * 0.03, eye: 1, lash: o.hair === 'bun' || o.hair === 'bob' || o.hair === 'hijab', pal: Object.assign({ accent: '#E4604E', iris: '#3a2418' }, CROWD_PAL[o.p]) }), seed: i * 1.37 + 0.4 }));
function seatedState(o, t) {
  const s = baseSt(o.x, o.f);
  s.t = t; s.sit = 1; s.noShadow = true;
  const talk = clamp((vnoise(t * 0.45, o.seed) + 0.1) * 3);
  const laugh = clamp((vnoise(t * 0.22, o.seed + 9) - 0.45) * 5);
  s.lean = 0.1 + 0.04 * Math.sin(t * 0.7 + o.seed) - 0.07 * laugh;
  s.tilt = -0.1 * laugh + 0.05 * vnoise(t * 0.4, o.seed + 3);
  s.bob = laugh * 2 * Math.sin(t * 14 + o.seed);
  const gest = clamp((vnoise(t * 0.5, o.seed + 5) - 0.2) * 3);
  s.hN = [[0, t2 => Lp(60 + gest * 10 * Math.sin(t2 * 5 + o.seed), 70 - gest * 40), 0]];
  s.hF = [[0, Lp(56, 80), 0]];
  s.e.mouth = talk * talkM(t, o.seed) * 0.8 + laugh * 0.6;
  s.e.happy = laugh > 0.6 ? 1 : 0;
  s.e.smile = 0.4; s.e.lx = 1;
  s.e.blink = blinkAt(t, o.seed);
  return s;
}
const WALKERS = [
  { x0: -3600, v: 170, f: 1, p: 3, hair: 'bob', tray: true },
  { x0: 3300, v: -150, f: -1, p: 2, hair: 'short' },
  { x0: -5200, v: 140, f: 1, p: 5, hair: 'short', t0: 20 },
  { x0: 4200, v: -130, f: -1, p: 1, hair: 'hijab', t0: 30 },
].map((o, i) => Object.assign(o, { C: mkChar({ hair: o.hair, outfit: i % 2 ? 'tee' : 'hoodie', size: 1, lash: o.hair !== 'short', pal: Object.assign({ accent: '#3E9C8E', iris: '#3a2418' }, CROWD_PAL[o.p]) }) }));
function walkerState(o, t) {
  const x = o.x0 + o.v * (t - (o.t0 || 0));
  const s = baseSt(x, o.f);
  s.t = t; s.walk = 1; s.phase = x * TAU / 220 * o.f;
  if (o.tray) { s.hN = [[0, Lp(56, 70), 0]]; s.hF = [[0, Lp(52, 74), 0]]; }
  s.e.smile = 0.3; s.e.lx = 1; s.e.blink = blinkAt(t, o.x0 * 0.001);
  return s;
}
const SERVER = mkChar({ hair: 'bun', outfit: 'apron', size: 1, lash: true, pal: { skin: '#C68B66', hair: '#2B1E1A', top: '#E4604E', pants: '#3a3a44', shoe: '#EDE6DC', accent: '#E4604E' } });

/* ---------------------------------------------------------- items */
const G = 2400;
const ITEMS = {
  phone: { restY: -6, flat: 0.5, phys: { vy: -760, land: -12, rest: 10, rot: 0.2, spins: 1 },
    phases: [[0, 'hand', 'girl', 0, { x: 6, y: -18, r: 0 }, 0], [T_IMP + 0.02, 'phys'], [32.2, 'hand', 'boy', 0, { x: 8, y: -14, r: 0 }, 0.25], [45.25, 'hand', 'girl', 0, { x: 8, y: -16, r: 0 }, 0.3]] },
  box: { restY: -14, flat: 0.85, phys: { vy: -250, land: 55, rest: 70, rot: 0.04, spins: 0 },
    phases: [[0, 'hand', 'girl', 1, { x: 12, y: 4, r: 0, back: true }, 0], [T_IMP + 0.02, 'phys'], [24.9, 'hand', 'girl', 1, { x: 10, y: -4, r: 0 }, 0.2]] },
  juice: { restY: -11, flat: 1, phys: { vy: -430, land: 18, rest: 34, rot: Math.PI / 2, spins: 1 },
    phases: [[0, 'on', 'box', { x: 6, y: -27, r: 0 }, 0], [T_IMP + 0.02, 'phys'], [26.3, 'hand', 'girl', 0, { x: 6, y: -6, r: 0 }, 0.2], [26.9, 'on', 'box', { x: 14, y: -28, r: 0 }, 0.25]] },
  notebook: { restY: -5, flat: 0.42, phys: { vy: -420, land: -4, rest: -14, rot: -0.1, spins: 1 },
    phases: [[0, 'hidden'], [T_IMP + 0.02, 'phys'], [27.8, 'hand', 'boy', 1, { x: 14, y: -2, r: -0.2 }, 0.2], [29.85, 'hand', 'girl', 0, { x: 10, y: -2, r: 0.15 }, 0.25], [30.35, 'on', 'box', { x: -2, y: 24, r: 0.05 }, 0.3]] },
  pencil: { restY: -3, flat: 1, phys: { vy: -600, land: -30, rest: -48, rot: 0.3, spins: 2 },
    phases: [[0, 'hidden'], [T_IMP + 0.02, 'phys'], [27.0, 'hand', 'boy', 0, { x: 10, y: -6, r: -0.6 }, 0.2], [28.25, 'on', 'notebook', { x: 0, y: -9, r: 0.1 }, 0.25]] },
};
const ITEM_ORDER = ['box', 'juice', 'notebook', 'pencil', 'phone'];
let impactScene = null;
function physInit(id) {
  const it = ITEMS[id];
  if (it.k) return it.k;
  if (!impactScene) impactScene = sceneAt(T_IMP + 0.019, true);
  const prev = it.phases[0];
  let p0;
  if (prev[1] === 'hidden') p0 = { x: impactScene.girl.x + 34, y: -236, rot: 0 };
  else p0 = evalPhase(id, prev, T_IMP + 0.019, impactScene);
  const P = it.phys, y0 = p0.y, yr = it.restY;
  const T1 = (-P.vy + Math.sqrt(P.vy * P.vy + 2 * G * (yr - y0))) / G;
  const vx1 = (P.land - p0.x) / T1;
  const vImp = P.vy + G * T1, vy2 = -0.22 * vImp, T2 = 2 * -vy2 / G;
  const vx2 = (P.rest - P.land) / T2;
  const rotEnd = P.rot + P.spins * TAU * (vx1 >= 0 ? 1 : -1);
  it.k = { p0, T1, T2, vx1, vx2, vy2, rotEnd, land1: filmOf(T_IMP + 0.02 + T1), land2: filmOf(T_IMP + 0.02 + T1 + T2) };
  return it.k;
}
function evalPhase(id, ph, t, S) {
  const it = ITEMS[id];
  const kind = ph[1];
  if (kind === 'hidden') return { x: S.girl.x + 34, y: -236, rot: 0, flat: 1, hidden: true };
  if (kind === 'hand') {
    const who = ph[2] === 'boy' ? S.R.boy : S.R.girl, st = ph[2] === 'boy' ? S.boy : S.girl;
    const hp = who.handW[ph[3]], sg = st.face >= 0 ? 1 : -1, sz = ph[2] === 'boy' ? CH_BOY.size : CH_GIRL.size;
    return { x: hp.x + ph[4].x * sg * sz, y: hp.y + ph[4].y * sz, rot: ph[4].r * sg, flat: 1, back: !!ph[4].back };
  }
  if (kind === 'on') {
    const par = itemPose(ph[2], t, S);
    const cr = Math.cos(par.rot), sr = Math.sin(par.rot);
    return { x: par.x + ph[3].x * cr - ph[3].y * sr, y: par.y + ph[3].x * sr + ph[3].y * cr, rot: par.rot + ph[3].r, flat: 1, back: par.back };
  }
  const k = physInit(id), P = it.phys;
  const tau = story(t) - (T_IMP + 0.02);
  if (tau <= 0) return { x: k.p0.x, y: k.p0.y, rot: k.p0.rot || 0, flat: 1 };
  const total = k.T1 + k.T2;
  let x, y;
  if (tau < k.T1) { x = k.p0.x + k.vx1 * tau; y = k.p0.y + P.vy * tau + 0.5 * G * tau * tau; }
  else if (tau < total) { const u = tau - k.T1; x = P.land + k.vx2 * u; y = it.restY + k.vy2 * u + 0.5 * G * u * u; }
  else { x = P.rest; y = it.restY; }
  const rot = tau < total ? lerp(k.p0.rot || 0, k.rotEnd, EASE.out(tau / total)) : k.rotEnd;
  const flat = lerp(1, it.flat, smooth(clamp((tau - k.T1 * 0.75) / (total - k.T1 * 0.75 + 0.05))));
  return { x, y: Math.min(y, it.restY), rot, flat };
}
function itemPose(id, t, S) {
  const ph = ITEMS[id].phases;
  let i = 0;
  while (i + 1 < ph.length && ph[i + 1][0] <= t) i++;
  const cur = evalPhase(id, ph[i], t, S);
  const bl = ph[i][ph[i].length - 1];
  if (i > 0 && typeof bl === 'number' && bl > 0 && t - ph[i][0] < bl) {
    const prev = evalPhase(id, ph[i - 1], t, S), u = EASE.io((t - ph[i][0]) / bl);
    return { x: lerp(prev.x, cur.x, u), y: lerp(prev.y, cur.y, u), rot: lerp(prev.rot, cur.rot, u), flat: lerp(prev.flat, cur.flat, u), back: cur.back, hidden: cur.hidden };
  }
  return cur;
}
function drawItem(c, id, p, t) {
  c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, p.flat);
  if (id === 'phone') {
    const front = t < T_IMP;
    c.fillStyle = front ? '#2A2A34' : '#C9B8E6'; rr(c, -13, -24, 26, 48, 6); c.fill();
    if (front) {
      c.fillStyle = '#EEF3FF'; rr(c, -11, -21, 22, 41, 4); c.fill();
      c.fillStyle = '#D5DAE8'; rr(c, -9, -17, 13, 5, 2.5); c.fill();
      c.fillStyle = '#B7A6D9'; rr(c, -3, -9, 12, 5, 2.5); c.fill();
      c.fillStyle = '#D5DAE8'; rr(c, -9, -1, 15, 5, 2.5); c.fill();
      c.fillStyle = '#F2A488'; circ(c, 5, 8, 2.6); c.fill();
    } else {
      c.fillStyle = '#F0B64A'; c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3 : 7; c.lineTo(4 + Math.cos(a) * r, 6 + Math.sin(a) * r); }
      c.closePath(); c.fill();
      c.fillStyle = '#2A2A34'; rr(c, -9, -20, 9, 12, 3); c.fill();
    }
  } else if (id === 'box') {
    c.fillStyle = '#F2D08A'; c.beginPath(); c.moveTo(-24, 14); c.lineTo(20, 14); c.lineTo(-2, -8); c.closePath(); c.fill();
    c.fillStyle = '#9CC56B'; rr(c, -22, 4, 40, 4, 2); c.fill();
    c.fillStyle = 'rgba(246,242,234,.72)'; rr(c, -32, -16, 64, 34, 6); c.fill();
    c.strokeStyle = 'rgba(160,150,140,.6)'; c.lineWidth = 2; rr(c, -32, -16, 64, 34, 6); c.stroke();
    c.fillStyle = '#8FCDBB'; rr(c, -34, -20, 68, 10, 4); c.fill();
  } else if (id === 'juice') {
    c.fillStyle = '#F59E5B'; c.fillRect(-11, -14, 22, 32);
    c.fillStyle = '#E88B48'; c.beginPath(); c.moveTo(-11, -14); c.lineTo(0, -22); c.lineTo(11, -14); c.closePath(); c.fill();
    c.fillStyle = '#FFF6EC'; circ(c, 0, 3, 6.5); c.fill();
    c.fillStyle = '#7FB069'; ell(c, 0, 3, 2.4, 4.4, 0.5); c.fill();
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(4, -18); c.lineTo(8, -30); c.stroke();
  } else if (id === 'notebook') {
    c.fillStyle = '#D98A8A'; rr(c, -24, -30, 48, 60, 3); c.fill();
    c.fillStyle = '#C47474'; c.fillRect(-24, -30, 7, 60);
    c.fillStyle = '#FFF6EC'; rr(c, -8, -16, 26, 12, 2); c.fill();
    c.strokeStyle = '#8E5A5A'; c.lineWidth = 2; c.beginPath(); c.moveTo(14, -30); c.lineTo(14, 30); c.stroke();
  } else if (id === 'pencil') {
    c.fillStyle = '#F4C542'; c.fillRect(-22, -3.5, 40, 7);
    c.fillStyle = '#E9C49A'; c.beginPath(); c.moveTo(18, -3.5); c.lineTo(28, 0); c.lineTo(18, 3.5); c.closePath(); c.fill();
    c.fillStyle = '#3A2E2A'; c.beginPath(); c.moveTo(25, -1); c.lineTo(28, 0); c.lineTo(25, 1); c.closePath(); c.fill();
    c.fillStyle = '#B8B8C0'; c.fillRect(-26, -3.5, 4, 7);
    c.fillStyle = '#F09AA8'; rr(c, -32, -3.5, 7, 7, 2); c.fill();
  }
  c.restore();
}

/* ---------------------------------------------------------- scene */
function sceneAt(t, noItems) {
  const boy = boyState(t), girl = girlState(t), fr = friendState(t);
  const R = { boy: rig(CH_BOY, boy), girl: rig(CH_GIRL, girl), fr: rig(CH_FRIEND, fr) };
  const S = { t, boy, girl, fr, R };
  if (!noItems) {
    S.items = {};
    for (const id of ITEM_ORDER) S.items[id] = itemPose(id, t, S);
  }
  return S;
}

/* -------------------------------------------------------- the set */
const WALL_S = 0.6;
const WIN_X = [-4200, -2800, -1400, 0, 1400, 2800, 4200];
function visRange(cam, s) { const k = cam.z * s; return [cam.fx - (W / 2 + 80) / k, cam.fx + (W / 2 + 80) / k, cam.fy - (H / 2 + 80) / k, cam.fy + (H / 2 + 80) / k]; }
function drawWindow(c, X, t) {
  const L = X - 270, R = X + 270, B = -520, T = -1400, rad = 270;
  const path = () => { c.beginPath(); c.moveTo(L, B); c.lineTo(L, T); c.arc(X, T, rad, Math.PI, 0); c.lineTo(R, B); c.closePath(); };
  const glow = c.createRadialGradient(X, -1000, 100, X, -1000, 900);
  glow.addColorStop(0, 'rgba(255,236,196,.55)'); glow.addColorStop(1, 'rgba(255,236,196,0)');
  c.fillStyle = glow; c.fillRect(X - 900, -1900, 1800, 1500);
  c.save(); path(); c.clip();
  const g = c.createLinearGradient(0, T - rad, 0, B);
  g.addColorStop(0, '#A3C9E2'); g.addColorStop(0.5, '#F7D8A8'); g.addColorStop(1, '#FCEBCB');
  c.fillStyle = g; c.fillRect(L, T - rad, R - L, B - T + rad);
  const sg = c.createRadialGradient(X + 140, -1180, 0, X + 140, -1180, 420);
  sg.addColorStop(0, 'rgba(255,248,222,1)'); sg.addColorStop(1, 'rgba(255,248,222,0)');
  c.fillStyle = sg; c.fillRect(L, T - rad, R - L, B - T + rad);
  c.fillStyle = '#EACBA6'; c.fillRect(X - 230, -900, 170, 380); c.fillRect(X - 50, -830, 150, 310);
  c.fillStyle = '#DDB48C';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) c.fillRect(X - 215 + i * 38, -880 + j * 64, 20, 30);
  const sw = Math.sin(t * 0.9 + X) * 6;
  c.fillStyle = '#A9C088';
  circ(c, X + 150 + sw, -650, 120); c.fill(); circ(c, X + 30 + sw * 0.7, -600, 95); c.fill(); circ(c, X - 210 + sw * 0.8, -610, 105); c.fill();
  c.fillStyle = '#8FAD73';
  circ(c, X + 200 + sw, -590, 90); c.fill(); circ(c, X - 150 + sw * 0.8, -560, 80); c.fill();
  c.fillStyle = '#C9D9A8'; c.fillRect(L, -560, R - L, 60);
  c.restore();
  c.strokeStyle = '#FFF7EC'; c.lineWidth = 26; path(); c.stroke();
  c.lineWidth = 12; c.beginPath(); c.moveTo(X, B); c.lineTo(X, T - rad); c.moveTo(L, -1000); c.lineTo(R, -1000); c.stroke();
  c.fillStyle = 'rgba(120,80,40,.14)'; c.fillRect(L - 36, B + 16, R - L + 72, 26);
  c.fillStyle = '#FFF3E2'; rr(c, L - 40, B - 8, R - L + 80, 26, 6); c.fill();
}
function drawWall(c, cam, t) {
  camT(c, cam, WALL_S);
  const [x0, x1, y0] = visRange(cam, WALL_S);
  const w = x1 - x0;
  c.fillStyle = '#E8C391'; c.fillRect(x0, Math.min(y0, -4000), w, 4000 - 2500 + 10);
  let g = c.createLinearGradient(0, -2500, 0, -440);
  g.addColorStop(0, '#F8E1B6'); g.addColorStop(1, '#F2CB93');
  c.fillStyle = g; c.fillRect(x0, -2500, w, 2080);
  c.fillStyle = '#F6EADB'; c.fillRect(x0, -2520, w, 40);
  c.fillStyle = '#8CC1AE'; c.fillRect(x0, -432, w, 410);
  c.strokeStyle = '#7AAE9A'; c.lineWidth = 3; c.beginPath();
  for (let y = -382; y < -22; y += 50) { c.moveTo(x0, y); c.lineTo(x1, y); }
  for (let r = 0; r < 8; r++) {
    const ya = -432 + r * 50, off = (r % 2) * 50;
    for (let x = Math.floor((x0 - off) / 100) * 100 + off; x < x1; x += 100) { c.moveTo(x, ya); c.lineTo(x, ya + 50); }
  }
  c.stroke();
  c.fillStyle = '#F4ECDD'; c.fillRect(x0, -452, w, 22);
  c.fillStyle = 'rgba(120,80,40,.15)'; c.fillRect(x0, -430, w, 8);
  c.fillStyle = '#3C6E66'; c.fillRect(x0, -34, w, 36);
  for (const X of WIN_X) if (X > x0 - 900 && X < x1 + 900) drawWindow(c, X, t);
  // menu board
  if (-700 > x0 - 400 && -700 < x1 + 400) {
    c.fillStyle = '#B98A5E'; rr(c, -975, -1470, 550, 460, 14); c.fill();
    c.fillStyle = '#34443F'; rr(c, -955, -1450, 510, 420, 8); c.fill();
    c.fillStyle = '#F2EBDD'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = '700 40px Figtree, sans-serif'; c.fillText("TODAY'S MENU", -700, -1380);
    c.fillStyle = '#F0B64A'; c.fillRect(-800, -1362, 200, 4);
    c.font = '500 30px Figtree, sans-serif';
    const menu = [['Chai', '40'], ['Samosa', '30'], ['Chicken biryani', '220'], ['Veg sandwich', '120'], ['Fresh juice', '90']];
    menu.forEach((m, i) => {
      c.fillStyle = '#F2EBDD'; c.textAlign = 'left'; c.fillText(m[0], -915, -1310 + i * 56);
      c.textAlign = 'right'; c.fillText(m[1], -485, -1310 + i * 56);
      c.fillStyle = 'rgba(242,235,221,.3)'; c.fillRect(-915, -1302 + i * 56, 430, 2);
    });
  }
  // notice board
  if (700 > x0 - 400 && 700 < x1 + 400) {
    c.fillStyle = '#A97C52'; rr(c, 430, -1400, 540, 400, 10); c.fill();
    c.fillStyle = '#D6A874'; rr(c, 446, -1384, 508, 368, 6); c.fill();
    const notes = [[490, -1350, 150, 120, '#FFF6EC', -0.05, 'CODING CLUB', 'Thu 5 pm'], [665, -1360, 130, 150, '#B7A6D9', 0.04, 'LOST', 'blue umbrella'], [820, -1330, 110, 110, '#F0B64A', -0.03, 'EXAM', 'week 10'], [510, -1190, 170, 140, '#8FCDBB', 0.03, 'BOOK SWAP', 'library, Sat'], [720, -1160, 200, 120, '#FFF6EC', -0.04, 'FIND A', 'study buddy']];
    for (const n of notes) {
      c.save(); c.translate(n[0] + n[2] / 2, n[1] + n[3] / 2); c.rotate(n[5]);
      c.fillStyle = 'rgba(80,50,30,.18)'; c.fillRect(-n[2] / 2 + 6, -n[3] / 2 + 8, n[2], n[3]);
      c.fillStyle = n[4]; c.fillRect(-n[2] / 2, -n[3] / 2, n[2], n[3]);
      c.fillStyle = '#E4604E'; circ(c, 0, -n[3] / 2 + 12, 7); c.fill();
      c.fillStyle = '#4A3A34'; c.textAlign = 'center'; c.font = '700 20px Figtree, sans-serif'; c.fillText(n[6], 0, -2);
      c.font = '500 18px Figtree, sans-serif'; c.fillText(n[7], 0, 26);
      c.restore();
    }
  }
  // clock showing 1:05, second hand ticking
  if (2100 > x0 - 200 && 2100 < x1 + 200) {
    c.save(); c.translate(2100, -1260);
    c.fillStyle = '#3C6E66'; circ(c, 0, 0, 104); c.fill();
    c.fillStyle = '#FFF9F0'; circ(c, 0, 0, 90); c.fill();
    c.strokeStyle = '#3C3230'; c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; c.lineWidth = i % 3 ? 3 : 6; c.beginPath(); c.moveTo(Math.sin(a) * 70, -Math.cos(a) * 70); c.lineTo(Math.sin(a) * 82, -Math.cos(a) * 82); c.stroke(); }
    const mins = 5 + t / 60, hrs = 1 + mins / 60;
    c.lineWidth = 9; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(hrs / 12 * TAU) * 44, -Math.cos(hrs / 12 * TAU) * 44); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(mins / 60 * TAU) * 66, -Math.cos(mins / 60 * TAU) * 66); c.stroke();
    const sa = Math.floor(t + 12) / 60 * TAU;
    c.strokeStyle = '#E4604E'; c.lineWidth = 3; c.beginPath(); c.moveTo(-Math.sin(sa) * 14, Math.cos(sa) * 14); c.lineTo(Math.sin(sa) * 76, -Math.cos(sa) * 76); c.stroke();
    c.fillStyle = '#E4604E'; circ(c, 0, 0, 7); c.fill();
    c.restore();
  }
  // posters
  const poster = (X, Y, w, h, bgc, fg, l1, l2, rot) => {
    if (X < x0 - 500 || X > x1 + 500) return;
    c.save(); c.translate(X, Y); c.rotate(rot);
    c.fillStyle = 'rgba(80,50,30,.16)'; c.fillRect(-w / 2 + 8, -h / 2 + 10, w, h);
    c.fillStyle = bgc; c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = fg; c.textAlign = 'center';
    c.font = '800 46px Figtree, sans-serif'; c.fillText(l1, 0, -h / 2 + 90);
    c.font = '600 26px Figtree, sans-serif'; c.fillText(l2, 0, -h / 2 + 136);
    c.globalAlpha = 0.9; circ(c, 0, h / 2 - 110, 60); c.fill(); c.globalAlpha = 1;
    c.restore();
  };
  poster(-2100, -1120, 330, 440, '#E4604E', '#FFF3E2', 'SPRING', 'FEST · FRI 6 PM', -0.03);
  poster(3500, -1100, 320, 420, '#3E9C8E', '#FFF3E2', 'LIBRARY', 'open till 10 pm', 0.025);
  poster(-4900, -1100, 320, 420, '#B7A6D9', '#34443F', 'OPEN MIC', 'wed · main hall', 0.02);
  // canteen sign
  if (-3500 > x0 - 800 && -3500 < x1 + 800) {
    c.fillStyle = '#E4604E'; c.textAlign = 'center'; c.font = '800 150px Figtree, sans-serif';
    c.fillText('CANTEEN', -3500, -1790);
    c.fillStyle = '#3C6E66'; c.font = '600 44px Figtree, sans-serif'; c.fillText('est. 1987 · since the first exam', -3500, -1720);
  }
  // bunting
  c.save();
  for (let h = -6300; h < 6300; h += 900) {
    if (h + 900 < x0 || h > x1) continue;
    c.strokeStyle = '#8A6A55'; c.lineWidth = 3; c.beginPath();
    for (let u = 0; u <= 1.001; u += 0.05) { const x = h + u * 900, y = -2000 + 130 * 4 * u * (1 - u); u ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    const cols = ['#EFA33A', '#E4604E', '#3E9C8E', '#B7A6D9', '#FFF3E2'];
    for (let j = 1; j < 12; j++) {
      const u = j / 12, x = h + u * 900, y = -2000 + 130 * 4 * u * (1 - u);
      c.save(); c.translate(x, y); c.rotate(Math.sin(t * 1.4 + h * 0.01 + j) * 0.08);
      c.fillStyle = cols[((j + Math.round(h / 900)) % 5 + 5) % 5];
      c.beginPath(); c.moveTo(-26, 0); c.lineTo(26, 0); c.lineTo(0, 62); c.closePath(); c.fill();
      c.restore();
    }
  }
  c.restore();
  // big potted plant
  const plant = X => {
    if (X < x0 - 400 || X > x1 + 400) return;
    c.fillStyle = '#6E9A63';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.28 + Math.sin(t * 0.8 + i) * 0.02;
      c.save(); c.translate(X, -300); c.rotate(a + Math.PI / 2);
      ell(c, 0, -170, 60, 150); c.fill(); c.restore();
    }
    c.fillStyle = '#C8724E'; c.beginPath(); c.moveTo(X - 110, -320); c.lineTo(X + 110, -320); c.lineTo(X + 85, 0); c.lineTo(X - 85, 0); c.closePath(); c.fill();
    c.fillStyle = '#B5623F'; c.fillRect(X - 116, -330, 232, 34);
  };
  plant(-1060); plant(3900); plant(-5400);
}
function drawFloor(c, cam, t) {
  c.setTransform(Q, 0, 0, Q, 0, 0); c.translate(W / 2 + cam.sx, H / 2 + cam.sy); if (cam.rot) c.rotate(cam.rot);
  const z = cam.z, fy = cam.fy, fx = cam.fx;
  if (fy >= -1) return;
  const syOf = s => (-fy) * z * s;
  const y0 = syOf(WALL_S);
  if (y0 > H / 2 + 60) return;
  const sMax = (H / 2 + 80) / ((-fy) * z);
  const g = c.createLinearGradient(0, y0, 0, H / 2 + 80);
  g.addColorStop(0, '#CFB28C'); g.addColorStop(1, '#EBDABF');
  c.fillStyle = g; c.fillRect(-W, y0 - 1, W * 2, H);
  const TS = 170, rows = [];
  for (let u = 1 / WALL_S; u > 0.05; u -= 0.085) { const s = 1 / u; rows.push(s); if (s > sMax) break; }
  c.fillStyle = 'rgba(126,86,48,.11)'; c.beginPath();
  for (let j = 0; j < rows.length - 1; j++) {
    const sa = rows[j], sb = rows[j + 1], ya = syOf(sa), yb = syOf(sb);
    const xr = (W / 2 + 60) / (z * sa);
    const i0 = Math.floor((fx - xr) / TS), i1 = Math.ceil((fx + xr) / TS);
    for (let i = i0; i < i1; i++) {
      if (((i + j) & 1) === 0) continue;
      const X0 = i * TS - fx, X1 = X0 + TS;
      c.moveTo(X0 * z * sa, ya); c.lineTo(X1 * z * sa, ya); c.lineTo(X1 * z * sb, yb); c.lineTo(X0 * z * sb, yb); c.closePath();
    }
  }
  c.fill();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(255,214,150,.13)';
  for (const X of WIN_X) {
    const sa = 0.66, sb = 1.25, Xa = X + 180, Xb = X + 720;
    c.beginPath();
    c.moveTo((Xa - 230 - fx) * z * sa, syOf(sa)); c.lineTo((Xa + 230 - fx) * z * sa, syOf(sa));
    c.lineTo((Xb + 300 - fx) * z * sb, syOf(sb)); c.lineTo((Xb - 300 - fx) * z * sb, syOf(sb)); c.closePath(); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  const ao = c.createLinearGradient(0, y0, 0, y0 + 60 * z);
  ao.addColorStop(0, 'rgba(70,45,25,.28)'); ao.addColorStop(1, 'rgba(70,45,25,0)');
  c.fillStyle = ao; c.fillRect(-W, y0, W * 2, 60 * z);
}
function drawCounter(c, cam, t) {
  const s = 0.72;
  const [x0, x1] = visRange(cam, s);
  if (x1 < -4400 || x0 > -2800) return;
  camT(c, cam, 0.7);
  const ss = baseSt(-3560, 1); ss.t = t; ss.hN = [[0, Lp(60 + 10 * Math.sin(t * 2), 70), 0]]; ss.hF = [[0, Lp(56, 76), 0]];
  ss.e.smile = 0.5; ss.e.lx = 1; ss.e.blink = blinkAt(t, 3); ss.noShadow = true;
  ss.e.mouth = clamp((vnoise(t * 0.6, 7) + 0.1) * 3) * talkM(t, 4) * 0.7;
  drawChar(c, SERVER, ss, rig(SERVER, ss));
  camT(c, cam, s);
  c.fillStyle = 'rgba(70,45,25,.2)'; ell(c, -3600, 4, 760, 16); c.fill();
  c.fillStyle = '#E58A60'; c.fillRect(-4300, -300, 1400, 300);
  c.fillStyle = '#D77A52';
  for (let x = -4260; x < -2900; x += 70) c.fillRect(x, -270, 34, 250);
  c.fillStyle = '#F4EADB'; rr(c, -4330, -320, 1460, 30, 8); c.fill();
  c.fillStyle = 'rgba(220,240,245,.35)'; c.fillRect(-4050, -560, 700, 240);
  c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 6; c.strokeRect(-4050, -560, 700, 240);
  c.fillStyle = '#C8A06A'; rr(c, -4020, -360, 300, 40, 6); c.fill();
  c.fillStyle = '#D9A24E';
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-3995 + i * 56, -362); c.lineTo(-3955 + i * 56, -362); c.lineTo(-3975 + i * 56, -400); c.closePath(); c.fill(); }
  c.fillStyle = '#C8CDD2'; rr(c, -3280, -520, 140, 200, 20); c.fill();
  c.fillStyle = '#AEB4BB'; c.fillRect(-3280, -470, 140, 12);
  c.fillStyle = '#3C3230'; c.fillRect(-3150, -380, 26, 12);
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 8; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i / 3) % 1;
    c.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
    c.beginPath(); c.moveTo(-3230 + i * 20, -540 - ph * 160); c.quadraticCurveTo(-3200 + i * 20 + Math.sin(t * 2 + i) * 20, -600 - ph * 160, -3230 + i * 20, -660 - ph * 160); c.stroke();
  }
  c.globalAlpha = 1;
  c.fillStyle = '#EFE6D6'; for (let i = 0; i < 6; i++) { rr(c, -3620, -340 - i * 10, 180, 9, 3); c.fill(); }
}
function drawTable(c, X, front) {
  if (front) {
    c.fillStyle = '#9C7148'; c.fillRect(X - 240, -92, 16, 92); c.fillRect(X + 224, -92, 16, 92);
    c.fillStyle = '#B98A5E'; rr(c, X - 270, -106, 540, 16, 6); c.fill();
    return;
  }
  c.fillStyle = 'rgba(70,45,25,.18)'; ell(c, X, 2, 300, 12); c.fill();
  c.fillStyle = '#9C7148';
  c.fillRect(X - 236, -150, 20, 150); c.fillRect(X + 216, -150, 20, 150); c.fillRect(X - 236, -60, 472, 12);
  c.fillStyle = '#C49468'; rr(c, X - 300, -168, 600, 22, 8); c.fill();
  c.fillStyle = '#A97C52'; c.fillRect(X - 290, -148, 580, 5);
}
function tableProps(c, X, t, i) {
  const r = mulberry32(i * 31 + 7);
  const n = 2 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const x = X - 220 + r() * 440, kind = Math.floor(r() * 4);
    if (kind === 0) { c.fillStyle = '#FFF9F0'; ell(c, x, -170, 44, 8); c.fill(); c.fillStyle = '#E3B25C'; ell(c, x, -176, 24, 6); c.fill(); }
    else if (kind === 1) {
      c.fillStyle = ['#FFF3E2', '#8FCDBB', '#E4604E'][k % 3]; rr(c, x - 14, -206, 28, 38, 6); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 4; c.lineCap = 'round';
      const ph = (t * 0.6 + k * 0.3) % 1; c.globalAlpha = Math.sin(ph * Math.PI) * 0.7;
      c.beginPath(); c.moveTo(x, -214 - ph * 60); c.quadraticCurveTo(x + 10, -234 - ph * 60, x, -254 - ph * 60); c.stroke(); c.globalAlpha = 1;
    } else if (kind === 2) { c.fillStyle = '#5E6E96'; rr(c, x - 40, -180, 80, 12, 3); c.fill(); c.fillStyle = '#D98A8A'; rr(c, x - 34, -190, 70, 10, 3); c.fill(); }
    else { c.fillStyle = '#C9CED6'; c.beginPath(); c.moveTo(x - 40, -168); c.lineTo(x + 40, -168); c.lineTo(x + 30, -230); c.lineTo(x - 30, -230); c.closePath(); c.fill(); c.fillStyle = '#FFFFFF'; circ(c, x, -200, 5); c.fill(); }
  }
}
function drawLamps(c, cam, t) {
  const s = 0.9;
  camT(c, cam, s);
  const [x0, x1, y0] = visRange(cam, s);
  if (y0 > -1000) return;
  const cols = ['#3E9C8E', '#EFA33A', '#E4604E'];
  for (let X = -3150; X <= 3150; X += 900) {
    if (X < x0 - 300 || X > x1 + 300) continue;
    const sw = Math.sin(t * 0.7 + X) * 4;
    c.strokeStyle = '#5B4A3E'; c.lineWidth = 3; c.beginPath(); c.moveTo(X, -3400); c.lineTo(X + sw, -1180); c.stroke();
    const gl = c.createRadialGradient(X + sw, -1060, 10, X + sw, -1060, 360);
    gl.addColorStop(0, 'rgba(255,226,160,.45)'); gl.addColorStop(1, 'rgba(255,226,160,0)');
    c.globalCompositeOperation = 'lighter'; c.fillStyle = gl; c.fillRect(X - 400, -1450, 800, 800); c.globalCompositeOperation = 'source-over';
    c.fillStyle = cols[((X / 900) % 3 + 3) % 3];
    c.beginPath(); c.moveTo(X + sw - 76, -1080); c.quadraticCurveTo(X + sw - 70, -1178, X + sw, -1182); c.quadraticCurveTo(X + sw + 70, -1178, X + sw + 76, -1080); c.closePath(); c.fill();
    c.fillStyle = '#FFF1C9'; ell(c, X + sw, -1080, 30, 11); c.fill();
  }
}
function drawShafts(c, cam, t, amt) {
  screenT(c);
  c.globalCompositeOperation = 'screen';
  for (const X of WIN_X) {
    const k = cam.z * WALL_S;
    const sx = W / 2 + (X - cam.fx) * k, sy = H / 2 + (-1150 - cam.fy) * k;
    const hw = 250 * k;
    if (sx < -900 || sx > W + 400) continue;
    const g = c.createLinearGradient(sx, sy, sx + 700 * k, sy + 1400 * k);
    g.addColorStop(0, `rgba(255,222,165,${0.16 * amt})`); g.addColorStop(1, 'rgba(255,222,165,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(sx - hw, sy - 200 * k); c.lineTo(sx + hw, sy - 200 * k); c.lineTo(sx + hw + 1250 * k, sy + 1700 * k); c.lineTo(sx - hw + 700 * k, sy + 1700 * k); c.closePath(); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}
function drawBackground(c, cam, S) {
  const t = S.t;
  drawWall(c, cam, t);
  drawFloor(c, cam, t);
  drawCounter(c, cam, t);
  const [wx0, wx1] = visRange(cam, 0.72);
  camT(c, cam, 0.72);
  for (const o of WALKERS) {
    const st = walkerState(o, t);
    if (st.x < wx0 - 200 || st.x > wx1 + 200) continue;
    drawChar(c, o.C, st, rig(o.C, st));
    if (o.tray) { const R = rig(o.C, st), h = R.handW[0]; c.fillStyle = '#E4DCCB'; rr(c, h.x - 40 * o.f - 30, h.y - 12, 90, 10, 4); c.fill(); c.fillStyle = '#F2D08A'; ell(c, h.x - 12 * o.f, h.y - 20, 18, 9); c.fill(); }
  }
  const [x0, x1] = visRange(cam, 0.78);
  camT(c, cam, 0.79);
  for (const X of TABLES) { if (X < x0 - 400 || X > x1 + 400) continue; c.fillStyle = '#9C7148'; rr(c, X - 280, -100, 560, 14, 5); c.fill(); }
  camT(c, cam, 0.78);
  for (const o of SEATED) {
    if (o.x < x0 - 200 || o.x > x1 + 200) continue;
    const st = seatedState(o, t);
    drawChar(c, o.C, st, rig(o.C, st));
  }
  camT(c, cam, 0.82);
  TABLES.forEach((X, i) => { if (X < x0 - 400 || X > x1 + 400) return; drawTable(c, X, false); tableProps(c, X, t, i); });
  camT(c, cam, 0.86);
  for (const X of TABLES) { if (X < x0 - 400 || X > x1 + 400) continue; drawTable(c, X, true); }
  drawLamps(c, cam, t);
  drawShafts(c, cam, t, 1 - 0.5 * clamp(cam.dof));
  camT(c, cam, S.fr.s);
  drawChar(c, CH_FRIEND, S.fr, S.R.fr);
}

/* ----------------------------------------------------------- camera */
const headAtCache = {};
function headAt(who, t) {
  const key = who + t;
  if (!headAtCache[key]) headAtCache[key] = sceneAt(t, true).R[who].headW;
  return headAtCache[key];
}
const SHOTS = [
  [0, 3.0, S => ({ fx: -1650 + S.t * 45, fy: -340, z: 0.62 + S.t * 0.012, dof: 0 })],
  [3.0, 4.8, S => ({ fx: S.boy.x - 70 + (S.t - 3) * 20, fy: -305, z: 1.32, dof: 0.28, hand: 1 })],
  [4.8, 6.2, S => ({ fx: S.boy.x + 34, fy: -372, z: 2.55 + (S.t - 4.8) * 0.06, dof: 0.5, hand: 1.6 })],
  [6.2, 8.0, S => ({ fx: S.boy.x - 20, fy: -292, z: 1.22, dof: 0.22, hand: 1 })],
  [8.0, 11.6, S => ({ fx: S.girl.x - 110, fy: -310, z: 1.48 + (S.t - 8) * 0.035, dof: 0.3, hand: 0.5 })],
  [11.6, 14.0, S => ({ fx: S.girl.x - 46, fy: -340, z: 3.3 + (S.t - 11.6) * 0.1, dof: 0.72, hand: 0.5 })],
  [14.0, 15.4, S => ({ fx: (S.boy.x + S.girl.x) / 2, fy: -300, z: 0.95, dof: 0 })],
  [15.4, T_IMP, S => ({ fx: (S.boy.x + S.girl.x) / 2, fy: -330, z: 1.5 + (S.t - 15.4) * 0.3, dof: 0.3 })],
  [T_IMP, 18.4, S => ({ fx: 0, fy: -270, z: 1.42 + (S.t - T_IMP) * 0.08, dof: 0.25 })],
  [18.4, 22.2, S => ({ fx: 5, fy: -265, z: 1.28 + (S.t - 18.4) * 0.025, dof: 0.18, hand: 0.4 })],
  [22.2, 27.6, S => ({ fx: 95, fy: -180, z: 2.0 + (S.t - 22.2) * 0.03, dof: 0.45, hand: 0.5 })],
  [27.6, 31.0, S => ({ fx: 10, fy: -175, z: 1.78 + (S.t - 27.6) * 0.02, dof: 0.4, hand: 0.4 })],
  [31.0, 33.0, S => ({ fx: 16, fy: -64, z: 3.5 + (S.t - 31) * 0.08, dof: 0.8, hand: 0.3 })],
  [33.0, 35.6, S => { const h = headAt('girl', 33.9); return { fx: h.x - 30, fy: h.y + 8, z: 5.0 + (S.t - 33) * 0.1, dof: 1, hand: 0.25 }; }],
  [35.6, 38.2, S => { const h = headAt('boy', 36.2); return { fx: h.x + 30, fy: h.y + 8, z: 5.0 + (S.t - 35.6) * 0.1, dof: 1, hand: 0.25 }; }],
  [38.2, 43.0, S => { const a = headAt('girl', 40), b = headAt('boy', 40); return { fx: (a.x + b.x) / 2, fy: (a.y + b.y) / 2 + 34, z: 2.85 + (S.t - 38.2) * 0.09, dof: 0.95, hand: 0.25 }; }],
  [43.0, 46.6, S => ({ fx: 12, fy: -195, z: 2.0 + (S.t - 43) * 0.03, dof: 0.6, hand: 0.3 })],
  [46.6, 48.6, S => { const h = headAt('girl', 47.2); return { fx: h.x - 26, fy: h.y + 20, z: 4.2, dof: 0.9, hand: 0.3 }; }],
  [48.6, 49.9, S => { const h = headAt('boy', 49.0); return { fx: h.x + 26, fy: h.y + 20, z: 4.2, dof: 0.9, hand: 0.3 }; }],
  [49.9, 51.4, S => ({ fx: -690, fy: -300, z: 1.65, dof: 0.1, hand: 0.5 })],
  [51.4, 53.2, S => ({ fx: -5, fy: -330, z: 1.48, dof: 0.35, hand: 0.3 })],
  [53.2, 99, S => { const u = EASE.io(clamp((S.t - 53.2) / 6.3)); return { fx: lerp(-5, -110, u), fy: lerp(-330, -440, u), z: lerp(1.45, 0.72, u), dof: lerp(0.3, 0, u) }; }],
];
function cameraAt(t, S) {
  let shot = SHOTS[0];
  for (const s of SHOTS) if (t >= s[0]) shot = s;
  const cam = Object.assign({ sx: 0, sy: 0, rot: 0, hand: 0.6 }, shot[2](S));
  const h = cam.hand;
  cam.sx += vnoise(t * 0.7, 1) * 7 * h; cam.sy += vnoise(t * 0.6, 2) * 5 * h; cam.rot += vnoise(t * 0.5, 3) * 0.004 * h;
  if (t > T_IMP) {
    const amp = 26 * Math.exp(-(t - T_IMP) * 4);
    cam.sx += amp * vnoise(t * 30, 5); cam.sy += amp * vnoise(t * 30, 6);
  }
  cam.shotStart = shot[0];
  return cam;
}

/* ---------------------------------------------------------- effects */
function blurComposite(dst, dof) {
  const L = clamp(dof) * 4.6;
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.imageSmoothingEnabled = true; dst.imageSmoothingQuality = 'high';
  if (L < 0.03) { dst.drawImage(bg, 0, 0); return; }
  const n = Math.ceil(L);
  for (let i = 1; i <= n; i++) { const cx = chain[i].getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.clearRect(0, 0, chain[i].width, chain[i].height); cx.drawImage(chain[i - 1], 0, 0, chain[i].width, chain[i].height); }
  const upsample = lvl => {
    let src = chain[lvl];
    for (let i = lvl - 1; i >= 1; i--) { const ux = up[i].getContext('2d'); ux.imageSmoothingQuality = 'high'; ux.clearRect(0, 0, up[i].width, up[i].height); ux.drawImage(src, 0, 0, up[i].width, up[i].height); src = up[i]; }
    return src;
  };
  const lo = Math.floor(L), fr = L - lo;
  dst.drawImage(upsample(lo) || bg, 0, 0, CW, CH);
  if (fr > 0.01 && n > lo) { dst.globalAlpha = fr; dst.drawImage(upsample(n), 0, 0, CW, CH); dst.globalAlpha = 1; }
}
function bloom(c, amt) {
  if (amt <= 0.01) return;
  let src = canvas;
  for (const b of bloomC) { const x = b.getContext('2d'); x.clearRect(0, 0, b.width, b.height); x.drawImage(src, 0, 0, b.width, b.height); src = b; }
  for (let i = bloomC.length - 2; i >= 0; i--) { const x = bloomC[i].getContext('2d'); x.drawImage(bloomC[i + 1], 0, 0, bloomC[i].width, bloomC[i].height); }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'screen'; c.globalAlpha = amt;
  c.drawImage(bloomC[0], 0, 0, CW, CH);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
}
const BOKEH = (() => { const r = mulberry32(5); return Array.from({ length: 26 }, () => ({ x: r(), y: r(), rad: 30 + r() * 90, a: 0.25 + r() * 0.5, col: ['#FFD9A0', '#F7B7A3', '#FFF1D6', '#F2A488'][Math.floor(r() * 4)], sp: 0.2 + r() * 0.6 })); })();
function drawBokeh(c, t, cam, amt) {
  if (amt < 0.01) return;
  screenT(c);
  c.globalCompositeOperation = 'screen';
  for (const b of BOKEH) {
    const x = ((b.x * W * 1.3 - cam.fx * 0.4 * cam.z * 0.3 + t * 8 * b.sp) % (W * 1.3) + W * 1.3) % (W * 1.3) - W * 0.15;
    const y = b.y * H - Math.sin(t * 0.3 * b.sp + b.x * 9) * 30;
    const g = c.createRadialGradient(x, y, b.rad * 0.55, x, y, b.rad);
    g.addColorStop(0, rgba(b.col, 0.2 * b.a * amt)); g.addColorStop(0.85, rgba(b.col, 0.28 * b.a * amt)); g.addColorStop(1, rgba(b.col, 0));
    c.fillStyle = g; circ(c, x, y, b.rad); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}
const MOTES = (() => { const r = mulberry32(11); return Array.from({ length: 80 }, () => ({ x: r(), y: r(), s: 1 + r() * 2.6, v: 0.3 + r(), p: r() * 10 })); })();
function drawMotes(c, t, cam, slow) {
  screenT(c);
  c.globalCompositeOperation = 'lighter';
  const tt = t * (1 - 0.7 * slow);
  for (const m of MOTES) {
    const x = ((m.x * W * 1.2 + tt * 12 * m.v - cam.fx * cam.z * 0.25) % (W * 1.2) + W * 1.2) % (W * 1.2) - W * 0.1;
    const y = ((m.y * H - tt * 6 * m.v + Math.sin(tt * 0.8 + m.p) * 14) % H + H) % H;
    const a = 0.25 + 0.25 * Math.sin(t * 1.3 + m.p);
    c.fillStyle = `rgba(255,228,170,${a})`; circ(c, x, y, m.s); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}
function bang(c, x, y, sc, rot) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(sc, sc);
  c.fillStyle = '#FFF7EA'; c.beginPath();
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r = i % 2 ? 22 : 36; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath(); c.fill();
  c.fillStyle = '#E4604E'; rr(c, -5, -22, 10, 28, 5); c.fill(); circ(c, 0, 15, 5.5); c.fill();
  c.restore();
}
function drawFX(c, cam, S) {
  const t = S.t;
  camT(c, cam, 1);
  if (t > T_IMP && t < T_IMP + 0.9) {
    const u = (t - T_IMP) / 0.9, a = 1 - u;
    c.strokeStyle = `rgba(255,247,234,${a})`; c.lineWidth = 8 * a + 1;
    circ(c, 0, -300, 30 + 220 * EASE.out(u)); c.stroke();
    c.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const ang = i * TAU / 12 + 0.2, r0 = 70 + 200 * EASE.out(u), r1 = r0 + 60 * a;
      c.beginPath(); c.moveTo(Math.cos(ang) * r0, -300 + Math.sin(ang) * r0); c.lineTo(Math.cos(ang) * r1, -300 + Math.sin(ang) * r1); c.stroke();
    }
  }
  const pop = (t0, x, y, rot) => {
    const a = win(t, t0, 19.4, 0.3, 0.4);
    if (a <= 0) return;
    const sc = EASE.back(clamp((t - t0) / 0.3)) * a;
    bang(c, x, y, Math.max(0.01, sc * 1.2), rot);
  };
  const hb = S.R.boy.headW, hg = S.R.girl.headW;
  pop(16.95, hb.x - 20, hb.y - 110, -0.2);
  pop(17.1, hg.x + 20, hg.y - 105, 0.2);
}
function drawForeground(c, cam, S) {
  camT(c, cam, 1);
  const items = S.items;
  for (const [key, C] of [['boy', CH_BOY], ['girl', CH_GIRL]]) {
    for (const id of ITEM_ORDER) { const p = items[id]; if (p.back && !p.hidden && key === 'girl') drawItem(c, id, p, S.t); }
    drawChar(c, C, S[key], S.R[key]);
  }
  for (const id of ITEM_ORDER) {
    const p = items[id];
    if (p.hidden || p.back) continue;
    if (p.y > -60) { c.fillStyle = `rgba(70,40,25,${0.18 * clamp(1 + p.y / 60)})`; ell(c, p.x, 0, 24, 5); c.fill(); }
  }
  for (const id of ITEM_ORDER) { const p = items[id]; if (!p.hidden && !p.back) drawItem(c, id, p, S.t); }
}
function phoneGlow(c, cam, S) {
  const a = win(S.t, 8, T_IMP, 0.5, 0.05);
  if (a <= 0) return;
  camT(c, cam, 1);
  const h = S.R.girl.headW;
  const g = c.createRadialGradient(h.x - 20, h.y + 30, 0, h.x - 20, h.y + 30, 110);
  g.addColorStop(0, `rgba(210,225,255,${0.3 * a})`); g.addColorStop(1, 'rgba(210,225,255,0)');
  c.globalCompositeOperation = 'screen'; c.fillStyle = g; circ(c, h.x - 20, h.y + 30, 110); c.fill(); c.globalCompositeOperation = 'source-over';
}

const SUBS = [
  [23.2, 25.5, 'Oh, sorry! I didn’t mean to—'],
  [25.55, 27.4, 'sorry, sorry.'],
  [28.1, 30.6, 'It’s okay. Don’t worry.'],
  [43.6, 45.5, 'Here you go.'],
  [46.8, 48.4, 'Thank you.'],
  [50.0, 51.4, 'Hey! You coming?'],
];
const ENDLINES = [[54.6, 'It wasn’t a grand beginning.'], [56.2, 'Just a beautiful accident—'], [57.7, 'and the start of their story.']];
function spaced(c, text, x, y, sp) {
  let w = 0; for (const ch of text) w += c.measureText(ch).width + sp; w -= sp;
  let cx = x - w / 2;
  const al = c.textAlign; c.textAlign = 'left';
  for (const ch of text) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + sp; }
  c.textAlign = al;
}
function drawText(c, t, bars) {
  screenT(c);
  c.textBaseline = 'alphabetic';
  // title card
  const ta = win(t, 0.3, 2.45, 0.1, 0.55);
  if (ta > 0) {
    const grd = c.createLinearGradient(0, H * 0.18, 0, H * 0.62);
    grd.addColorStop(0, `rgba(40,20,10,${0.0})`); grd.addColorStop(0.5, `rgba(40,20,10,${0.28 * ta})`); grd.addColorStop(1, 'rgba(40,20,10,0)');
    c.fillStyle = grd; c.fillRect(0, H * 0.18, W, H * 0.44);
    c.font = '600 26px Figtree, sans-serif'; c.textAlign = 'center';
    c.fillStyle = `rgba(255,243,226,${0.9 * win(t, 0.3, 2.45, 0.5, 0.5)})`;
    spaced(c, 'A 60-SECOND SHORT', W / 2, H * 0.34, 9);
    const title = 'A Beautiful Accident';
    c.font = 'italic 600 150px "Cormorant Garamond", Georgia, serif';
    let total = 0; const ws = [...title].map(ch => { const w = c.measureText(ch).width; total += w; return w; });
    let x = W / 2 - total / 2;
    c.textAlign = 'left';
    [...title].forEach((ch, i) => {
      const a = win(t, 0.45 + i * 0.035, 2.45, 0.5, 0.55);
      c.save(); c.shadowColor = 'rgba(60,25,10,.45)'; c.shadowBlur = 30;
      c.fillStyle = `rgba(255,248,238,${a})`;
      c.fillText(ch, x, H * 0.47 + (1 - EASE.out(clamp((t - 0.45 - i * 0.035) / 0.7))) * 26);
      c.restore(); x += ws[i];
    });
    c.fillStyle = `rgba(242,164,136,${ta})`;
    c.fillRect(W / 2 - 60 * EASE.out(clamp((t - 0.8) / 0.8)), H * 0.52, 120 * EASE.out(clamp((t - 0.8) / 0.8)), 3);
  }
  // subtitles
  for (const [a, b, text] of SUBS) {
    const al = win(t, a, b, 0.12, 0.18);
    if (al <= 0) continue;
    c.font = '600 46px Figtree, sans-serif'; c.textAlign = 'center';
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 16; c.shadowOffsetY = 2;
    c.fillStyle = `rgba(255,250,244,${al})`;
    c.fillText(text, W / 2, H - 78 - bars * 0.5);
    c.restore();
  }
  // closing lines
  const endA = win(t, 54.4, 59.55, 0.6, 0.4);
  if (endA > 0) {
    const grd = c.createLinearGradient(0, 0, 0, H * 0.6);
    grd.addColorStop(0, `rgba(30,14,8,${0.5 * endA})`); grd.addColorStop(1, 'rgba(30,14,8,0)');
    c.fillStyle = grd; c.fillRect(0, 0, W, H * 0.6);
    c.textAlign = 'center';
    ENDLINES.forEach(([t0, text], i) => {
      const a = win(t, t0, 59.55, 0.9, 0.4);
      if (a <= 0) return;
      c.font = `italic ${i === 1 ? 600 : 500} ${i === 1 ? 76 : 62}px "Cormorant Garamond", Georgia, serif`;
      c.save(); c.shadowColor = 'rgba(40,15,5,.5)'; c.shadowBlur = 24;
      c.fillStyle = `rgba(255,246,234,${a})`;
      c.fillText(text, W / 2, H * 0.2 + i * 92 + (1 - EASE.out(clamp((t - t0) / 1.1))) * 18);
      c.restore();
    });
  }
}
function post(c, t, cam) {
  screenT(c);
  const warm = win(t, -1, 8.0, 0, 0.3), cool = win(t, 8.0, T_IMP, 0.3, 0.2), acc = win(t, T_IMP, 33, 0.2, 1.0);
  const rose = win(t, 33, 53.2, 1.2, 1.0), gold = win(t, 53.2, 99, 1.0, 0);
  c.globalCompositeOperation = 'soft-light';
  const grade = (col, a) => { if (a > 0.005) { c.globalAlpha = a; c.fillStyle = col; c.fillRect(0, 0, W, H); } };
  grade('#FF9A3C', 0.42 * warm); grade('#8C9CFF', 0.34 * cool); grade('#FF8FA0', 0.36 * rose); grade('#FFB347', 0.4 * gold); grade('#FFD2A8', 0.2 * acc);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'saturation';
  const desat = 0.18 * cool + 0.2 * win(t, T_IMP, 22.2, 0.1, 0.5);
  if (desat > 0.005) { c.globalAlpha = desat; c.fillStyle = '#808080'; c.fillRect(0, 0, W, H); }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  bloom(c, 0.16 + 0.22 * rose + 0.1 * warm);
  screenT(c);
  const leak = 0.14 + 0.2 * rose + 0.1 * gold;
  const lg = c.createRadialGradient(W * 0.12, -H * 0.1, 0, W * 0.12, -H * 0.1, W * 0.8);
  lg.addColorStop(0, `rgba(255,190,120,${leak})`); lg.addColorStop(1, 'rgba(255,190,120,0)');
  c.globalCompositeOperation = 'screen'; c.fillStyle = lg; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over';
  const vg = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  vg.addColorStop(0, 'rgba(25,10,5,0)'); vg.addColorStop(1, `rgba(25,10,5,${0.42 + 0.22 * rose})`);
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
  const gt = grainTile();
  c.globalAlpha = 0.07; c.globalCompositeOperation = 'overlay';
  const fr = Math.floor(t * 24), ox = hash(fr) * 256, oy = hash(fr + 7) * 256;
  c.fillStyle = c.createPattern(gt, 'repeat');
  c.save(); c.translate(-ox, -oy); c.fillRect(0, 0, W + 256, H + 256); c.restore();
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  const flash = t > T_IMP ? Math.exp(-(t - T_IMP) * 9) * 0.55 : 0;
  if (flash > 0.01) { c.fillStyle = `rgba(255,250,240,${flash})`; c.fillRect(0, 0, W, H); }
}
function barsAt(t) { return 118 * EASE.io(win(t, 33.0, 43.0, 1.0, 1.4)); }

/* ------------------------------------------------------------ frame */
function draw(t) {
  t = clamp(t, 0, DUR);
  const S = sceneAt(t);
  const cam = cameraAt(t, S);
  bgx.setTransform(1, 0, 0, 1, 0, 0);
  bgx.fillStyle = '#F2CB93'; bgx.fillRect(0, 0, CW, CH);
  drawBackground(bgx, cam, S);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  blurComposite(ctx, cam.dof);
  drawBokeh(ctx, t, cam, win(t, 33.0, 53.2, 1.0, 1.2) * (0.6 + 0.4 * clamp(cam.dof)));
  drawForeground(ctx, cam, S);
  phoneGlow(ctx, cam, S);
  drawFX(ctx, cam, S);
  drawMotes(ctx, t, cam, win(t, 33, 43, 1, 1));
  post(ctx, t, cam);
  const bars = barsAt(t);
  screenT(ctx);
  if (bars > 0.5) { ctx.fillStyle = '#0B0706'; ctx.fillRect(0, 0, W, bars); ctx.fillRect(0, H - bars, W, bars); }
  const fadeIn = 1 - clamp(t / 0.7), fadeOut = clamp((t - 58.7) / 0.9);
  const dark = Math.max(fadeIn, fadeOut);
  if (dark > 0.001) { ctx.fillStyle = `rgba(11,7,6,${dark})`; ctx.fillRect(0, 0, W, H); }
  drawText(ctx, t, bars);
  if (t > 59.55) { screenT(ctx); ctx.fillStyle = `rgba(11,7,6,${clamp((t - 59.55) / 0.4)})`; ctx.fillRect(0, 0, W, H); }
}

/* ------------------------------------------------------------ audio */
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function buildAudio(ac, out, t0, a0) {
  const A = { ac };
  const sr = ac.sampleRate;
  const nb = ac.createBuffer(1, sr * 2, sr); { const d = nb.getChannelData(0), r = mulberry32(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const bb = ac.createBuffer(1, sr * 4, sr); { const d = bb.getChannelData(0), r = mulberry32(8); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }
  const ir = ac.createBuffer(2, Math.floor(sr * 2.6), sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch), r = mulberry32(20 + ch); for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
  const master = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
  master.connect(comp); comp.connect(out);
  const rev = ac.createConvolver(); rev.buffer = ir;
  const revOut = ac.createGain(); revOut.gain.value = 0.55; rev.connect(revOut); revOut.connect(master);
  const music = ac.createGain(), musicLP = ac.createBiquadFilter();
  musicLP.type = 'lowpass'; music.connect(musicLP); musicLP.connect(master);
  const mSend = ac.createGain(); mSend.gain.value = 0.4; musicLP.connect(mSend); mSend.connect(rev);
  const amb = ac.createGain(), ambLP = ac.createBiquadFilter(); ambLP.type = 'lowpass'; ambLP.frequency.value = 3000;
  amb.connect(ambLP); ambLP.connect(master);
  const aSend = ac.createGain(); aSend.gain.value = 0.35; ambLP.connect(aSend); aSend.connect(rev);
  const sfx = ac.createGain(); sfx.gain.value = 1; sfx.connect(master);
  const sSend = ac.createGain(); sSend.gain.value = 0.25; sfx.connect(sSend); sSend.connect(rev);
  const at = ft => a0 + (ft - t0);
  function automate(p, keys) {
    const v0 = tk(keys.map(k => [k[0], k[1], 'lin']))(t0);
    p.setValueAtTime(v0, a0);
    for (const [kt, kv] of keys) if (kt > t0) p.linearRampToValueAtTime(kv, at(kt));
  }
  automate(master.gain, [[0, 0.0], [0.4, 0.9], [59.2, 0.9], [60, 0]]);
  automate(music.gain, [[0, 0.8], [7.85, 0.8], [8.3, 0.5], [15.9, 0.5], [16.03, 0], [33, 0], [34.2, 0.85], [58.6, 0.9], [60, 0]]);
  automate(musicLP.frequency, [[0, 14000], [7.9, 14000], [8.5, 2400], [16, 2400], [32, 9000]]);
  automate(amb.gain, [[0, 0.9], [16.0, 0.9], [16.5, 0.45], [33.0, 0.4], [34.8, 0.1], [43, 0.1], [44.5, 0.3], [53, 0.42], [59, 0.3], [60, 0]]);
  // continuous beds
  const room = ac.createBufferSource(); room.buffer = bb; room.loop = true;
  const roomLP = ac.createBiquadFilter(); roomLP.type = 'lowpass'; roomLP.frequency.value = 500;
  const roomG = ac.createGain(); roomG.gain.value = 0.3;
  room.connect(roomLP); roomLP.connect(roomG); roomG.connect(amb);
  const bab = ac.createBufferSource(); bab.buffer = nb; bab.loop = true;
  const voices = [];
  const vr = mulberry32(31);
  for (let v = 0; v < 6; v++) {
    const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.value = 500;
    const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 1600;
    const g = ac.createGain(); g.gain.value = 0.0001;
    const g2 = ac.createGain(); g2.gain.value = 0.55;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    bab.connect(f1); bab.connect(f2); f1.connect(g); f2.connect(g2); g2.connect(g);
    if (pan) { pan.pan.value = -0.8 + v * 0.32 + (vr() - 0.5) * 0.1; g.connect(pan); pan.connect(amb); } else g.connect(amb);
    voices.push({ f1, f2, g, base: 0.8 + vr() * 0.5 });
  }
  const startAt = Math.max(a0, ac.currentTime);
  room.start(startAt); bab.start(startAt);
  const sources = [room, bab];

  const EV = [];
  const ev = (t, fn) => EV.push([t, fn]);
  const noiseSrc = (when, dur) => { const s = ac.createBufferSource(); s.buffer = nb; s.start(when, hash(when * 13.7) * 1.5, dur + 0.05); return s; };
  const tone = (dest, when, f, vel, dec, type = 'sine', f2) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, when);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, when + dec * 0.5);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel, when + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    o.connect(g); g.connect(dest); o.start(when); o.stop(when + dec + 0.05);
  };
  const nhit = (dest, when, type, f, Q, vel, dec) => {
    const s = noiseSrc(when, dec); const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = Q;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel, when + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    s.connect(fl); fl.connect(g); g.connect(dest);
  };
  const uke = (when, m, vel) => {
    const f = mtof(m);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(Math.min(f * 9, 12000), when); lp.frequency.exponentialRampToValueAtTime(f * 1.6, when + 0.35);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel, when + 0.004); g.gain.exponentialRampToValueAtTime(vel * 0.25, when + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
    const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.004;
    const g2 = ac.createGain(); g2.gain.value = 0.3;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(music);
    o1.start(when); o2.start(when); o1.stop(when + 1.3); o2.stop(when + 1.3);
  };
  const piano = (when, m, vel, dur = 2.6) => {
    const f = mtof(m);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(4600, f * 7);
    lp.connect(music);
    const dl = dur * (1.3 - clamp((m - 40) / 60) * 0.6);
    [[1, 1], [2, 0.42], [3, 0.16], [4, 0.07]].forEach(([h, a]) => {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * h * (1 + (h - 1) * 0.0009);
      const g = ac.createGain(); const end = when + dl / (h * 0.7 + 0.3);
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel * a, when + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g); g.connect(lp); o.start(when); o.stop(end + 0.05);
    });
  };
  const glock = (when, m, vel, dest = music) => {
    const f = mtof(m);
    [[1, 1, 1.8], [2.76, 0.25, 0.6], [5.4, 0.08, 0.25]].forEach(([h, a, d]) => tone(dest, when, f * h, vel * a, d));
  };
  const pad = (when, ms, dur, vel) => {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.6;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(vel, when + 0.9); g.gain.setValueAtTime(vel, when + dur); g.gain.linearRampToValueAtTime(0.0001, when + dur + 1.0);
    lp.connect(g); g.connect(music);
    for (const m of ms) for (const d of [-6, 6]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d;
      const og = ac.createGain(); og.gain.value = 0.18; o.connect(og); og.connect(lp); o.start(when); o.stop(when + dur + 1.1);
    }
  };
  const bass = (when, m, dur, vel) => {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.connect(music);
    for (const [type, a] of [['sine', 1], ['triangle', 0.5]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(m);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel * a, when + 0.01); g.gain.exponentialRampToValueAtTime(vel * a * 0.4, when + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(lp); o.start(when); o.stop(when + dur + 0.05);
    }
  };
  // Part A: bright ukulele groove (0–8), softening for the girl (8–16)
  const CH_A = [[67, 60, 64, 72], [67, 62, 67, 71], [69, 60, 64, 69], [69, 60, 65, 69]];
  const BASS_A = [48, 43, 45, 41];
  for (let bar = 0; bar < 8; bar++) {
    const b0 = bar * 2, ch = CH_A[bar % 4], full = bar < 4;
    if (full) {
      for (const [e8, dir, vel] of [[0, 'D', 0.15], [2, 'D', 0.11], [3, 'U', 0.07], [5, 'U', 0.07], [6, 'D', 0.11], [7, 'U', 0.07]]) {
        const tt = b0 + e8 * 0.25, notes = dir === 'D' ? ch : ch.slice().reverse();
        notes.forEach((m, i) => ev(tt + i * 0.012, w => uke(w, m, vel * (1 - i * 0.08))));
      }
      ev(b0, w => tone(music, w, 140, 0.7, 0.35, 'sine', 48));
      ev(b0 + 1, w => tone(music, w, 140, 0.6, 0.35, 'sine', 48));
      if (bar % 2) ev(b0 + 1.75, w => tone(music, w, 140, 0.45, 0.3, 'sine', 48));
      ev(b0 + 0.5, w => { nhit(music, w, 'bandpass', 2000, 1.4, 0.35, 0.08); nhit(music, w + 0.012, 'bandpass', 2600, 1.2, 0.2, 0.06); });
      ev(b0 + 1.5, w => { nhit(music, w, 'bandpass', 2000, 1.4, 0.35, 0.08); nhit(music, w + 0.012, 'bandpass', 2600, 1.2, 0.2, 0.06); });
      for (let e = 0; e < 8; e++) ev(b0 + e * 0.25, w => nhit(music, w, 'highpass', 6500, 0.7, e % 2 ? 0.07 : 0.035, 0.05));
      ev(b0, w => bass(w, BASS_A[bar % 4], 0.45, 0.35));
      ev(b0 + 0.75, w => bass(w, BASS_A[bar % 4], 0.3, 0.22));
      ev(b0 + 1, w => bass(w, BASS_A[bar % 4] + 7, 0.45, 0.3));
    } else {
      for (const tt of [b0, b0 + 1]) ch.forEach((m, i) => ev(tt + i * 0.02, w => uke(w, m, 0.06)));
      ev(b0, w => pad(w, ch.slice(1).map(m => m - 12), 1.9, 0.05));
      ev(b0, w => bass(w, BASS_A[bar % 4], 1.8, 0.22));
    }
  }
  const MEL_A = [[0, 0, 76], [0, 1, 79], [0, 2, 81], [0, 3, 79], [0, 5, 76], [0, 6, 74], [1, 0, 74], [1, 2, 71], [1, 3, 74], [1, 4, 79], [2, 0, 76], [2, 1, 79], [2, 2, 81], [2, 3, 84], [2, 5, 81], [2, 6, 79], [3, 0, 77], [3, 2, 76], [3, 3, 72], [3, 4, 74], [3, 6, 72]];
  for (const [b, e8, m] of MEL_A) ev(b * 2 + e8 * 0.25, w => glock(w, m, 0.09));
  [[8.15, 88], [8.45, 84], [8.75, 79], [12.15, 88], [12.45, 84], [12.75, 81]].forEach(([tt, m]) => ev(tt, w => glock(w, m, 0.075)));
  // Part C: the glance — gentle piano in F (33–60)
  const C0 = 33, BAR = 3.2, E8 = 0.4;
  const ARP = [[41, [53, 60, 65, 69, 72, 69, 65, 60]], [45, [52, 57, 60, 64, 69, 64, 60, 57]], [38, [50, 57, 62, 65, 69, 65, 62, 57]], [46, [53, 58, 62, 65, 70, 65, 62, 58]],
    [41, [53, 60, 65, 69, 72, 69, 65, 60]], [36, [48, 55, 60, 64, 67, 64, 60, 55]], [38, [50, 57, 62, 65, 69, 65, 62, 57]], [34, [46, 53, 58, 62, 65, 62, 58, 53]]];
  ARP.forEach(([bn, notes], i) => {
    const b0 = C0 + i * BAR;
    ev(b0, w => piano(w, bn, 0.2, 4.5));
    ev(b0, w => piano(w, bn + 12, 0.1, 4));
    notes.forEach((m, j) => ev(b0 + j * E8 + (hash(i * 8 + j) - 0.5) * 0.016, w => piano(w, m, 0.075 + (j === 0 ? 0.02 : 0) + hash(j + i) * 0.015, 2.6)));
    if (i >= 1) ev(b0, w => pad(w, [notes[1], notes[2], notes[3]], BAR, i >= 6 ? 0.06 : 0.035));
  });
  const MEL_C = [[2, 0, 81, 2], [2, 2, 79, 1], [2, 3, 77, 1], [3, 0, 77, 1.5], [3, 1.5, 74, 0.5], [3, 2, 77, 2], [4, 0, 81, 2], [4, 2, 84, 1], [4, 3, 81, 1], [5, 0, 79, 3], [5, 3, 76, 1], [6, 0, 77, 1], [6, 1, 76, 1], [6, 2, 74, 1], [6, 3, 81, 1], [7, 0, 79, 2], [7, 2, 77, 1], [7, 3, 74, 1]];
  for (const [b, beat, m, len] of MEL_C) ev(C0 + b * BAR + beat * 0.8, w => piano(w, m, 0.13, 1.6 + len));
  [[34.6, 88], [34.9, 84], [35.2, 79]].forEach(([tt, m]) => ev(tt, w => glock(w, m, 0.08)));
  [41, 53, 60, 65, 69, 72, 77].forEach((m, i) => ev(58.6 + i * 0.05, w => piano(w, m, 0.13, 5)));
  ev(58.6, w => pad(w, [65, 69, 72, 77], 1.2, 0.06));
  ev(58.65, w => glock(w, 84, 0.08)); ev(58.95, w => glock(w, 89, 0.06));
  // SFX
  ev(16.22, w => {
    const s = noiseSrc(w, 0.3); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, w); f.frequency.exponentialRampToValueAtTime(2600, w + 0.2);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.25, w + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, w + 0.25);
    s.connect(f); f.connect(g); g.connect(sfx);
  });
  ev(T_IMP, w => {
    tone(sfx, w, 110, 0.9, 0.45, 'sine', 42);
    nhit(sfx, w, 'lowpass', 900, 0.7, 0.55, 0.14);
    nhit(sfx, w + 0.01, 'bandpass', 1300, 0.8, 0.25, 0.22);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.4;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(0.12, w + 0.4); g.gain.linearRampToValueAtTime(0.0001, w + 1.9);
    o.connect(g); o2.connect(g); g.connect(sfx); o.start(w); o2.start(w); o.stop(w + 2); o2.stop(w + 2);
  });
  const landSfx = {
    phone: (w, s) => { nhit(sfx, w, 'bandpass', 3000, 4, 0.5 * s, 0.05); tone(sfx, w, 1800, 0.25 * s, 0.06); },
    box: (w, s) => { tone(sfx, w, 620, 0.35 * s, 0.1); tone(sfx, w, 930, 0.18 * s, 0.07); nhit(sfx, w, 'bandpass', 1500, 2, 0.2 * s, 0.05); },
    juice: (w, s) => { tone(sfx, w, 240, 0.4 * s, 0.14); nhit(sfx, w, 'lowpass', 800, 1, 0.3 * s, 0.08); },
    notebook: (w, s) => nhit(sfx, w, 'bandpass', 2000, 0.7, 0.55 * s, 0.08),
    pencil: (w, s) => { tone(sfx, w, 2600, 0.12 * s, 0.16); tone(sfx, w, 4100, 0.06 * s, 0.1); },
  };
  for (const id of ITEM_ORDER) {
    const k = physInit(id);
    ev(k.land1, w => landSfx[id](w, 1));
    ev(k.land2, w => landSfx[id](w, 0.35));
  }
  ev(ITEMS.juice.k.land2 + 0.02, w => {
    const s = noiseSrc(w, 0.6); const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    const g = ac.createGain(); g.gain.setValueAtTime(0.06, w); g.gain.linearRampToValueAtTime(0.0001, w + 0.55);
    s.connect(f); f.connect(g); g.connect(sfx);
  });
  [24.9, 26.3, 27.0, 27.8, 29.85, 32.2, 45.25].forEach(tt => ev(tt, w => { tone(sfx, w, 820, 0.07, 0.05); nhit(sfx, w, 'bandpass', 2400, 2, 0.05, 0.04); }));
  ev(31.72, w => glock(w, 93, 0.05, sfx));
  // Canteen babble: six formant-filtered noise "voices" with syllable envelopes
  voices.forEach((v, vi) => {
    const r = mulberry32(100 + vi);
    let tt = r() * 1.5;
    while (tt < 60) {
      const phrase = 1 + r() * 2.2, laugh = r() < 0.08;
      const end = tt + phrase;
      while (tt < end) {
        const dur = laugh ? 0.09 : 0.08 + r() * 0.14, pk = (laugh ? 0.08 : 0.05 + r() * 0.05) * v.base;
        const fa = (laugh ? 900 : 350 + r() * 550) * v.base, fb = 1200 + r() * 1300;
        const t1 = tt;
        ev(t1, w => { v.g.gain.setTargetAtTime(pk, w, 0.012); v.g.gain.setTargetAtTime(0.0001, w + dur * 0.6, 0.035); v.f1.frequency.setTargetAtTime(fa, w, 0.02); v.f2.frequency.setTargetAtTime(fb, w, 0.02); });
        tt += dur + (laugh ? 0.05 : 0.02 + r() * 0.08);
      }
      tt += 0.3 + r() * 1.4;
    }
  });
  const cr = mulberry32(55);
  for (let tt = 0.4; tt < 60; tt += 0.9 + cr() * 2.2) {
    const f = 2400 + cr() * 1800, vel = 0.02 + cr() * 0.03;
    ev(tt, w => { tone(amb, w, f, vel, 0.35); tone(amb, w, f * 1.51, vel * 0.5, 0.2); });
  }
  EV.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  while (cursor < EV.length && EV[cursor][0] < t0 - 0.01) cursor++;
  return {
    pump(ft) { while (cursor < EV.length && EV[cursor][0] <= ft) { const e = EV[cursor++]; const w = at(e[0]); if (w >= ac.currentTime - 0.005) e[1](Math.max(w, ac.currentTime)); } },
    stop() {
      const n = ac.currentTime;
      try { master.gain.cancelScheduledValues(n); master.gain.setValueAtTime(master.gain.value, n); master.gain.linearRampToValueAtTime(0, n + 0.06); } catch (e) { /* ignore */ }
      setTimeout(() => { try { sources.forEach(s => s.stop()); master.disconnect(); } catch (e) { /* ignore */ } }, 120);
    },
  };
}
async function renderAudio(sr = 48000) {
  const oac = new OfflineAudioContext(2, sr * DUR, sr);
  const g = buildAudio(oac, oac.destination, 0, 0);
  g.pump(DUR + 1);
  return oac.startRendering();
}

window.FILM = { W, H, DUR, setup, draw, buildAudio, renderAudio, sceneAt };
})();
