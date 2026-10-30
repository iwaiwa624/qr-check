/*
 * 印刷された数字を読む軽量OCR（QR照合チェッカー用）
 *
 * 外部ライブラリ・通信なしで動く。カメラ画像の枠内から数字の並びを探し、
 * 1文字ずつ「お手本の数字」と形を比べて読む。
 * お手本は起動時にいくつかの書体で描いて作り、さらに実際に読めた数字の形を
 * 端末内に覚えていく（使うほど、その会社の印刷の字に強くなる）。
 */
(function () {
  'use strict';

  const GW = 14, GH = 22;                 // 1文字を比べるときのマス目
  const FEAT = GW * GH + 1;               // マス目＋縦横比
  const LEARN_KEY = 'qrcheck.ocrLearn';
  const LEARN_MAX = 12;                   // 数字1つあたり覚える数

  let base = [];                          // 書体から作ったお手本 {d, f}
  let learned = [];                       // 実物から覚えたお手本 {d, f}

  /* ---------- 文字の形 → 特徴ベクトル ---------- */
  // bin: 0/1 の配列（幅w×高さh）の中の矩形を、縦横比を保ってマス目に入れる
  function feature(bin, w, x0, y0, bw, bh) {
    const f = new Float32Array(FEAT);
    const s = Math.min(GH / bh, GW / bw);
    const tw = bw * s, th = bh * s;
    const ox = (GW - tw) / 2, oy = (GH - th) / 2;
    // 各マスに入る元画素の割合（面積平均）
    const sub = 3;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let on = 0, n = 0;
      for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
        const px = (gx + (sx + .5) / sub - ox) / s, py = (gy + (sy + .5) / sub - oy) / s;
        if (px < 0 || py < 0 || px >= bw || py >= bh) { n++; continue; }
        on += bin[(y0 + (py | 0)) * w + x0 + (px | 0)]; n++;
      }
      f[gy * GW + gx] = on / n;
    }
    blur(f);
    f[FEAT - 1] = Math.min(1.2, bw / bh) * 3;  // 縦横比（「1」と他を見分ける）
    return f;
  }
  function blur(f) {
    const t = f.slice(0, GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
        const wgt = (dx || dy) ? 1 : 2; s += t[Y * GW + X] * wgt; n += wgt;
      }
      f[y * GW + x] = s / n;
    }
  }
  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < FEAT; i++) { const d = a[i] - b[i]; s += d * d; }
    return s;
  }
  function classify(f) {
    let best = 1e9, bd = '?', second = 1e9;
    const seen = {};
    for (const set of [learned, base]) for (const t of set) {
      const d = dist(f, t.f);
      if (d < (seen[t.d] ?? 1e9)) seen[t.d] = d;
    }
    for (const k in seen) {
      if (seen[k] < best) { second = best; best = seen[k]; bd = k; }
      else if (seen[k] < second) second = seen[k];
    }
    return { d: bd, dist: best, margin: second - best };
  }

  /* ---------- お手本を作る ---------- */
  const FONTS = [
    'sans-serif', 'serif', 'monospace',
    'Arial', 'Helvetica', 'Verdana', 'Times New Roman', 'Courier New', 'Roboto',
    '"Hiragino Sans"', '"Hiragino Mincho ProN"', '"Yu Gothic"', '"MS Gothic"', '"MS Mincho"',
    '"Noto Sans JP"', '"Noto Serif JP"', 'Meiryo', 'OCRB', '"OCR-B"',
  ];
  function buildBase(fonts) {
    const cv = document.createElement('canvas'); cv.width = 80; cv.height = 90;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const out = [], keys = new Set();
    for (const font of (fonts || FONTS)) for (const wt of ['400', '700']) for (let d = 0; d <= 9; d++) {
      c.fillStyle = '#fff'; c.fillRect(0, 0, 80, 90);
      c.fillStyle = '#000'; c.font = `${wt} 64px ${font}, sans-serif`; c.textBaseline = 'middle';
      c.fillText(String(d), 14, 46);
      const id = c.getImageData(0, 0, 80, 90).data;
      const bin = new Uint8Array(80 * 90);
      let x0 = 80, y0 = 90, x1 = -1, y1 = -1;
      for (let i = 0; i < bin.length; i++) if (id[i * 4] < 128) {
        bin[i] = 1; const x = i % 80, y = (i / 80) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) continue;
      const f = feature(bin, 80, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      const key = d + ':' + Array.from(f, v => (v * 20) | 0).join('');
      if (keys.has(key)) continue;          // その書体が無く同じ形になったものは省く
      keys.add(key); out.push({ d: String(d), f });
    }
    return out;
  }

  function loadLearned() {
    try {
      const a = JSON.parse(localStorage.getItem(LEARN_KEY) || '[]');
      learned = a.filter(x => x && x.f && x.f.length === FEAT).map(x => ({ d: x.d, f: Float32Array.from(x.f) }));
    } catch (e) { learned = []; }
  }
  function saveLearned() {
    try {
      localStorage.setItem(LEARN_KEY, JSON.stringify(learned.map(x => ({ d: x.d, f: Array.from(x.f, v => Math.round(v * 1000) / 1000) }))));
    } catch (e) {}
  }

  /* ---------- 画像 → 文字の候補 ---------- */
  // 明るさのムラに強い二値化（周りの平均より暗い所を文字とみなす）
  function binarize(gray, w, h) {
    const W = w + 1, ii = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += gray[y * w + x]; ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row; }
    }
    const r = Math.max(6, Math.round(h / 4));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        const sum = ii[yb * W + xb] - ii[ya * W + xb] - ii[yb * W + xa] + ii[ya * W + xa];
        const m = sum / ((yb - ya) * (xb - xa));
        const v = gray[y * w + x];
        bin[y * w + x] = (v < m * 0.86 && m - v > 14) ? 1 : 0;
      }
    }
    return bin;
  }
  // つながった黒い塊を集める
  function components(bin, w, h) {
    const lab = new Int32Array(w * h), comps = [];
    const stack = new Int32Array(w * h);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      n++; let sp = 0; stack[sp++] = i; lab[i] = n;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X;
          if (bin[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
      }
      comps.push({ id: n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
    }
    return { comps, lab };
  }
  // 1つの塊だけを取り出した二値画像
  function maskOf(c, lab, w) {
    const m = new Uint8Array(c.w * c.h);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++)
      m[y * c.w + x] = lab[(c.y0 + y) * w + c.x0 + x] === c.id ? 1 : 0;
    return m;
  }
  // 太字などでくっついた数字を、縦の投影の谷で分ける
  function splitWide(c, m, lineH) {
    const est = Math.round(c.w / (lineH * 0.58));
    if (c.w < lineH * 0.95 || est < 2) return [{ x: 0, w: c.w }];
    const prof = new Float32Array(c.w);
    for (let x = 0; x < c.w; x++) for (let y = 0; y < c.h; y++) prof[x] += m[y * c.w + x];
    const cuts = [];
    for (let k = 1; k < est; k++) {
      const cx = Math.round(c.w * k / est), r = Math.round(c.w / est * 0.3);
      let bx = cx, bv = 1e9;
      for (let x = Math.max(1, cx - r); x <= Math.min(c.w - 2, cx + r); x++) if (prof[x] < bv) { bv = prof[x]; bx = x; }
      cuts.push(bx);
    }
    const parts = []; let px = 0;
    for (const cx of cuts.concat([c.w])) { parts.push({ x: px, w: cx - px }); px = cx; }
    return parts;
  }

  /**
   * 画像（ImageData）から数字の並びを探す。
   * 戻り値: { runs: [{ text, glyphs:[特徴], conf }], lineH }
   */
  function read(img) {
    const w = img.width, h = img.height, d = img.data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114;
    const bin = binarize(gray, w, h);
    const { comps, lab } = components(bin, w, h);

    // 文字らしい大きさの塊
    const minH = Math.max(9, h * 0.12), maxH = h * 0.92;
    let cand = comps.filter(c => c.h >= minH && c.h <= maxH && c.w <= c.h * 4 && c.area >= c.h * 1.2 &&
                                  c.x0 > 0 && c.x1 < w - 1 && c.y0 > 0 && c.y1 < h - 1);
    if (!cand.length) return { runs: [] };

    // 高さと縦位置がそろった塊を「行」としてまとめる
    cand.sort((a, b) => a.x0 - b.x0);
    const lines = [];
    for (const c of cand) {
      const cy = (c.y0 + c.y1) / 2;
      let L = lines.find(l => Math.abs(l.cy - cy) < l.h * 0.35 && c.h > l.h * 0.78 && c.h < l.h * 1.28);
      if (!L) { L = { cy, h: c.h, items: [] }; lines.push(L); }
      L.items.push(c);
      L.cy = (L.cy * (L.items.length - 1) + cy) / L.items.length;
      L.h = (L.h * (L.items.length - 1) + c.h) / L.items.length;
    }

    const runs = [];
    for (const L of lines) {
      if (L.items.length < 3) continue;
      const hs = L.items.map(c => c.h).sort((a, b) => a - b);
      const lineH = hs[hs.length >> 1];
      // 行の中の小さな横棒（ハイフン）は区切りとして無視して続ける
      const items = L.items.filter(c => c.h > lineH * 0.6);
      // ハイフン（行の中ほどにある短い横棒）を探して、番号の一部として扱う
      const lx0 = Math.min(...items.map(c => c.x0)), lx1 = Math.max(...items.map(c => c.x1));
      for (const c of comps) {
        const cy = (c.y0 + c.y1) / 2;
        if (c.h < lineH * 0.4 && c.w > lineH * 0.18 && c.w < lineH * 1.3 && c.w > c.h * 1.5 &&
            Math.abs(cy - L.cy) < lineH * 0.28 && c.x0 > lx0 && c.x1 < lx1) items.push(Object.assign({ hy: true }, c));
      }
      items.sort((a, b) => a.x0 - b.x0);
      // 文字間のすき間の基準（等幅書体の「1」のように広い場合にも対応）
      const gaps = [];
      for (let i = 1; i < items.length; i++) { const g = items[i].x0 - items[i - 1].x1; if (g > 0) gaps.push(g); }
      gaps.sort((a, b) => a - b);
      const medGap = gaps.length ? gaps[gaps.length >> 1] : lineH * 0.1;
      const breakGap = Math.max(lineH * 0.42, Math.min(lineH * 1.1, medGap * 2.6));
      let cur = null, lastX = -1e9;
      const flush = () => {
        if (cur) { cur.text = cur.text.replace(/-+$/, ''); if (cur.text.length) runs.push(cur); }
        cur = null;
      };
      for (const c of items) {
        if (c.x0 - lastX > breakGap) flush();     // 空白で別の語・番号に分ける
        lastX = c.x1;
        if (c.hy) { if (cur && !cur.text.endsWith('-')) cur.text += '-'; continue; }
        const m = maskOf(c, lab, w);
        for (const part of splitWide(c, m, lineH)) {
          const f = feature(m, c.w, part.x, 0, Math.max(1, part.w), c.h);
          const r = classify(f);
          const okShape = r.dist < 40 && r.margin > Math.max(1.5, r.dist * 0.15);
          if (!okShape) { flush(); continue; }        // 数字でない文字（漢字・英字など）で区切る
          if (!cur) cur = { text: '', glyphs: [], conf: 0 };
          cur.text += r.d; cur.glyphs.push(f); cur.conf += r.margin;
        }
      }
      flush();
    }
    return { runs: runs.filter(r => r.text.replace(/-/g, '').length >= 3) };
  }

  /**
   * 読んだ文字列から「仕様書番号らしいもの」を取り出す。
   * 1. 26-0001 のようにハイフンを含む形を優先
   * 2. なければ5〜12桁の数字の並び（漢字の縦線を1と読んだだけの「111…」は除く）
   */
  function pick(runs, strict) {
    const exact = [], hy = [], plain = [];
    // 文字列の i 文字目までに数字がいくつあるか → その番号の字形を取り出す
    const sub = (r, i, t) => {
      const k = r.text.slice(0, i).replace(/-/g, '').length;
      return { text: t, glyphs: r.glyphs.slice(k, k + t.replace(/-/g, '').length) };
    };
    for (const r of runs) {
      let m; const re1 = /(?<![\d-])\d{2}-\d{4}(?![\d-])/g;
      while ((m = re1.exec(r.text))) exact.push(sub(r, m.index, m[0]));
      if (strict) continue;
      const re2 = /\d{2,4}-\d{3,6}/g; let any = false;
      while ((m = re2.exec(r.text))) { hy.push(sub(r, m.index, m[0])); any = true; }
      if (!any) {
        let i = 0;
        for (const t of r.text.split('-')) {
          if (t.length >= 5 && t.length <= 12 && !/^1+$/.test(t)) plain.push(sub(r, i, t));
          i += t.length + 1;
        }
      }
    }
    return exact.length ? exact : hy.length ? hy : plain;
  }

  /* 読み取りが正しかった（または手で正しい番号を入れた）ときに字形を覚える */
  function learn(glyphs, digits) {
    if (!glyphs || glyphs.length !== digits.length) return;
    glyphs.forEach((f, i) => {
      const dgt = digits[i];
      learned.push({ d: dgt, f: Float32Array.from(f) });
      const same = learned.filter(x => x.d === dgt);
      if (same.length > LEARN_MAX) learned.splice(learned.indexOf(same[0]), 1);
    });
    saveLearned();
  }
  function forget() { learned = []; try { localStorage.removeItem(LEARN_KEY); } catch (e) {} }

  let ready = false;
  function init(testFonts) {
    if (ready && !testFonts) return;
    base = buildBase(testFonts); loadLearned(); ready = true;
  }

  window.DigitOCR = { init, read, pick, learn, forget, get learnedCount() { return learned.length; } };
})();
