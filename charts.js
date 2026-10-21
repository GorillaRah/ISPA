/* charts.js - grafik interaktif WebGIS Risiko ISPA (tanpa pustaka eksternal).
   Muat SETELAH skrip peta: <script src="charts.js"></script> sebelum </body>.
   Grafik: (1) Pola Musiman, (2) Peringkat Kelurahan, (3) Skor vs Insiden ISPA. */
(function (root) {
'use strict';
var QN = ['Q1', 'Q2', 'Q3', 'Q4'], MONTHS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Okt–Des'];
var DATA = ['json_RisikoISPAKelurahanQ1_26', 'json_RisikoISPAKelurahanQ2_25',
            'json_RisikoISPAKelurahanQ3_24', 'json_RisikoISPAKelurahanQ4_23'];
var KOTA = {'Kota Jakarta Pusat': '#E69F00', 'Kota Jakarta Utara': '#56B4E9', 'Kota Jakarta Barat': '#009E73',
            'Kota Jakarta Selatan': '#0072B2', 'Kota Jakarta Timur': '#D55E00'};
var NS = 'http://www.w3.org/2000/svg';

/* ---------- statistik ---------- */
function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
function rank(a) {
  var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; }), r = [];
  for (var i = 0; i < idx.length;) {
    var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (var k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += Math.pow(x[i] - mx, 2); syy += Math.pow(y[i] - my, 2); }
  return sxy / Math.sqrt(sxx * syy);
}
function erf(x) {
  var s = x < 0 ? -1 : 1, t; x = Math.abs(x); t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function spearman(x, y) {  /* p aproksimasi normal (n besar) */
  var rho = pearson(rank(x), rank(y)), n = x.length, z = Math.abs(rho) * Math.sqrt(n - 1);
  return {rho: rho, n: n, p: 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)))};
}
function strength(r) { r = Math.abs(r); return r < .1 ? 'dapat diabaikan' : r < .3 ? 'lemah' : r < .5 ? 'sedang' : 'kuat'; }
function fmt(v, d) { return v.toFixed(d).replace('.', ','); }
function key(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
function ramp(v) {
  var a = [255, 224, 138], b = [139, 0, 0];
  return 'rgb(' + a.map(function (c, i) { return Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, v))); }).join(',') + ')';
}

/* ---------- data ---------- */
function buildRows() {
  var inc = (root.ispaIncidence2025 || {}).records || {};
  var maps = DATA.map(function (v) {
    var m = {}; ((root[v] || {}).features || []).forEach(function (f) { m[key(f.properties.NAMOBJ)] = f; }); return m;
  });
  return Object.keys(maps[0]).map(function (k) {
    var fs = maps.map(function (m) { return m[k]; });
    if (fs.some(function (f) { return !f; })) return null;
    var p = fs[0].properties, r = fs.map(function (f) { return Number(f.properties.risiko_ispa_normalisasi); }), rec = inc[k];
    return {name: p.NAMOBJ, kec: p.WADMKC, kota: p.WADMKK, r: r.concat(mean(r)), feats: fs,
            inc: rec ? Number(rec.per1000) : null, pop: rec && rec.population, cases: rec && rec.cases};
  }).filter(Boolean);
}

/* ---------- UI ---------- */
function start() {
  if (!root.map || !root.L || !DATA.every(function (v) { return root[v]; })) { console.warn('charts.js: peta/data belum siap'); return; }
  var rows = buildRows(), state = {tab: 0, q: 1, rank: 'top'}, hidden = {};
  var CSS = '#charts-overlay{position:fixed;inset:10px;z-index:1300;display:flex;flex-direction:column;gap:10px;padding:12px;background:rgba(255,255,255,.8);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);font-family:"Segoe UI",Arial,sans-serif;font-size:13px;color:#1f2937}' +
    '#charts-overlay[hidden]{display:none}' +
    '#charts-collapse{flex:none;width:100%;padding:14px 16px;border:0;border-radius:10px;background:#d32f2f;color:#fff;font-family:inherit;font-weight:800;font-size:18px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;box-shadow:0 3px 10px rgba(211,47,47,.45)}#charts-collapse:hover{background:#b71c1c}' +
    '.ch-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.ch-btn{border:1px solid #cbd5e1;background:rgba(255,255,255,.92);border-radius:999px;padding:7px 14px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;color:#1f2937}.ch-btn[aria-selected=true],.ch-btn[aria-pressed=true]{background:#1f2937;color:#fff;border-color:#1f2937}' +
    '.ch-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}' +
    '#ch-body{flex:1;overflow:auto;background:rgba(255,255,255,.74);border-radius:10px;padding:12px}#ch-body h3{margin:0 0 4px;font-size:16px}#ch-sub{margin:0 0 8px;color:#475569}' +
    '#ch-wrap{position:relative;margin-top:8px}#ch-wrap svg{display:block;max-width:100%}#ch-wrap .g{stroke:#cbd5e1;stroke-width:1}#ch-wrap .t{font-size:11px;fill:#475569}#ch-wrap .b{font-weight:700}#ch-wrap .band{fill:rgba(211,47,47,.09)}#ch-wrap .hit{cursor:pointer}#ch-wrap .hit:focus{outline:2px solid #d32f2f}' +
    '#ch-tip{position:absolute;display:none;pointer-events:none;z-index:3;background:#111827;color:#fff;padding:6px 9px;border-radius:6px;font-size:12px;line-height:1.35;max-width:230px}' +
    '#ch-note{margin-top:10px;font-size:12px;line-height:1.5;color:#374151}' +
    '#ch-guide{margin-top:12px;border:1px solid #e5e7eb;border-radius:10px;background:rgba(249,250,251,.95);font-size:12px;line-height:1.55;color:#374151}' +
    '#ch-guide summary{padding:9px 12px;font-weight:700;cursor:pointer;color:#1f2937}' +
    '#ch-guide .gd-body{padding:0 12px 10px}#ch-guide h4{margin:10px 0 3px;font-size:12px;color:#111827}#ch-guide ul{margin:0;padding-left:18px}#ch-guide li{margin:3px 0}' +
    '#ch-guide .gd-find{padding:7px 9px 7px 24px;border-left:3px solid #2563eb;background:#eff6ff;border-radius:4px}' +
    '#ch-guide .gd-phen{padding:7px 9px 7px 24px;border-left:3px solid #059669;background:#ecfdf5;border-radius:4px}' +
    '#ch-guide .gd-warn{padding:7px 9px 7px 24px;border-left:3px solid #f59e0b;background:#fffbeb;border-radius:4px}' +
    '.ch-link{border:1px solid #d32f2f;color:#d32f2f;background:#fff;border-radius:8px;padding:5px 10px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer}.ch-link:hover{background:#d32f2f;color:#fff}' +
    '#charts-entry{margin:10px 0;padding-top:8px;border-top:1px solid #e5e7eb}#charts-entry summary{font-size:10px;font-weight:700;color:#374151;cursor:pointer}' +
    '#btn-charts{background:#fff;color:#1f2937;box-shadow:0 2px 8px rgba(0,0,0,.25)}#btn-charts:hover,#btn-charts.active{background:#2563eb;color:#fff}' +
    '@media(max-width:700px){#charts-overlay{inset:0;border-radius:0;padding:8px}#charts-collapse{font-size:16px;padding:12px}}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  function h(tag, attrs, parent, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text; if (parent) parent.appendChild(e); return e;
  }
  function sv(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text; if (parent) parent.appendChild(e); return e;
  }

  var ov = h('div', {id: 'charts-overlay', role: 'dialog', 'aria-label': 'Grafik interaktif', hidden: ''}, document.body);
  var collapse = h('button', {id: 'charts-collapse', type: 'button', 'aria-controls': 'charts-overlay', 'aria-label': 'Tutup panel grafik'}, ov, '▼  Tutup grafik');
  var tabBar = h('div', {class: 'ch-bar', role: 'tablist'}, ov), qBar = h('div', {class: 'ch-bar'}, ov);
  var body = h('div', {id: 'ch-body'}, ov), title = h('h3', {}, body), sub = h('p', {id: 'ch-sub'}, body);
  var legend = h('div', {class: 'ch-bar'}, body), wrap = h('div', {id: 'ch-wrap'}, body), tip = h('div', {id: 'ch-tip'}, wrap);
  var note = h('div', {id: 'ch-note'}, body);
  var guide = h('details', {id: 'ch-guide', open: ''}, body);
  var chartEntrySummary;

  /* panel "Cara membaca grafik": sections = [{t: judul, i: [butir], k: 'find'|'warn'|undefined}] */
  function explain(sections) {
    guide.replaceChildren();
    h('summary', {}, guide, 'Fenomena yang dapat dijelaskan dan cara membaca grafik');
    var box = h('div', {class: 'gd-body'}, guide);
    sections.forEach(function (sec) {
      h('h4', {}, box, sec.t);
      var ul = h('ul', sec.k ? {class: 'gd-' + sec.k} : {}, box);
      sec.i.forEach(function (x) {
        var li = h('li', {}, ul);
        if (Array.isArray(x)) { h('strong', {}, li, x[0] + ' '); li.appendChild(document.createTextNode(x[1])); }
        else li.textContent = x;
      });
    });
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function quant(a, p) { var t = a.slice().sort(function (x, y) { return x - y; }), i = (t.length - 1) * p, l = Math.floor(i), u = Math.ceil(i); return t[l] + (t[u] - t[l]) * (i - l); }
  var lastOpener;

  var TABS = ['Pola Musiman', 'Peringkat Kelurahan', 'Skor vs Insiden'];
  var tabBtns = TABS.map(function (t, i) {
    var b = h('button', {type: 'button', role: 'tab', class: 'ch-btn'}, tabBar, t);
    b.addEventListener('click', function () { state.tab = i; render(); }); return b;
  });
  var qBtns = QN.concat(['Rata-rata']).map(function (t, i) {
    var b = h('button', {type: 'button', class: 'ch-btn'}, qBar, t);
    b.addEventListener('click', function () { setQuarter(i); render(); }); return b;
  });

  var slider = document.getElementById('time-slider');
  function setQuarter(i) {
    state.q = i;
    if (i < 4 && slider && Number(slider.value) !== i) {
      slider.value = i; slider.dispatchEvent(new Event('input', {bubbles: true})); slider.dispatchEvent(new Event('change', {bubbles: true}));
    }
  }
  if (slider) slider.addEventListener('input', function () { var v = parseInt(slider.value, 10); if (v >= 0 && v < 4 && state.q !== v) { state.q = v; render(); } });

  var launcher = h('button', {id: 'btn-charts', class: 'round-btn', type: 'button', title: 'Lihat Grafik', 'aria-label': 'Lihat Grafik', 'aria-controls': 'charts-overlay', 'aria-pressed': 'false'});
  launcher.innerHTML = '<i class="fas fa-chart-line" aria-hidden="true"></i>';
  launcher.addEventListener('click', function () { ov.hidden ? open(0, launcher) : close(); });
  waitFor('#btn-swipe-panel', function (swipeButton) {
    swipeButton.parentNode.insertBefore(launcher, swipeButton.nextSibling);
  });

  function open(tab, opener) {
    if (typeof tab === 'number') state.tab = tab;
    lastOpener = opener || launcher;
    if (slider && state.q < 4) state.q = Math.max(0, Math.min(3, parseInt(slider.value, 10) || 0));
    ov.hidden = false; launcher.classList.add('active'); launcher.setAttribute('aria-pressed', 'true');
    render(); collapse.focus();
  }
  function close() { ov.hidden = true; tip.style.display = 'none'; launcher.classList.remove('active'); launcher.setAttribute('aria-pressed', 'false'); }
  collapse.addEventListener('click', function () { close(); if (lastOpener) lastOpener.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) { close(); if (lastOpener) lastOpener.focus(); } });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });

  function goTo(row) {
    var qi = Math.min(state.q, 3);
    close();
    try { root.map.fitBounds(root.L.geoJSON(row.feats[qi]).getBounds(), {maxZoom: 15, padding: [50, 50]}); } catch (e) {}
    if (state.q < 4) setQuarter(state.q);
    try { root.showKelurahanInfo(Object.assign({WADMKD: row.name}, row.feats[qi].properties)); } catch (e) {}
  }
  function showTip(html, ev) {
    tip.innerHTML = html; tip.style.display = 'block';
    var r = wrap.getBoundingClientRect(), x = ev.clientX - r.left + 12, y = ev.clientY - r.top + 12;
    tip.style.left = Math.max(0, Math.min(x, r.width - tip.offsetWidth)) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }
  function bind(el, html, onClick) {
    ['pointerenter', 'pointermove'].forEach(function (n) { el.addEventListener(n, function (ev) { showTip(typeof html === 'function' ? html() : html, ev); }); });
    el.addEventListener('pointerleave', function () { tip.style.display = 'none'; });
    el.classList.add('hit'); el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  }
  var qLabel = function () { return state.q < 4 ? QN[state.q] + ' 2025' : 'rata-rata 4 kuartal'; };

  /* ---- grafik 1: pola musiman ---- */
  function series() {
    var out = [{name: 'DKI Jakarta', c: '#111827', w: 3.5, v: [0, 1, 2, 3].map(function (i) { return mean(rows.map(function (r) { return r.r[i]; })); })}];
    Object.keys(KOTA).forEach(function (k) {
      var sub = rows.filter(function (r) { return r.kota === k; });
      out.push({name: k.replace('Kota Jakarta ', ''), c: KOTA[k], w: 2, v: [0, 1, 2, 3].map(function (i) { return mean(sub.map(function (r) { return r.r[i]; })); })});
    });
    return out;
  }
  function drawLine(W) {
    var H = Math.round(Math.min(400, Math.max(280, W * .55))), m = {l: 40, r: 16, t: 14, b: 46}, iw = W - m.l - m.r - 24, ih = H - m.t - m.b;
    var s = sv('svg', {width: W, height: H, viewBox: '0 0 ' + W + ' ' + H}, wrap);
    var X = function (i) { return m.l + 12 + iw * i / 3; }, Y = function (v) { return m.t + ih * (1 - v); };
    [0, .25, .5, .75, 1].forEach(function (v) { sv('line', {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'g'}, s); sv('text', {x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 't'}, s, fmt(v, 2)); });
    QN.forEach(function (q, i) {
      if (state.q === i) sv('rect', {x: X(i) - iw / 6, y: m.t, width: iw / 3, height: ih, class: 'band'}, s);
      sv('text', {x: X(i), y: H - 26, 'text-anchor': 'middle', class: 't b'}, s, q); sv('text', {x: X(i), y: H - 10, 'text-anchor': 'middle', class: 't'}, s, MONTHS[i]);
    });
    series().forEach(function (se) {
      if (hidden[se.name]) return;
      sv('path', {d: se.v.map(function (v, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(v); }).join(' '), stroke: se.c, 'stroke-width': se.w, fill: 'none'}, s);
      se.v.forEach(function (v, i) {
        var c = sv('circle', {cx: X(i), cy: Y(v), r: se.w > 3 ? 6 : 5, fill: se.c, stroke: '#fff', 'stroke-width': 1.5, 'aria-label': se.name + ' ' + QN[i] + ': ' + fmt(v, 2)}, s);
        bind(c, '<b>' + esc(se.name) + '</b><br>' + QN[i] + ' (' + MONTHS[i] + '): ' + fmt(v, 2) + '<br><i>klik: tampilkan ' + QN[i] + ' di peta</i>', function () { setQuarter(i); render(); });
      });
    });
    series().forEach(function (se) {
      var b = h('button', {type: 'button', class: 'ch-btn', 'aria-pressed': String(!hidden[se.name])}, legend);
      b.innerHTML = '<span class="ch-dot" style="background:' + se.c + '"></span>' + esc(se.name);
      b.addEventListener('click', function () { hidden[se.name] = !hidden[se.name]; render(); });
    });
    title.textContent = 'Pola musiman skor paparan lingkungan';
    sub.textContent = 'Rata-rata skor per kuartal (skala 0–1, global). Klik legenda untuk menyembunyikan garis; klik titik untuk memindahkan peta ke kuartal itu.';
    note.textContent = 'Skor dinormalisasi secara global sehingga dapat dibandingkan antar-kuartal. Selisih antar-kuartal sebagian besar mencerminkan musim (LST dan NO₂), bukan perbedaan antar-lokasi, dan bukan ukuran risiko kesehatan.';

    var all = series()[0].v, hi = all.indexOf(Math.max.apply(null, all)), lo = all.indexOf(Math.min.apply(null, all));
    var kotaMeans = series().slice(1).map(function (se) { return {n: se.name, m: mean(se.v)}; }).sort(function (a, b) { return b.m - a.m; });
    var gaps = [0, 1, 2, 3].map(function (i) {
      var vs = series().slice(1).map(function (se) { return se.v[i]; });
      return Math.max.apply(null, vs) - Math.min.apply(null, vs);
    });
    var swing = all[hi] - all[lo], maxGap = Math.max.apply(null, gaps), ratioSw = maxGap > 0 ? swing / maxGap : 0;
    explain([
      {t: 'Cara membaca singkat', i: [
        'Garis hitam tebal = rata-rata DKI Jakarta; garis berwarna = rata-rata kelurahan di tiap kota. Sumbu Y adalah skor 0–1 dengan skala yang sama di semua kuartal, dan pita merah muda menandai kuartal yang sedang tampil di peta.',
        'Naik-turunnya garis menunjukkan perubahan antar-musim; jarak vertikal antar-garis menunjukkan perbedaan antar-kota pada kuartal yang sama.']},
      {t: 'Fenomena yang dapat dijelaskan dari grafik ini', k: 'phen', i: [
        ['Siklus musim hujan dan kemarau.', 'Q1 jatuh pada puncak muson barat: hujan lebat dan awan tebal menekan suhu permukaan (LST) dan membilas NO₂ dari udara, sehingga skor rendah. Memasuki Q2–Q3 (muson timur) langit cerah dan kering: permukaan memanas dan NO₂ menumpuk karena tidak ada pembilasan hujan, sehingga skor naik. Q4 adalah masa pancaroba; hujan kembali dan skor turun lagi.'],
        ['Mengapa semua garis bergerak bersama.', 'LST dan NO₂ adalah dua variabel dengan bobot terbesar dalam indeks (loading PC1 sekitar +0,62 masing-masing), dan keduanya digerakkan oleh cuaca regional yang dialami seluruh Jakarta sekaligus. Akibatnya kelima kota naik dan turun hampir serempak.'],
        ['Musim lebih menentukan daripada lokasi.', 'Selisih musiman rata-rata DKI (' + fmt(swing, 2) + ') sekitar ' + fmt(ratioSw, 1) + ' kali rentang antar-kota terbesar (' + fmt(maxGap, 2) + '). ' + (ratioSw >= 1.5 ? 'Karena itu menyebut sebuah kota "lebih tinggi" tanpa menyebut kuartalnya mudah menyesatkan: kuartal menjelaskan jauh lebih banyak variasi daripada kota.' : 'Perbedaan antar-kota cukup sebanding dengan perubahan musim, sehingga posisi relatif antar-kota layak dicermati.')],
        ['Mengapa sebuah kota bisa konsisten di atas atau di bawah.', 'Garis yang terus berada paling bawah (di sini ' + kotaMeans[kotaMeans.length - 1].n + ') dan paling atas (' + kotaMeans[0].n + ') mencerminkan ciri lahan yang memengaruhi LST dan NO₂ lokal, seperti proporsi vegetasi dan lahan terbangun, kedekatan dengan pantai, dan kepadatan jalan. Ini kemungkinan penjelasan; grafik hanya menampilkan rata-rata dan tidak menguji penyebabnya.']]},
      {t: 'Yang terlihat pada data ini', k: 'find', i: [
        'Rata-rata DKI tertinggi pada ' + QN[hi] + ' (' + MONTHS[hi] + ', ' + fmt(all[hi], 2) + ') dan terendah pada ' + QN[lo] + ' (' + MONTHS[lo] + ', ' + fmt(all[lo], 2) + '); selisihnya ' + fmt(swing, 2) + ' pada skala 0–1.',
        'Antar-kota, rentang skor terbesar terjadi pada ' + QN[gaps.indexOf(maxGap)] + ' (' + fmt(maxGap, 2) + ') dan terkecil pada ' + QN[gaps.indexOf(Math.min.apply(null, gaps))] + ' (' + fmt(Math.min.apply(null, gaps), 2) + '). Rata-rata setahun tertinggi: ' + kotaMeans[0].n + ' (' + fmt(kotaMeans[0].m, 2) + '), terendah: ' + kotaMeans[kotaMeans.length - 1].n + ' (' + fmt(kotaMeans[kotaMeans.length - 1].m, 2) + ').']},
      {t: 'Hal yang perlu diwaspadai', k: 'warn', i: [
        'Skor tinggi berarti paparan lingkungan relatif tinggi, bukan peningkatan kasus atau risiko kesehatan.',
        'Pada Q1 tutupan awan tebal membuat banyak piksel Sentinel-2 (untuk NDVI dan NDBI) harus diisi dari kuartal terdekat, sehingga nilai Q1 kurang mewakili kondisi tepat pada periodenya.',
        'Data hanya mencakup satu tahun (2025), jadi pola musiman ini belum dibandingkan dengan tahun lain.']}
    ]);
  }

  /* ---- grafik 2: peringkat ---- */
  function drawBars(W) {
    var q = state.q, list = rows.slice().sort(function (a, b) { return state.rank === 'top' ? b.r[q] - a.r[q] : a.r[q] - b.r[q]; }).slice(0, 10);
    var lab = W < 520 ? 120 : 200, m = {l: lab, r: 48, t: 6, b: 6}, rh = 30, H = m.t + m.b + list.length * rh, iw = W - m.l - m.r;
    var s = sv('svg', {width: W, height: H, viewBox: '0 0 ' + W + ' ' + H}, wrap);
    list.forEach(function (r, i) {
      var y = m.t + i * rh, v = r.r[q], nm = r.name.length > (W < 520 ? 18 : 30) ? r.name.slice(0, W < 520 ? 17 : 29) + '…' : r.name;
      sv('text', {x: m.l - 8, y: y + rh / 2 + 4, 'text-anchor': 'end', class: 't'}, s, nm);
      var bar = sv('rect', {x: m.l, y: y + 4, width: Math.max(2, iw * v), height: rh - 8, rx: 4, fill: ramp(v), 'aria-label': r.name + ' ' + fmt(v, 2)}, s);
      sv('text', {x: m.l + iw * v + 6, y: y + rh / 2 + 4, class: 't b'}, s, fmt(v, 2));
      bind(bar, '<b>' + esc(r.name) + '</b><br>Kec. ' + esc(r.kec) + ', ' + esc(r.kota.replace('Kota ', '')) + '<br>Skor ' + qLabel() + ': ' + fmt(v, 2) + '<br><i>klik: lihat di peta</i>', function () { goTo(r); });
    });
    ['top', 'bottom'].forEach(function (k) {
      var b = h('button', {type: 'button', class: 'ch-btn', 'aria-pressed': String(state.rank === k)}, legend, k === 'top' ? '10 tertinggi' : '10 terendah');
      b.addEventListener('click', function () { state.rank = k; render(); });
    });
    title.textContent = (state.rank === 'top' ? '10 kelurahan dengan skor tertinggi' : '10 kelurahan dengan skor terendah') + ' — ' + qLabel();
    sub.textContent = 'Pilih kuartal di atas. Klik batang untuk menutup panel dan membuka kelurahan itu di peta.';
    note.textContent = 'Panjang batang memakai skala 0–1 yang sama untuk semua kuartal. Skor tinggi berarti paparan lingkungan relatif tinggi (terutama panas dan NO₂), bukan ambang kesehatan.';

    var byKota = {};
    list.forEach(function (r) { var k = r.kota.replace('Kota Jakarta ', ''); byKota[k] = (byKota[k] || 0) + 1; });
    var komposisi = Object.keys(byKota).sort(function (a, b) { return byKota[b] - byKota[a]; }).map(function (k) { return k + ' (' + byKota[k] + ')'; }).join(', ');
    var vals = list.map(function (r) { return r.r[q]; }), top = state.rank === 'top';
    var rkSet = function (qi) { return rows.slice().sort(function (a, b) { return top ? b.r[qi] - a.r[qi] : a.r[qi] - b.r[qi]; }).slice(0, 10).map(function (r) { return r.name; }); };
    var sets = [0, 1, 2, 3, 4].map(rkSet);
    var sameAsAvg = sets[q].filter(function (n) { return sets[4].indexOf(n) > -1; }).length;
    var alwaysIn = sets[0].filter(function (n) { return [1, 2, 3].every(function (i) { return sets[i].indexOf(n) > -1; }); }).length;
    var gapRank = Math.abs(vals[0] - vals[vals.length - 1]);
    explain([
      {t: 'Cara membaca singkat', i: [
        'Baca dari atas ke bawah sebagai urutan peringkat; panjang dan warna batang mengikuti skor (0–1, skala sama untuk semua kuartal) dan angka di ujung batang adalah skornya.',
        'Ganti kuartal di tombol atas untuk melihat apakah peringkat berubah; "Rata-rata" memakai rerata empat kuartal. Klik batang untuk membuka kelurahan itu di peta.']},
      {t: 'Fenomena yang dapat dijelaskan dari grafik ini', k: 'phen', i: [
        top
          ? ['Apa yang mendorong skor tinggi.', 'Skor tertinggi umumnya berasal dari kombinasi LST dan NO₂ yang tinggi, dua variabel berbobot terbesar. Karena NDVI berloading positif sedangkan NDBI dan proksi jalan negatif, kelurahan yang lebih hijau, kurang terbangun, atau lebih jauh dari jalan juga bisa naik peringkatnya walaupun paparan perkotaannya tidak ekstrem.']
          : ['Apa yang menahan skor tetap rendah.', 'Skor terendah umumnya berasal dari LST dan NO₂ yang relatif rendah. Kelurahan dengan lahan terbangun tinggi dan dekat jalan juga ikut tertarik turun oleh loading negatif NDBI dan proksi jalan. Di tepi kota, kawasan tambak, atau lahan berair, nilai bisa terpengaruh masking air yang belum sempurna; cek dengan peta satelit.'],
        ['Mengapa kelurahan bertetangga sering mirip.', 'NO₂ berasal dari Sentinel-5P berresolusi sekitar 1 km yang dihaluskan ke 10 m, dan LST dari Landsat 30 m. Karena sumbernya kasar, kelurahan yang bersebelahan sering mendapat nilai serupa, sehingga daftar ini cenderung membentuk gugus wilayah, bukan titik terpisah. Ini mencerminkan resolusi data, bukan kemiripan sosial-ekonomi.'],
        ['Mengapa peringkat bergeser antar-kuartal.', 'Skor setiap kuartal ikut terdorong musim (hujan menurunkan LST dan NO₂ secara merata, kemarau menaikkannya), sementara ciri tetap lokasi (vegetasi, bangunan, jalan) menjaga sebagian kelurahan tetap berada di kelompok yang sama. Bagian "Yang terlihat pada data ini" di bawah menunjukkan mana yang lebih kuat.'],
        ['Mengapa peringkat teratas hampir sama.', 'Selisih skor antara peringkat 1 dan 10 hanya ' + fmt(gapRank, 2) + '. Beda sekecil itu masih dalam rentang ketidakpastian data (resolusi, penambalan awan, masking air), sehingga sepuluh kelurahan ini lebih tepat dibaca sebagai satu kelompok bernilai ' + (top ? 'tinggi' : 'rendah') + ' daripada urutan pasti.']]},
      {t: 'Yang terlihat pada data ini', k: 'find', i: [
        'Skor pada daftar ini berkisar ' + fmt(Math.min.apply(null, vals), 2) + '–' + fmt(Math.max.apply(null, vals), 2) + '. Sebaran per kota: ' + komposisi + '.',
        'Dari sepuluh kelurahan pada ' + qLabel() + ', ' + sameAsAvg + ' juga masuk daftar rata-rata 4 kuartal, dan ' + alwaysIn + ' kelurahan muncul di daftar yang sama pada keempat kuartal. ' + (alwaysIn >= 7 ? 'Peringkat cukup stabil, jadi posisi ini lebih banyak ditentukan oleh sifat lokasi daripada oleh musim.' : alwaysIn >= 4 ? 'Sebagian kelurahan konsisten, sebagian lain keluar-masuk mengikuti musim.' : 'Peringkat banyak berganti: musim ikut menentukan siapa yang berada di puncak, sehingga satu kuartal saja tidak cukup untuk menyebut sebuah kelurahan paling ' + (top ? 'tinggi' : 'rendah') + '.')]},
      {t: 'Hal yang perlu diwaspadai', k: 'warn', i: [
        'Indeks berkorelasi negatif dengan kepadatan penduduk (ρ sekitar −0,63), sehingga peringkat atas tidak otomatis berarti kawasan paling padat atau paling berpolusi.',
        'Piksel badan air yang lolos masking dapat menaikkan skor; periksa peta satelit sebelum menafsirkan kelurahan di tepi air.',
        'Ini peringkat paparan lingkungan relatif, bukan prioritas intervensi kesehatan.']}
    ]);
  }

  /* ---- grafik 3: skor vs insiden ---- */
  function drawScatter(W) {
    var q = state.q, pts = rows.filter(function (r) { return r.inc !== null && !isNaN(r.inc); });
    var xs = pts.map(function (r) { return r.r[q]; }), ys = pts.map(function (r) { return r.inc; });
    var H = Math.round(Math.min(440, Math.max(300, W * .6))), m = {l: 46, r: 16, t: 14, b: 44}, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), lo = Math.log10(.1), hi = Math.log10(12);
    var X = function (v) { return m.l + iw * (v - x0) / (x1 - x0); }, Y = function (v) { return m.t + ih * (1 - (Math.log10(v) - lo) / (hi - lo)); };
    var s = sv('svg', {width: W, height: H, viewBox: '0 0 ' + W + ' ' + H}, wrap);
    [.1, .3, 1, 3, 10].forEach(function (v) { sv('line', {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'g'}, s); sv('text', {x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 't'}, s, fmt(v, v < 1 ? 1 : 0)); });
    for (var i = 0; i <= 4; i++) { var xv = x0 + (x1 - x0) * i / 4; sv('text', {x: X(xv), y: H - 24, 'text-anchor': 'middle', class: 't'}, s, fmt(xv, 2)); }
    sv('text', {x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle', class: 't b'}, s, 'Skor paparan ' + qLabel());
    sv('text', {x: m.l, y: m.t + 2, class: 't b'}, s, 'Insiden per 1.000 (skala log)');
    pts.forEach(function (r) {
      var c = sv('circle', {cx: X(r.r[q]), cy: Y(r.inc), r: 4.5, fill: KOTA[r.kota] || '#6b7280', 'fill-opacity': .75, stroke: '#fff', 'stroke-width': .8, 'aria-label': r.name}, s);
      bind(c, '<b>' + esc(r.name) + '</b><br>Kec. ' + esc(r.kec) + '<br>Skor: ' + fmt(r.r[q], 2) + '<br>Insiden: ' + fmt(r.inc, 2) + ' /1.000 (' + (r.cases || '-') + ' kasus)<br><i>klik: lihat di peta</i>', function () { goTo(r); });
    });
    Object.keys(KOTA).forEach(function (k) {
      var b = h('span', {class: 'ch-btn'}, legend); b.style.cursor = 'default';
      b.innerHTML = '<span class="ch-dot" style="background:' + KOTA[k] + '"></span>' + esc(k.replace('Kota Jakarta ', ''));
    });
    var sp = spearman(xs, ys);
    title.textContent = 'Skor paparan vs insiden ISPA 2025 per 1.000 penduduk';
    sub.textContent = 'Setiap titik = satu kelurahan (n = ' + sp.n + '). Arahkan atau ketuk titik untuk detail; klik untuk membukanya di peta.';
    note.innerHTML = '<b>Korelasi Spearman ρ = ' + (sp.rho >= 0 ? '+' : '−') + fmt(Math.abs(sp.rho), 2) + '</b> (' + strength(sp.rho) + '; p ≈ ' + (sp.p < .001 ? '< 0,001' : fmt(sp.p, 2)) + ', aproksimasi). ' +
      'Kasus hanya tahunan 2025 dan berasal dari fasilitas kesehatan, sehingga dipengaruhi akses dan pelaporan; hasil ini adalah asosiasi tingkat kelurahan, bukan bukti sebab-akibat, dan skor kuartalan belum divalidasi terhadap insiden kuartalan. ' +
      'Kepadatan penduduk belum dikontrol di grafik ini.';

    var mx = median(xs), my = median(ys), quad = {hh: 0, hl: 0, lh: 0, ll: 0};
    pts.forEach(function (r) { quad[(r.r[q] > mx ? 'h' : 'l') + (r.inc > my ? 'h' : 'l')]++; });
    var dir = sp.rho > 0 ? 'searah' : 'berlawanan arah';
    var p10 = quant(ys, .1), p90 = quant(ys, .9), xr = quant(xs, .9) - quant(xs, .1);
    var withPop = pts.filter(function (r) { return Number(r.pop) > 0; }), popMed = withPop.length ? median(withPop.map(function (r) { return Number(r.pop); })) : 0;
    var smallInc = withPop.filter(function (r) { return Number(r.pop) <= popMed; }).map(function (r) { return r.inc; });
    var bigInc = withPop.filter(function (r) { return Number(r.pop) > popMed; }).map(function (r) { return r.inc; });
    var spreadOf = function (a) { var l = a.length > 4 ? quant(a, .1) : 0; return l > 0 ? quant(a, .9) / l : NaN; };
    var rSmall = spreadOf(smallInc), rBig = spreadOf(bigInc), hasPop = isFinite(rSmall) && isFinite(rBig);
    var kotaInc = Object.keys(KOTA).map(function (k) { var v = pts.filter(function (r) { return r.kota === k; }).map(function (r) { return r.inc; }); return v.length ? {n: k.replace('Kota Jakarta ', ''), m: median(v)} : null; }).filter(Boolean).sort(function (a, b) { return b.m - a.m; });
    var outRange = pts.filter(function (r) { return r.inc < .1 || r.inc > 12; }).length;
    explain([
      {t: 'Cara membaca singkat', i: [
        'Satu titik = satu kelurahan. Sumbu X adalah skor paparan, sumbu Y adalah insiden ISPA 2025 per 1.000 penduduk dengan skala logaritmik (tiap kelipatan sepuluh berjarak sama). Warna menunjukkan kota.',
        'Jika skor memprediksi insiden, titik membentuk pola menaik dari kiri-bawah ke kanan-atas; awan tanpa arah berarti tidak ada hubungan. ρ Spearman: +1 searah sempurna, 0 tidak ada hubungan, −1 berlawanan sempurna; |ρ| di bawah 0,1 dapat diabaikan, 0,1–0,3 lemah, 0,3–0,5 sedang, di atas 0,5 kuat.']},
      {t: 'Fenomena yang dapat dijelaskan dari grafik ini', k: 'phen', i: [
        ['1. Yang diukur satelit berbeda dari pemicu utama ISPA.', 'Skor menangkap kondisi permukaan dan udara ambien (LST, NO₂, vegetasi, bangunan, jalan). ISPA lebih kuat dipengaruhi hal yang tidak terlihat satelit: kepadatan hunian dan ventilasi rumah, asap rokok dan bahan bakar memasak di dalam rumah, status gizi dan imunisasi, serta penularan antar-orang. Paparan ambien bisa tinggi tanpa insiden tinggi, dan sebaliknya.'],
        ['2. Kepadatan penduduk menutupi hubungan.', 'Skor cenderung lebih rendah di kelurahan padat (ρ sekitar −0,63), padahal kelurahan padat lebih mudah mengalami penularan. Dua efek yang berlawanan ini kemungkinan saling meniadakan sehingga korelasi mentah mendekati nol (uji awal di panel metodologi: sekitar −0,04 untuk rata-rata 4 kuartal); setelah kepadatan dikontrol, hubungannya justru negatif lemah–sedang (korelasi parsial sekitar −0,32). Ini penjelasan yang konsisten dengan hasil uji, belum bukti bahwa kepadatan adalah penyebabnya.'],
        ['3. Insiden mencerminkan akses layanan, bukan hanya kejadian penyakit.', 'Kasus dihitung dari pasien di fasilitas kesehatan. Kelurahan yang memiliki banyak klinik atau rumah sakit dapat mencatat lebih banyak pasien, termasuk warga dari kelurahan lain, sedangkan kelurahan tanpa fasilitas tampak rendah walau kasus sebenarnya tidak jauh berbeda.'],
        ['4. Angka di kelurahan kecil mudah berayun.', hasPop ? 'Rasio persentil 90 terhadap 10 insiden adalah ' + fmt(rSmall, 1) + ' kali pada kelurahan berpenduduk di bawah median dan ' + fmt(rBig, 1) + ' kali pada yang di atas median. ' + (rSmall > rBig ? 'Kelurahan berpenduduk kecil memang lebih ekstrem: satu-dua kasus tambahan mengubah angka per 1.000 secara besar (masalah angka kecil), sehingga sebaran vertikal melebar tanpa berkaitan dengan skor.' : 'Pada data ini kelurahan kecil tidak lebih ekstrem, jadi efek angka kecil bukan penjelas utama lebarnya sebaran vertikal.') : 'Kelurahan berpenduduk kecil cenderung punya angka per 1.000 yang lebih berayun, karena satu-dua kasus tambahan mengubah angkanya secara besar.'],
        ['5. Waktu skor dan insiden tidak sejajar.', 'Skor berubah musiman, sedangkan insiden hanya satu angka tahunan. Peningkatan ISPA dapat terjadi pada pancaroba dan musim hujan, sementara skor memuncak pada kemarau (Q2–Q3). Jika pola itu berlaku di Jakarta, hubungan per kuartal bisa berlawanan dari yang diharapkan, tetapi hal ini belum bisa diuji dengan data tahunan.']]},
      {t: 'Yang terlihat pada data ini', k: 'find', i: [
        'ρ = ' + (sp.rho >= 0 ? '+' : '−') + fmt(Math.abs(sp.rho), 2) + ' (' + strength(sp.rho) + '). ' + (Math.abs(sp.rho) < .1 ? 'Dengan |ρ| sekecil ini, mengetahui skor sebuah kelurahan hampir tidak membantu menebak insidennya.' : sp.rho < 0 ? 'Arahnya negatif: kelurahan dengan skor lebih tinggi cenderung punya insiden lebih rendah, berlawanan dengan harapan; lihat poin 2 tentang kepadatan penduduk.' : 'Arahnya positif sesuai harapan, tetapi belum membuktikan sebab-akibat.'),
        'Insiden di persentil 10 dan 90 adalah ' + fmt(p10, 2) + ' dan ' + fmt(p90, 2) + ' per 1.000 (selisih ' + fmt(p10 > 0 ? p90 / p10 : 0, 1) + ' kali), jadi sebaran insiden antar-kelurahan sangat lebar. Pada rentang persentil yang sama, skor berselisih ' + fmt(xr, 2) + ' pada skala 0–1.',
        'Berdasarkan median skor dan median insiden, jumlah kelurahan per kuadran: skor tinggi–insiden tinggi ' + quad.hh + '; skor tinggi–insiden rendah ' + quad.hl + '; skor rendah–insiden tinggi ' + quad.lh + '; skor rendah–insiden rendah ' + quad.ll + '. Jika keempatnya hampir sama banyak, tidak ada pola yang jelas.'].concat(kotaInc.length > 1 ? ['Median insiden per kota tertinggi di ' + kotaInc[0].n + ' (' + fmt(kotaInc[0].m, 2) + ') dan terendah di ' + kotaInc[kotaInc.length - 1].n + ' (' + fmt(kotaInc[kotaInc.length - 1].m, 2) + '). Perbedaan antar-kota seperti ini dapat mencerminkan sebaran fasilitas dan pelaporan (poin 3); grafik ini tidak bisa memisahkannya dari perbedaan kondisi lingkungan atau penduduk.'] : [])},
      {t: 'Hal yang perlu diwaspadai', k: 'warn', i: [
        'Pola antar-kelurahan tidak boleh dibaca sebagai risiko setiap penduduknya, dan bukan bukti sebab-akibat.',
        'Kasus hanya tersedia tahunan 2025, sehingga skor per kuartal belum bisa diuji terhadap kasus per kuartal.',
        'Grafik ini belum mengontrol kepadatan penduduk; uji dengan kontrol kepadatan ada di panel "Tentang Indeks Paparan ISPA".'].concat(outRange > 0 ? [outRange + ' kelurahan memiliki insiden di luar rentang sumbu (di bawah 0,1 atau di atas 12 per 1.000) sehingga tidak tergambar, tetapi tetap dihitung dalam korelasi.'] : [])}
    ]);
  }

  function render() {
    if (ov.hidden) return;
    tabBtns.forEach(function (b, i) { b.setAttribute('aria-selected', String(i === state.tab)); });
    qBar.style.display = state.tab === 0 ? 'none' : 'flex';
    qBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === state.q)); });
    Array.prototype.slice.call(wrap.querySelectorAll('svg')).forEach(function (n) { n.remove(); });
    legend.innerHTML = ''; tip.style.display = 'none'; guide.replaceChildren();
    var W = Math.max(280, wrap.clientWidth || body.clientWidth - 24 || 600);
    [drawLine, drawBars, drawScatter][state.tab](W);
  }

  /* tombol pintasan di panel "Konteks Musiman" dan "Tentang Indeks Paparan ISPA" */
  function waitFor(sel, cb) {
    var el = document.querySelector(sel); if (el) return cb(el);
    var mo = new MutationObserver(function () { var e = document.querySelector(sel); if (e) { mo.disconnect(); cb(e); } });
    mo.observe(document.documentElement, {childList: true, subtree: true});
  }
  waitFor('#index-methodology .methodology-content', function (c) {
    var b = h('button', {type: 'button', class: 'ch-link', 'aria-controls': 'charts-overlay'}, null, 'Buka grafik interaktif: skor vs insiden');
    b.style.margin = '0 0 10px'; b.addEventListener('click', function () { open(2); }); c.insertBefore(b, c.firstChild);
  });
  waitFor('#swipe-comparison', function (swipe) {
    var entry = h('details', {id: 'charts-entry'}, null);
    chartEntrySummary = h('summary', {}, entry, 'Lihat Grafik');
    chartEntrySummary.addEventListener('click', function (event) {
      event.preventDefault();
      open(0, chartEntrySummary);
    });
    swipe.parentNode.insertBefore(entry, swipe.nextSibling);
  });
  root.IspaCharts = {open: open, close: close};
}

if (typeof module !== 'undefined') module.exports = {spearman: spearman, rank: rank, erf: erf, fmt: fmt};
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
})(typeof window !== 'undefined' ? window : this);
