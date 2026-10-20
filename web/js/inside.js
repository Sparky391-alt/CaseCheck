/* Inside checks and damage reports. Photo the checklist inside a flight case, photo each item, mark it right or wrong. */
'use strict';

function zoomImg(key) {
  var z = 1, img = h('img', { alt: 'Photo' }), box = h('div', { class: 'zbox' }, img), note = h('div', { class: 'zmsg' }, 'Loading photo');
  function apply() { img.style.width = (z * 100) + '%'; img.style.height = (z * 100) + '%'; }
  function zoom(f) { z = Math.max(1, Math.min(5, z * f)); apply(); }
  apply();
  var btns = h('div', { class: 'zbtns' },
    h('button', { class: 'iconbtn', 'aria-label': 'Zoom in', onclick: function () { zoom(1.6); } }, icon('plus')),
    h('button', { class: 'iconbtn', 'aria-label': 'Zoom out', onclick: function () { zoom(1 / 1.6); } }, h('span', { style: { font: '700 26px/1 var(--display)' } }, '–')));
  img.addEventListener('dblclick', function () { z = z > 1 ? 1 : 2.5; apply(); });
  Photos.url(key).then(function (u) {
    if (u) { img.src = u; note.hidden = true; } else note.textContent = 'This photo is not on this phone yet. It loads when the phone is online.';
  });
  return h('div', { class: 'zwrap' }, box, note, btns);
}

function verdictBadge(line) {
  if (line.v === 'ok') return h('span', { class: 'badge in' }, 'Right');
  if (line.v === 'bad') return h('span', { class: 'badge bad' }, 'Wrong');
  if (line.v === 'miss') return h('span', { class: 'badge unl' }, 'Missing');
  return h('span', { class: 'badge wait' }, 'Not decided');
}
function insideCounts(chk) {
  var c = { ok: 0, bad: 0, miss: 0, open: 0, dmg: 0 };
  ((chk && chk.lines) || []).forEach(function (l) {
    if (l.v === 'ok') c.ok++; else if (l.v === 'bad') c.bad++; else if (l.v === 'miss') c.miss++; else c.open++;
    if (l.dmg) c.dmg++;
  });
  return c;
}
function thumbEl(key, cls) {
  var im = h('img', { class: cls || 'tn', alt: '' });
  Photos.url(key).then(function (u) { if (u) im.src = u; });
  return im;
}

// Look at one photo large. onDelete is optional.
function viewPhoto(key, title, onDelete) {
  var el = h('div', { class: 'planov' },
    h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { closeOv(el); } }, icon('x')), h('div', { class: 'grow' }, h('h1', null, title || 'Photo')),
      onDelete ? h('button', { class: 'btn small danger', onclick: async function () { if (await confirmDlg({ title: 'Delete this photo?', ok: 'Delete', danger: true })) { closeOv(el); onDelete(); } } }, 'Delete') : null),
    zoomImg(key));
  openOv(el);
}

/* ---------- inside check for one case ---------- */
function openInside(item) {
  var el, bodyEl = h('div', { class: 'insbody' });
  function chk() { if (!item.chk) item.chk = { pages: [], lines: [] }; return item.chk; }
  async function commit() { await saveItem(item); draw(); if (typeof refreshView === 'function') refreshView(); }
  var uid = function () { return Store.uid().replace(/-/g, '').slice(0, 8); };

  async function addPage() {
    var b = await Photos.shoot({ title: 'Checklist photo', hint: 'Fill the frame with the checklist' });
    if (!b) return;
    var key = 'ck:' + item.id + ':p' + uid();
    await Photos.save(key, b); chk().pages.push(key); chk().doneAt = null; await commit();
  }
  async function photoItems() {
    for (;;) {
      var b = await Photos.shoot({ title: 'Item photo', hint: 'Photo the item you are checking' });
      if (!b) break;
      var id = uid(), line = { id: id, key: 'ck:' + item.id + ':' + id, v: null, n: '', at: Date.now() };
      await Photos.save(line.key, b); chk().lines.push(line); chk().doneAt = null; await saveItem(item);
      var res = await openCompare(item, line);
      draw();
      if (res !== 'saved') break;
    }
    if (typeof refreshView === 'function') refreshView();
  }
  function missingSheet() {
    var t = h('textarea', { rows: 3, placeholder: 'What is missing? For example: HDMI cable, 2 of 4', style: { minHeight: '90px' } }), s;
    s = sheet('Something is missing', [t, h('button', { class: 'btn primary block', onclick: async function () {
      var txt = t.value.trim(); if (!txt) { toast('Type what is missing'); return; }
      chk().lines.push({ id: uid(), key: null, v: 'miss', n: txt, at: Date.now(), by: Store.who() }); chk().doneAt = null;
      closeOv(s.el); await commit();
    } }, 'Save')]);
    setTimeout(function () { t.focus(); }, 200);
  }
  async function finish() {
    var c = insideCounts(chk());
    if (c.open && !(await confirmDlg({ title: c.open + ' item photo' + (c.open > 1 ? 's are' : ' is') + ' not decided', body: 'Finish anyway?', ok: 'Finish' }))) return;
    chk().doneAt = Date.now(); chk().by = Store.who() || ''; await commit(); toast('Inside check saved');
  }

  function draw() {
    var c = chk(), cs = insideCounts(c), kids = [];
    kids.push(h('div', { class: 'inshead' }, zoneChip(item.zone), h('div', { class: 'sn' }, nm(item)), item.desc ? h('div', { class: 'ds' }, item.desc) : null));
    // Checklist photos
    kids.push(h('h3', { class: 'inshd' }, '1  Checklist inside the case'));
    if (c.pages.length) kids.push(h('div', { class: 'thumbs' }, c.pages.map(function (k, i) {
      return h('button', { class: 'thumb', 'aria-label': 'Checklist page ' + (i + 1), onclick: function () {
        viewPhoto(k, 'Checklist ' + (i + 1) + ' of ' + c.pages.length, async function () { c.pages = c.pages.filter(function (x) { return x !== k; }); await commit(); });
      } }, thumbEl(k));
    })));
    kids.push(h('button', { class: 'btn ' + (c.pages.length ? 'small' : 'yellow block'), style: c.pages.length ? { justifySelf: 'start' } : null, onclick: addPage }, icon('scan'), c.pages.length ? 'Add another page' : 'Photo the checklist'));
    // Items
    kids.push(h('h3', { class: 'inshd' }, '2  Check each item'));
    kids.push(h('div', { class: 'row wrap' },
      h('button', { class: 'btn yellow grow', disabled: !c.pages.length, onclick: photoItems }, icon('scan'), 'Photo an item'),
      h('button', { class: 'btn grow', onclick: missingSheet }, 'Missing item')));
    if (!c.pages.length) kids.push(h('div', { class: 'hint2' }, 'Photo the checklist first. Then each item is compared to it.'));
    if (c.lines.length) {
      kids.push(h('div', { class: 'row wrap' },
        h('span', { class: 'badge in' }, cs.ok + ' right'), h('span', { class: 'badge bad' }, cs.bad + ' wrong'), h('span', { class: 'badge unl' }, cs.miss + ' missing'),
        cs.open ? h('span', { class: 'badge wait' }, cs.open + ' not decided') : null, cs.dmg ? h('span', { class: 'badge bad' }, cs.dmg + ' damaged') : null));
      kids.push(h('div', { class: 'items' }, c.lines.map(function (l, i) {
        return h('button', { class: 'item line', style: { gridTemplateColumns: '64px 1fr auto' }, onclick: async function () { await openCompare(item, l); draw(); } },
          l.key ? thumbEl(l.key, 'tn sm') : h('div', { class: 'tn sm none' }, '?'),
          h('div', null, h('div', { class: 'sn', style: { fontSize: '15px' } }, 'Photo ' + (i + 1) + (l.dmg ? ' · damaged' : '')), h('div', { class: 'ds' }, l.n || (l.v === 'miss' ? 'Missing' : ''))),
          verdictBadge(l));
      })));
    }
    // Finish
    if (c.doneAt) kids.push(h('div', { class: 'note good' }, 'Finished ' + fmtT(c.doneAt) + (c.by ? ' by ' + c.by : '')));
    kids.push(h('button', { class: 'btn primary block', disabled: !c.lines.length, onclick: finish }, c.doneAt ? 'Finish again' : 'Finish check'));
    bodyEl.replaceChildren.apply(bodyEl, kids);
  }

  el = h('div', { class: 'planov' },
    h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { closeOv(el); } }, icon('x')), h('div', { class: 'grow' }, h('h1', null, 'Inside check'))),
    bodyEl);
  openOv(el);
  draw();
}

/* ---------- compare one item photo with the checklist ---------- */
function openCompare(item, line) {
  return new Promise(function (resolve) {
    var pages = (item.chk && item.chk.pages) || [], pi = 0, outcome = 'closed', el;
    var top = h('div', { class: 'cmp' }), pageLbl = h('span', { class: 'mute', style: { fontWeight: '600' } });
    var topZoom = h('div', { class: 'cmpbox' });
    function showPage() {
      topZoom.replaceChildren(zoomImg(pages[pi]));
      pageLbl.textContent = pages.length > 1 ? (pi + 1) + ' of ' + pages.length : '';
    }
    var note = h('input', { type: 'text', placeholder: 'Note, for example: wrong cable length', value: line.n || '' });
    var dmg = h('input', { type: 'checkbox', id: 'cmpDmg' }); dmg.checked = !!line.dmg;
    var hint = h('div', { class: 'hint2', id: 'cmpHint' });
    async function decide(v) {
      line.v = v; line.n = note.value.trim(); line.dmg = dmg.checked; line.by = Store.who(); line.at = Date.now();
      item.dmg = (item.dmg || []).filter(function (d) { return d.id !== line.id; });
      if (line.dmg) item.dmg.push({ id: line.id, key: line.key, n: line.n || 'Damaged, found in the inside check', at: line.at, by: line.by, from: 'inside' });
      await saveItem(item); outcome = 'saved'; closeOv(el);
    }
    var bottom = h('div', { class: 'cmpbox' }, zoomImg(line.key));
    el = h('div', { class: 'planov' },
      h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { closeOv(el); } }, icon('x')), h('div', { class: 'grow' }, h('h1', null, 'Is it right?'))),
      h('div', { class: 'cmp' },
        h('div', { class: 'cmplbl' }, h('span', null, 'Checklist'), h('span', { class: 'grow' }), pageLbl,
          pages.length > 1 ? h('button', { class: 'btn small', onclick: function () { pi = (pi + 1) % pages.length; showPage(); } }, 'Next page') : null),
        topZoom,
        h('div', { class: 'cmplbl' }, h('span', null, 'Item photo'), h('span', { class: 'grow' }),
          h('button', { class: 'btn small', onclick: async function () {
            var b = await Photos.shoot({ title: 'Retake item photo', hint: 'Photo the item you are checking' });
            if (b) { await Photos.save(line.key, b); Photos.forget(line.key); bottom.replaceChildren(zoomImg(line.key)); }
          } }, 'Retake')),
        bottom, hint,
        h('div', { class: 'cmpact' },
          h('input', { type: 'hidden' }), note,
          h('label', { class: 'row', style: { gap: '10px', fontWeight: '600' } }, dmg, 'It is damaged'),
          h('div', { class: 'row' },
            h('button', { class: 'btn grow good', onclick: function () { decide('ok'); } }, 'Right'),
            h('button', { class: 'btn grow bad', onclick: function () { decide('bad'); } }, 'Wrong')),
          h('button', { class: 'btn small danger', style: { justifySelf: 'center' }, onclick: async function () {
            if (!(await confirmDlg({ title: 'Delete this line?', ok: 'Delete', danger: true }))) return;
            item.chk.lines = item.chk.lines.filter(function (l) { return l.id !== line.id; });
            item.dmg = (item.dmg || []).filter(function (d) { return d.id !== line.id; });
            await saveItem(item); outcome = 'deleted'; closeOv(el);
          } }, 'Delete this line'))));
    if (pages.length) showPage(); else topZoom.replaceChildren(h('div', { class: 'zmsg' }, 'No checklist photo yet'));
    openOv(el, function () { resolve(outcome); });
    window.__cmpHint = hint;   // the match hint fills this in
    if (typeof matchHint === 'function' && pages.length && line.key) matchHint(pages, line.key, hint);
  });
}

/* ---------- damage photos for any item ---------- */
function openDamage(item) {
  var el, bodyEl = h('div', { class: 'insbody' });
  var uid = function () { return Store.uid().replace(/-/g, '').slice(0, 8); };
  async function add() {
    var b = await Photos.shoot({ title: 'Damage photo', hint: 'Show the damage clearly' });
    if (!b) return;
    var id = uid(), key = 'dm:' + item.id + ':' + id; await Photos.save(key, b);
    var t = h('textarea', { rows: 3, placeholder: 'What is damaged? For example: corner dented, lid cracked', style: { minHeight: '90px' } }), s;
    var saved = false;
    s = sheet('What is damaged?', [h('div', { class: 'row' }, thumbEl(key, 'tn')), t, h('button', { class: 'btn primary block', onclick: async function () {
      saved = true; (item.dmg = item.dmg || []).push({ id: id, key: key, n: t.value.trim(), at: Date.now(), by: Store.who() });
      closeOv(s.el); await saveItem(item); draw(); if (typeof refreshView === 'function') refreshView();
    } }, 'Save damage')], { onClose: async function () { if (!saved) { await Store.deletePhoto(key); await Store.donePhoto(key); } } });
    setTimeout(function () { t.focus(); }, 200);
  }
  function draw() {
    var list = item.dmg || [], kids = [];
    kids.push(h('div', { class: 'inshead' }, zoneChip(item.zone), h('div', { class: 'sn' }, nm(item)), item.desc ? h('div', { class: 'ds' }, item.desc) : null));
    kids.push(h('button', { class: 'btn yellow block', onclick: add }, icon('scan'), 'Add damage photo'));
    if (!list.length) kids.push(h('div', { class: 'hint2' }, 'No damage reported for this item.'));
    kids.push(h('div', { class: 'items' }, list.map(function (d) {
      return h('button', { class: 'item line', style: { gridTemplateColumns: '64px 1fr' }, onclick: function () {
        viewPhoto(d.key, 'Damage', async function () { item.dmg = item.dmg.filter(function (x) { return x.id !== d.id; }); await saveItem(item); draw(); if (typeof refreshView === 'function') refreshView(); });
      } }, thumbEl(d.key, 'tn sm'), h('div', null, h('div', { class: 'sn', style: { fontSize: '15px' } }, d.n || 'Damage'), h('div', { class: 'ds' }, fmtT(d.at) + (d.by ? ' · ' + d.by : ''))));
    })));
    bodyEl.replaceChildren.apply(bodyEl, kids);
  }
  el = h('div', { class: 'planov' },
    h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { closeOv(el); } }, icon('x')), h('div', { class: 'grow' }, h('h1', null, 'Damage'))),
    bodyEl);
  openOv(el); draw();
}
