/* Site plan: the layout drawing for the event. Pan, zoom, and pin each zone where it goes. */
'use strict';

function planKey(pid, i) { return 'plan:' + pid + ':' + i; }
// Pages have their own id so every phone in a team uses the same key for the same picture.
function planPageKey(pg) { return 'planpg:' + pg.id; }
function planPageList(p) { return ((p && p.plan && p.plan.pages) || []).filter(function (g) { return g.id; }).map(function (g) { return { id: g.id, name: g.name, w: g.w, h: g.h }; }); }
// Older pages had no id. Give them one and queue the picture for the team.
async function planMigrate(p) {
  var pages = (p && p.plan && p.plan.pages) || [], changed = false;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i].id) continue;
    var rec = await Store.getPhoto(planKey(p.id, i));
    pages[i].id = uid6(); changed = true;
    if (rec && rec.blob) { await Store.putPhoto(planPageKey(pages[i]), rec.blob, true); await Store.deletePhoto(planKey(p.id, i)); }
  }
  if (changed) await Store.putProject(p);
}
// Keep a plan picture small enough to send to the team over a phone connection.
async function planShrink(blob, w, h) {
  if (blob.size <= 2.5e6 && Math.max(w, h) <= 3200) return { blob: blob, w: w, h: h };
  var bmp = await createImageBitmap(blob), sc = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  var out = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', 0.82); });
  var res = { blob: out, w: cv.width, h: cv.height }; cv.width = cv.height = 1;
  return res;
}

/* Drop offs. Equipment goes to one of two places on site. Each zone can have several pins, each pin tagged with its drop off. */
var DROP_KINDS = ['Screens and Speakers', 'AV room'];
var DROP_RE = /\b(led|leds|screen|screens|display|displays|monitor|monitors|tv|tvs|video wall|projector|projectors|speaker|speakers|spk|subwoofer|subwoofers|sub|subs|line array|amp|amps|amplifier|amplifiers)\b/i;
function uid6() { return Math.random().toString(36).slice(2, 8); }
// The pins of a project. Older projects kept one pin per zone; they are turned into pins that fit any drop off.
function planPts(p) {
  var pl = p && p.plan; if (!pl) return [];
  if (!pl.points) {
    pl.points = [];
    Object.keys(pl.pins || {}).forEach(function (z) { var o = pl.pins[z]; pl.points.push({ id: uid6(), zone: z, kind: '', page: o.page, x: o.x, y: o.y }); });
    pl.pins = {};
  }
  return pl.points;
}
function dropGuess(it) {
  var txt = [it.serial, it.desc, it.group].concat((it.raw || []).map(function (r) { return r[1]; })).join(' ');
  return DROP_RE.test(txt) ? DROP_KINDS[0] : DROP_KINDS[1];
}
function dropKind(it) { return it.drop && DROP_KINDS.indexOf(it.drop) >= 0 ? it.drop : dropGuess(it); }
// The pins that show where this item goes: its zone, and its drop off if the zone has pins for it.
function pinsFor(p, item) {
  var zone = item.zone, kind = dropKind(item), all = planPts(p).filter(function (q) { return q.zone === zone; });
  var exact = all.filter(function (q) { return q.kind === kind || !q.kind; });
  return exact.length ? exact : all;
}

// Turn a chosen file into page images: { blob, name, w, h }.
async function planPagesFrom(file) {
  var out = [], isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isPdf) {
    await loadPdfLib();
    var doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    var n = Math.min(doc.numPages, 12);
    for (var i = 1; i <= n; i++) {
      var pg = await doc.getPage(i), v1 = pg.getViewport({ scale: 1 });
      var sc = Math.min(3, 2800 / Math.max(v1.width, v1.height));
      var vp = pg.getViewport({ scale: sc });
      var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: cx, viewport: vp }).promise;
      var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
      out.push({ blob: blob, name: file.name.replace(/\.[^.]+$/, '') + (doc.numPages > 1 ? ' ' + i : ''), w: cv.width, h: cv.height });
      cv.width = cv.height = 1;
    }
  } else {
    var bmp = await createImageBitmap(file);
    var blob2 = file;
    var w = bmp.width, h2 = bmp.height;
    if (file.size > 9e6 || Math.max(w, h2) > 4200) {
      var s = Math.min(1, 4000 / Math.max(w, h2)), cv2 = document.createElement('canvas');
      cv2.width = Math.round(w * s); cv2.height = Math.round(h2 * s);
      cv2.getContext('2d').drawImage(bmp, 0, 0, cv2.width, cv2.height);
      blob2 = await new Promise(function (r) { cv2.toBlob(r, 'image/jpeg', 0.9); });
      w = cv2.width; h2 = cv2.height;
    }
    out.push({ blob: blob2, name: file.name.replace(/\.[^.]+$/, ''), w: w, h: h2 });
  }
  return out;
}

async function planAdd(files) {
  var p = P.project;
  p.plan = p.plan || { pages: [], pins: {}, points: [] };
  for (var f = 0; f < files.length; f++) {
    var pages = await planPagesFrom(files[f]);
    for (var k = 0; k < pages.length; k++) {
      var sm = await planShrink(pages[k].blob, pages[k].w, pages[k].h);
      var pg = { id: uid6(), name: pages[k].name, w: sm.w, h: sm.h };
      await Store.putPhoto(planPageKey(pg), sm.blob, true);
      p.plan.pages.push(pg);
    }
  }
  await Store.putProject(p);
}
async function planClear() {
  var p = P.project;
  var clr = Date.now();
  if (p.plan) for (var i = 0; i < p.plan.pages.length; i++) await Store.deletePhoto(p.plan.pages[i].id ? planPageKey(p.plan.pages[i]) : planKey(p.id, i));
  var keep = planPts(p); p.plan = keep.length || p.team ? { pages: [], pins: {}, points: keep, clr: clr } : null; await Store.putProject(p);
}

// opts: { zone, kind } focuses the pins for that zone and drop off.
function openPlan(opts) {
  opts = opts || {};
  var p = P.project, el, page = 0, url = null, editing = false, sel = opts.zone || null, selKind = opts.kind || DROP_KINDS[0], selPt = null;
  var focusIds = {};
  if (opts.zone) planPts(p).forEach(function (q) { if (q.zone === opts.zone && (!opts.kind || q.kind === opts.kind || !q.kind)) focusIds[q.id] = 1; });
  if (opts.zone && !Object.keys(focusIds).length) planPts(p).forEach(function (q) { if (q.zone === opts.zone) focusIds[q.id] = 1; });
  var V = { s: 1, x: 0, y: 0, fit: 1, iw: 1, ih: 1 };
  var wrap = h('div', { class: 'planwrap' }), inner = h('div', { class: 'planin' }), img = h('img', { alt: 'Site plan' });
  var foot = h('div', { class: 'planfoot' }), titleEl = h('h1', null, 'Site plan');
  var pageLbl = h('span', { class: 'mute', style: { fontWeight: '600', minWidth: '4ch', textAlign: 'center' } });
  var input = h('input', { type: 'file', multiple: true, accept: 'image/*,.pdf,application/pdf', hidden: true, onchange: onFiles });
  inner.appendChild(img); wrap.appendChild(inner);

  function apply() {
    inner.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.s + ')';
    Array.prototype.forEach.call(inner.querySelectorAll('.pin'), function (n) { n.style.transform = 'translate(-50%,-100%) scale(' + (1 / V.s) + ')'; });
  }
  function clampView() {
    var r = wrap.getBoundingClientRect(), w = V.iw * V.s, hh = V.ih * V.s, m = 60;
    V.x = Math.min(r.width - m, Math.max(m - w, V.x)); V.y = Math.min(r.height - m, Math.max(m - hh, V.y));
  }
  function fit() {
    var r = wrap.getBoundingClientRect();
    V.fit = Math.min(r.width / V.iw, r.height / V.ih) || 1; V.s = V.fit;
    V.x = (r.width - V.iw * V.s) / 2; V.y = (r.height - V.ih * V.s) / 2; apply();
  }
  function shortKind(k) { return k === DROP_KINDS[0] ? 'Screens/Speakers' : k === DROP_KINDS[1] ? 'AV room' : ''; }
  function pinsOnPage() {
    inner.querySelectorAll('.pin').forEach(function (n) { n.remove(); });
    planPts(p).forEach(function (q) {
      if (q.page !== page) return;
      var zi = zoneInfo(q.zone), on = focusIds[q.id], sl = selPt === q.id && editing;
      inner.appendChild(h('div', { class: 'pin' + (on ? ' focus' : '') + (sl ? ' sel' : '') + (q.kind === DROP_KINDS[1] ? ' av' : ''), style: { left: (q.x * 100) + '%', top: (q.y * 100) + '%', color: zi.color } },
        h('b', { style: { background: zi.color, color: textOn(zi.color) } }, q.zone, shortKind(q.kind) ? h('small', null, shortKind(q.kind)) : null), h('i')));
    });
    apply();
  }
  // Zoom so all the pins that matter are in view.
  function focusPins() {
    var ids = Object.keys(focusIds), pts = planPts(p).filter(function (q) { return focusIds[q.id]; });
    if (!pts.length) return;
    if (!pts.some(function (q) { return q.page === page; })) { page = pts[0].page; loadPage(true); return; }
    pts = pts.filter(function (q) { return q.page === page; });
    var r = wrap.getBoundingClientRect(), x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    pts.forEach(function (q) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
    var bw = Math.max((x1 - x0) * V.iw, 1), bh = Math.max((y1 - y0) * V.ih, 1);
    var sc = Math.min((r.width * 0.7) / bw, (r.height * 0.6) / bh, V.fit * 4);
    V.s = Math.max(V.fit * (pts.length > 1 ? 1 : 2.2), sc);
    var cx = (x0 + x1) / 2 * V.iw * V.s, cy = (y0 + y1) / 2 * V.ih * V.s;
    V.x = r.width / 2 - cx; V.y = r.height / 2 - cy; clampView(); apply();
  }
  async function loadPage(focus) {
    var pages = (p.plan && p.plan.pages) || [];
    if (!pages.length) { draw(); return; }
    var rec = await Store.getPhoto(planPageKey(pages[page]));
    if (!rec && p.team && window.Sync) {
      toast('Loading the plan from the team');
      try { var got = await Sync.fetchPhoto(p.team.code, planPageKey(pages[page])); if (got) { await Store.putPhoto(planPageKey(pages[page]), got); rec = { blob: got }; } } catch (e) { /* offline */ }
    }
    if (!rec || !rec.blob) { toast('The plan page is not on this phone yet. Connect and try again.'); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(rec.blob);
    V.iw = pages[page].w; V.ih = pages[page].h;
    img.style.width = V.iw + 'px'; img.style.height = V.ih + 'px';
    inner.style.width = V.iw + 'px'; inner.style.height = V.ih + 'px';
    img.onload = function () { fit(); pinsOnPage(); if (focus) focusPins(); };
    img.src = url;
    pageLbl.textContent = (page + 1) + '/' + pages.length;
    titleEl.textContent = pages.length > 1 ? pages[page].name : 'Site plan';
    drawFoot();
  }

  /* gestures */
  var ptr = {}, g = null;
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function zoomAt(cx, cy, ns) {
    ns = Math.max(V.fit * 0.8, Math.min(V.fit * 14, ns));
    var k = ns / V.s; V.x = cx - (cx - V.x) * k; V.y = cy - (cy - V.y) * k; V.s = ns; clampView(); apply();
  }
  wrap.addEventListener('pointerdown', function (e) {
    wrap.setPointerCapture(e.pointerId);
    var r = wrap.getBoundingClientRect();
    ptr[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
    var ids = Object.keys(ptr);
    g = ids.length === 1 ? { t: 'pan', sx: ptr[ids[0]].x, sy: ptr[ids[0]].y, vx: V.x, vy: V.y, moved: 0, t0: Date.now() } :
      { t: 'pinch', d: dist(ptr[ids[0]], ptr[ids[1]]), s: V.s, moved: 99 };
  });
  wrap.addEventListener('pointermove', function (e) {
    if (!ptr[e.pointerId]) return;
    var r = wrap.getBoundingClientRect();
    ptr[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
    var ids = Object.keys(ptr);
    if (g && g.t === 'pan' && ids.length === 1) {
      var dx = ptr[ids[0]].x - g.sx, dy = ptr[ids[0]].y - g.sy;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      V.x = g.vx + dx; V.y = g.vy + dy; clampView(); apply();
    } else if (ids.length >= 2) {
      var a = ptr[ids[0]], b = ptr[ids[1]];
      if (!g || g.t !== 'pinch') g = { t: 'pinch', d: dist(a, b), s: V.s, moved: 99 };
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, g.s * dist(a, b) / (g.d || 1));
    }
  });
  function up(e) {
    var r = wrap.getBoundingClientRect(), tap = g && g.t === 'pan' && g.moved < 8 && Date.now() - g.t0 < 500;
    delete ptr[e.pointerId];
    if (tap && editing && p.plan) {
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var fx = (sx - V.x) / V.s / V.iw, fy = (sy - V.y) / V.s / V.ih, hit = null, best = 1e9;
      // A tap on an existing pin selects it. The label sits above the point.
      planPts(p).forEach(function (q) {
        if (q.page !== page) return;
        var px = V.x + q.x * V.iw * V.s, py = V.y + q.y * V.ih * V.s, dx = sx - px, dy = sy - py;
        if (Math.abs(dx) <= 70 && dy >= -56 && dy <= 14) { var d = Math.hypot(dx, dy + 20); if (d < best) { best = d; hit = q; } }
      });
      if (hit) { selPt = hit.id; sel = hit.zone; selKind = hit.kind || selKind; pinsOnPage(); drawFoot(); }
      else if (sel && fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
        var np = { id: uid6(), zone: sel, kind: selKind, page: page, x: fx, y: fy };
        planPts(p).push(np); selPt = np.id; Store.putProject(p); pinsOnPage(); drawFoot();
      }
    }
    if (!Object.keys(ptr).length) g = null;
  }
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  wrap.addEventListener('wheel', function (e) {
    e.preventDefault(); var r = wrap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, V.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
  }, { passive: false });
  wrap.addEventListener('dblclick', function (e) { var r = wrap.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, V.s * 2); });

  async function onFiles(e) {
    var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    toast('Reading the plan');
    try { await planAdd(files); page = 0; draw(); toast('Plan added'); } catch (err) { console.error(err); toast('Could not read that plan'); }
  }

  function drawFoot() {
    var plan = p.plan, zs = P.project.zones.map(function (z) { return z.name; }), pts = planPts(p);
    var chips = h('div', { class: 'chips' }, zs.map(function (z) {
      var n = pts.filter(function (q) { return q.zone === z; }).length, on = sel === z, zi = zoneInfo(z);
      return h('button', { class: 'chip', 'aria-pressed': String(on), style: { borderColor: zi.color, borderWidth: '2.5px', opacity: (!n && !editing) ? '.45' : '1' }, onclick: function () {
        sel = z; selPt = null;
        if (!editing && n) { focusIds = {}; pts.forEach(function (q) { if (q.zone === z) focusIds[q.id] = 1; }); pinsOnPage(); focusPins(); }
        else pinsOnPage();
        drawFoot();
      } }, z + (n ? ' · ' + n : ''));
    }));
    var kids = [chips];
    if (editing) {
      var kinds = h('div', { class: 'chips' }, DROP_KINDS.map(function (k) {
        return h('button', { class: 'chip', 'aria-pressed': String(selKind === k), onclick: function () {
          selKind = k;
          var cur = selPt && pts.filter(function (q) { return q.id === selPt; })[0];
          if (cur) { cur.kind = k; Store.putProject(p); pinsOnPage(); }
          drawFoot();
        } }, k);
      }));
      kids.push(kinds);
      kids.push(h('div', { class: 'hint2' }, !sel ? 'Pick a zone, then tap the plan. Tap again for more pins.' : selPt ? 'Pin selected. Tap its drop off above to change it, or tap the plan for another pin.' : 'Tap the plan to drop a pin for ' + sel + ' at ' + selKind + '. Add as many as you need.'));
      kids.push(h('div', { class: 'row' },
        h('button', { class: 'btn small grow', onclick: async function () {
          if (selPt && plan) { plan.points = planPts(p).filter(function (q) { return q.id !== selPt; }); selPt = null; await Store.putProject(p); pinsOnPage(); drawFoot(); }
          else toast('Tap a pin first');
        } }, 'Remove pin'),
        h('button', { class: 'btn small grow', onclick: function () { input.click(); } }, 'Add pages'),
        h('button', { class: 'btn small grow danger', onclick: async function () {
          if (await confirmDlg({ title: 'Remove the plan pages?', body: 'The plan pictures are deleted from this phone. The pins stay, so you can add the plan again.', ok: 'Remove', danger: true })) { await planClear(); draw(); }
        } }, 'Remove plan')));
    }
    foot.replaceChildren.apply(foot, kids);
  }

  function draw() {
    var pages = (p.plan && p.plan.pages) || [];
    var right = h('div', { class: 'row', style: { gap: '4px' } });
    if (pages.length > 1) {
      right.append(
        h('button', { class: 'iconbtn', 'aria-label': 'Previous page', onclick: function () { page = (page + pages.length - 1) % pages.length; loadPage(); } }, icon('back')),
        pageLbl,
        h('button', { class: 'iconbtn', 'aria-label': 'Next page', style: { transform: 'scaleX(-1)' }, onclick: function () { page = (page + 1) % pages.length; loadPage(); } }, icon('back')));
    }
    if (pages.length && !opts.ro) right.append(h('button', { class: 'btn small', 'aria-pressed': String(editing), onclick: function () { editing = !editing; focusIds = {}; selPt = null; draw(); } }, editing ? 'Done' : 'Pins'));
    var top = h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { closeOv(el); } }, icon('x')), h('div', { class: 'grow' }, titleEl), right);
    el.replaceChildren(top);
    if (!pages.length) {
      el.append(h('div', { class: 'planempty' },
        h('h2', { style: { fontSize: '30px' } }, 'Add the site plan'),
        h('p', { class: 'mute', style: { margin: 0, maxWidth: '30ch' } }, 'Choose the layout drawing, as a PDF or a picture. Then pin each zone where it goes.'),
        opts.ro ? null : h('button', { class: 'btn primary', onclick: function () { input.click(); } }, 'Choose plan')), input);
      return;
    }
    el.append(wrap, foot, input);
    loadPage(!!opts.zone);
  }

  el = h('div', { class: 'planov' });
  openOv(el, function () { if (url) URL.revokeObjectURL(url); });
  draw();
  return el;
}
