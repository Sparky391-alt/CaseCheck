/* Shared interface helpers: DOM builder, icons, back button handling, overlays, feedback. */
'use strict';

function h(tag, props) {
  var el = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k.indexOf('aria-') === 0) { if (v != null) el.setAttribute(k, String(v)); return; }
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'list' || k === 'form') el.setAttribute(k, v);
      else if (k in el) { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}
function append(el, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
  el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
}

var ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  scan: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  zones: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  menu: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'
};
function icon(name) {
  return h('span', { html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>', style: { display: 'contents' } });
}

/* ---------- formatting ---------- */
var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function p2(n) { return String(n).padStart(2, '0'); }
function fmtT(ts) { if (!ts) return ''; var d = new Date(ts); return DAYS[d.getDay()] + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function fmtFull(ts) { if (!ts) return ''; var d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function fmtDay(ts) { var d = new Date(ts); return DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1); }

/* ---------- zone colours ---------- */
var PALETTE = ['#D92D20', '#F07A00', '#F2C200', '#1FA353', '#0E9AA7', '#2D5BFF', '#7A3FD1', '#E5408F', '#F2F2F2', '#14181B', '#8A5A2B', '#7C8B99'];
function textOn(hex) {
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#101417' : '#FFFFFF';
}
function fitSize(name) {
  var n = String(name || '').length;
  var vw = n <= 2 ? 46 : n <= 4 ? 34 : n <= 7 ? 22 : n <= 12 ? 14 : n <= 20 ? 10 : 7;
  return 'min(' + vw + 'vw, ' + vw * 6 + 'px)';
}

/* ---------- feedback ---------- */
var actx = null;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.resume) actx.resume();
    var seq = kind === 'ok' ? [[880, 0.09], [1320, 0.13]] : kind === 'warn' ? [[520, 0.15], [520, 0.15]] : [[200, 0.3]];
    var t = actx.currentTime;
    seq.forEach(function (s) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = s[0]; g.gain.value = 0.05;
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + s[1]); t += s[1] + 0.03;
    });
  } catch (e) { /* sound is optional */ }
}
function feedback(kind) {
  beep(kind);
  try { if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? [60] : kind === 'warn' ? [90, 60, 90] : [260]); } catch (e) { /* optional */ }
}
function toast(msg) {
  var old = document.querySelector('.toast'); if (old) old.remove();
  var t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}

/* ---------- navigation ----------
   The phone back button pops one browser history entry. We keep one spare entry armed at all
   times and handle the press ourselves, so screens and overlays are plain in-memory stacks. */
var Nav = { stack: [{ t: 'screen', route: { s: 'home' } }], exitArmed: false, exitTimer: null, renderFn: null };

function navArm() { try { history.pushState({ arm: 1 }, ''); } catch (e) { /* ignore */ } }
function navInit(renderFn) {
  Nav.renderFn = renderFn;
  try { history.replaceState({ base: 1 }, ''); } catch (e) { /* ignore */ }
  navArm();
  window.addEventListener('popstate', navBack);
}
function curScreen() {
  for (var i = Nav.stack.length - 1; i >= 0; i--) if (Nav.stack[i].t === 'screen') return Nav.stack[i];
}
function topEntry() { return Nav.stack[Nav.stack.length - 1]; }
function goScreen(route) { Nav.stack.push({ t: 'screen', route: route }); Nav.renderFn(); }
function replaceScreen(route) { curScreen().route = route; Nav.renderFn(); }
function popScreen() { if (Nav.stack.length > 1) { Nav.stack.pop(); Nav.renderFn(); } }

function openOv(el, onClose) {
  document.getElementById('ov').appendChild(el);
  Nav.stack.push({ t: 'ov', el: el, onClose: onClose });
  return el;
}
function closeOv(el) {
  var idx = -1;
  for (var i = Nav.stack.length - 1; i >= 0; i--) if (Nav.stack[i].el === el) { idx = i; break; }
  if (idx < 0) return;
  while (Nav.stack.length > idx) {
    var e = Nav.stack.pop();
    if (e.t === 'ov') { e.el.remove(); if (e.onClose) e.onClose(); }
  }
}
function navBack() {
  var top = topEntry();
  if (top.t === 'ov') { closeOv(top.el); navArm(); return; }
  if (Nav.stack.length > 1) { popScreen(); navArm(); return; }
  if (Nav.exitArmed) {
    if (window.Android && Android.exit) { Android.exit(); return; }
    navArm(); return;
  }
  Nav.exitArmed = true;
  toast('Press back again to exit');
  clearTimeout(Nav.exitTimer);
  Nav.exitTimer = setTimeout(function () { Nav.exitArmed = false; }, 2200);
  navArm();
}

/* ---------- sheets and dialogs ---------- */
function sheet(title, bodyNodes, opts) {
  opts = opts || {};
  var el;
  var close = function () { closeOv(el); };
  var head = h('div', { class: 'head' }, h('h2', null, title),
    h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, icon('x')));
  var body = h('div', { class: 'body' }, bodyNodes);
  el = h('div', { class: 'sheetroot', style: { position: 'absolute', inset: '0' } },
    h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'grab' }), head, body));
  openOv(el, opts.onClose);
  return { el: el, body: body, close: close };
}

function confirmDlg(o) {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (v) { if (done) return; done = true; resolve(v); };
    var s = sheet(o.title, [
      o.body ? h('p', { style: { margin: '0', color: 'var(--ink2)' } }, o.body) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: function () { finish(false); s.close(); } }, 'Cancel'),
        h('button', { class: 'btn grow ' + (o.danger ? 'danger' : 'primary'), onclick: function () { finish(true); s.close(); } }, o.ok || 'OK'))
    ], { onClose: function () { finish(false); } });
  });
}

/* ---------- CSV ---------- */
function csvCell(v) {
  var s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }

function shareText(name, text) {
  if (window.Android && Android.share) { Android.share(name, text); return Promise.resolve('shared'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); return 'copied'; });
  }
  return Promise.resolve('none');
}

/* ---------- problem log ----------
   Keeps the last few events and errors so a failure on the phone can be read and shared. */
var Diag = {
  key: 'cc_log',
  all: function () { try { return JSON.parse(localStorage.getItem(Diag.key) || '[]'); } catch (e) { return []; } },
  log: function (msg) {
    try {
      var a = Diag.all(); a.push(fmtFull(Date.now()) + '  ' + String(msg).slice(0, 300));
      localStorage.setItem(Diag.key, JSON.stringify(a.slice(-40)));
    } catch (e) { /* storage may be blocked */ }
  },
  clear: function () { try { localStorage.removeItem(Diag.key); } catch (e) { /* ignore */ } }
};
window.addEventListener('error', function (e) { Diag.log('ERROR ' + (e.message || '') + ' ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); });
window.addEventListener('unhandledrejection', function (e) { Diag.log('REJECTED ' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
