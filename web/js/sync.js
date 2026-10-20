/* Team sync. Phones that share a code share one project. Each item carries the time it last changed.
   The newest change wins. Works offline: changes wait and go out when the phone has signal again. */
var Sync = (function () {
  'use strict';
  var CFG = { url: 'https://kypbszvyizylvwyqzvzq.supabase.co', key: 'sb_publishable_fATttUOevRmEmFTuyVSLkQ_YQU9bL1G' };
  try { var o = JSON.parse(localStorage.getItem('cc_supa_test') || 'null'); if (o) CFG = o; } catch (e) { /* ignore */ }
  var st = { busy: false, err: '', last: 0, timer: null, deb: null, pending: 0 };
  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function code6() {
    var s = '', a = new Uint32Array(6);
    (self.crypto || window.crypto).getRandomValues(a);
    for (var i = 0; i < 6; i++) s += ALPHA[a[i] % ALPHA.length];
    return s;
  }
  function clean(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function api(code, path, opts) {
    opts = opts || {};
    var headers = { apikey: CFG.key, 'x-team': code, 'Content-Type': 'application/json' };
    if (opts.prefer) headers.Prefer = opts.prefer;
    var ctl = ('AbortController' in window) ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 25000) : null;
    return fetch(CFG.url + '/rest/v1/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (t) clearTimeout(t);
        return r.text().then(function (txt) {
          if (!r.ok) { var e = new Error('Sync server said ' + r.status + ' ' + txt.slice(0, 160)); e.status = r.status; throw e; }
          return txt ? JSON.parse(txt) : null;
        });
      }, function (err) { if (t) clearTimeout(t); throw new Error('No connection (' + (err && err.message ? err.message : 'failed') + ')'); });
  }

  function metaOf(p) { return { name: p.name, zones: p.zones, zoneMeta: p.zoneMeta || {}, org: p.org || [], cols: p.cols || [], docs: p.docs || [], pts: planPts(p), plan: planPageList(p), clr: (p.plan && p.plan.clr) || 0, pol: p.pol || null, own: p.own || null }; }
  function strip(it) { var d = {}; Object.keys(it).forEach(function (k) { if (k !== 'pid' && k !== 's') d[k] = it[k]; }); return d; }
  function dirty(items) { return items.filter(function (i) { return (i.u || 0) > (i.s || 0); }); }

  async function quietly(fn) { Store.quiet = true; try { return await fn(); } finally { Store.quiet = false; } }

  function applyMeta(p, row) {
    var m = row.project || {};
    p.name = m.name || p.name; p.zoneMeta = m.zoneMeta || p.zoneMeta; p.org = m.org || p.org; p.cols = m.cols || p.cols; p.docs = m.docs || p.docs;
    if (m.zones) p.zones = m.zones;
    if (m.pts && m.pts.length) { p.plan = p.plan || { pages: [], pins: {}, points: [] }; p.plan.points = m.pts; }
    if (m.clr || (m.plan && m.plan.length)) {
      p.plan = p.plan || { pages: [], pins: {}, points: [] };
      var pl = p.plan;
      // Someone removed the plan pages: drop ours too, once.
      if ((m.clr || 0) > (pl.clr || 0)) {
        pl.pages.forEach(function (g, i) { Store.deletePhoto(g.id ? planPageKey(g) : planKey(p.id, i)); });
        pl.pages = []; pl.clr = m.clr;
      }
      // Pages are joined by id so nobody loses a page.
      (m.plan || []).forEach(function (g) {
        var have = pl.pages.filter(function (x) { return x.id === g.id; })[0];
        if (have) { have.name = g.name; have.w = g.w; have.h = g.h; } else pl.pages.push({ id: g.id, name: g.name, w: g.w, h: g.h });
      });
    }
    if (m.pol) p.pol = m.pol;
    if (m.own) p.own = m.own;
    p.team.metaU = row.updated_at;
  }

  // Returns the list of local items that changed or arrived.
  function applyRows(p, items, rows) {
    var byId = {}, changed = [];
    items.forEach(function (i) { byId[i.id] = i; });
    rows.forEach(function (r) {
      var cur = byId[r.id], u = r.updated_at;
      if (!cur) {
        var it = Object.assign({}, r.data, { pid: p.id, s: u, u: u });
        items.push(it); byId[it.id] = it; changed.push(it);
      } else if (u > (cur.u || 0)) {
        Object.keys(cur).forEach(function (k) { delete cur[k]; });
        Object.assign(cur, r.data, { pid: p.id, s: u, u: u });
        changed.push(cur);
      }
    });
    return changed;
  }

  async function pullAll(p, items) {
    var code = p.team.code, since = Math.max(0, (p.team.pulled || 0) - 120000), changed = [], max = p.team.pulled || 0;
    var trow = await api(code, 'cc_teams?code=eq.' + code + '&select=project,updated_at');
    var metaChanged = false;
    if (trow && trow[0] && trow[0].updated_at > (p.team.metaU || 0)) { applyMeta(p, trow[0]); metaChanged = true; }
    for (var guard = 0; guard < 30; guard++) {
      var rows = await api(code, 'cc_items?team=eq.' + code + '&updated_at=gt.' + since + '&order=updated_at.asc&limit=1000&select=id,data,updated_at');
      changed = changed.concat(applyRows(p, items, rows || []));
      (rows || []).forEach(function (r) { if (r.updated_at > max) max = r.updated_at; });
      if (!rows || rows.length < 1000) break;
      since = rows[rows.length - 1].updated_at;
    }
    p.team.pulled = max;
    return { changed: changed, metaChanged: metaChanged };
  }

  async function pushAll(p, items) {
    var code = p.team.code, todo = dirty(items), sent = 0;
    for (var i = 0; i < todo.length; i += 100) {
      var batch = todo.slice(i, i + 100), marks = {};
      var body = batch.map(function (it) { marks[it.id] = it.u; return { team: code, id: it.id, data: strip(it), updated_at: it.u }; });
      await api(code, 'cc_items?on_conflict=team,id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: body });
      batch.forEach(function (it) { if (it.u === marks[it.id]) it.s = it.u; });
      sent += batch.length;
    }
    var metaDirty = (p.u || 0) > (p.team.metaPushed || 0);
    if (metaDirty) {
      var now = Date.now(), pu = p.u;
      await api(code, 'cc_teams?code=eq.' + code, { method: 'PATCH', prefer: 'return=minimal', body: { name: p.name, project: metaOf(p), updated_at: now } });
      p.team.metaPushed = pu; p.team.metaU = now;
    }
    return { sent: sent, meta: metaDirty, items: todo };
  }

  /* Photos travel as text inside a table of their own. */
  function toB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var r = String(fr.result); res(r.slice(r.indexOf(',') + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function fromB64(b64) {
    var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: 'image/jpeg' });
  }
  async function sendPhotos(code) {
    var ids = await Store.pendingPhotos(), sent = 0;
    for (var i = 0; i < ids.length && sent < 4; i++) {
      var rec = await Store.getPhoto(ids[i]);
      if (!rec || !rec.blob) { await Store.donePhoto(ids[i]); continue; }
      var data = await toB64(rec.blob);
      await api(code, 'cc_photos?on_conflict=team,key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { team: code, key: ids[i], data: data, updated_at: Date.now() } });
      await Store.donePhoto(ids[i]); sent++;
    }
    return ids.length - sent;
  }
  async function fetchPhoto(code, key) {
    var rows = await api(code, 'cc_photos?team=eq.' + code + '&key=eq.' + encodeURIComponent(key) + '&select=data');
    return rows && rows[0] && rows[0].data ? fromB64(rows[0].data) : null;
  }

  // Get the plan pictures other phones sent, so the plan works without a connection.
  async function fetchPlanPages(p) {
    var pages = (p.plan && p.plan.pages) || [], got = 0;
    for (var i = 0; i < pages.length && got < 2; i++) {
      if (!pages[i].id) continue;
      var key = planPageKey(pages[i]);
      if (await Store.getPhoto(key)) continue;
      var blob = await fetchPhoto(p.team.code, key);
      if (blob) { await Store.putPhoto(key, blob); got++; }
    }
    return got;
  }

  // One round: take what others did, then send what we did.
  async function cycle(force) {
    var p = window.P && P.project;
    if (!p || !p.team || st.busy) return;
    if (!force && document.hidden) return;
    st.busy = true;
    try {
      if (window.Perms) { try { if (!(await Perms.sync(p, api))) { st.err = 'Blocked by the admin'; st.busy = false; updateLabel(); return; } } catch (pe) { Diag.log('DEV ' + (pe.message || pe)); } }
      if (typeof planMigrate === 'function') await planMigrate(p);
      var items = P.items, res = await pullAll(p, items);
      var out = await pushAll(p, items);
      try { st.photosLeft = await sendPhotos(p.team.code); } catch (pe) { st.photosLeft = -1; Diag.log('PHOTO ' + (pe.message || pe)); }
      try { await fetchPlanPages(p); } catch (pe) { Diag.log('PLAN ' + (pe.message || pe)); }
      await quietly(async function () {
        var touched = res.changed.concat(out.items);
        if (touched.length) await Store.putItems(touched);
        await Store.putProject(p);
      });
      st.err = ''; st.last = Date.now();
      if (res.changed.length || res.metaChanged) { reindex(); refreshView(); }
    } catch (e) {
      st.err = e.message || String(e);
      Diag.log('SYNC ' + st.err);
    }
    st.busy = false; st.pending = dirty(P.items).length;
    updateLabel();
  }

  function updateLabel() { var el = document.getElementById('subline'); if (el && window.P && P.project) el.textContent = subText(counts(P.items)); }
  function label(p) {
    if (!p || !p.team) return '';
    var n = window.P && P.project === p ? dirty(P.items).length : 0;
    return ' · team ' + p.team.code + (st.err ? ' · offline' : n ? ' · sending' : st.last ? ' · synced' : '');
  }
  function schedule() { clearTimeout(st.deb); st.deb = setTimeout(function () { cycle(true); }, 700); }

  async function create(p) {
    var code, tries = 0;
    p.own = window.Perms ? Perms.devId() : '';
    for (;;) {
      code = code6();
      try {
        await api(code, 'cc_teams', { method: 'POST', prefer: 'return=minimal', body: { code: code, name: p.name, project: metaOf(p), updated_at: Date.now() } });
        break;
      } catch (e) { if (e.status === 409 && ++tries < 5) continue; throw e; }
    }
    p.team = { code: code, pulled: 0, metaPushed: p.u || 0, metaU: Date.now(), owner: true };
    P.items.forEach(function (i) { i.s = 0; i.u = i.u || Date.now(); });
    await cycle(true);
    if (st.err) { var msg = st.err; p.team = null; await quietly(function () { return Store.putProject(p); }); throw new Error(msg); }
    return code;
  }

  async function join(rawCode) {
    var code = clean(rawCode);
    if (code.length < 4) throw new Error('Type the whole code.');
    var rows = await api(code, 'cc_teams?code=eq.' + code + '&select=project,updated_at');
    if (!rows || !rows.length) throw new Error('That code was not found. Check it and try again.');
    var existing = (await Store.listProjects()).filter(function (x) { return x.team && x.team.code === code; })[0];
    if (existing) return existing.id;
    var m = rows[0].project || {};
    var p = { id: Store.uid(), name: m.name || 'Team project', createdAt: Date.now(), updatedAt: Date.now(), mode: 'in', zones: m.zones || [], cols: m.cols || [], docs: m.docs || [],
              zoneMeta: m.zoneMeta || {}, org: m.org || [], team: { code: code, pulled: 0, metaPushed: 0, metaU: rows[0].updated_at } };
    applyMeta(p, rows[0]);
    var items = [];
    var r = await pullAll(p, items);
    p.team.metaPushed = Date.now();
    await quietly(async function () { p.u = Date.now(); await Store.putProject(p); await Store.putItems(items); });
    p.team.metaPushed = p.u;
    await quietly(function () { return Store.putProject(p); });
    return p.id;
  }

  function start() {
    Store.onChange = function () { if (window.P && P.project && P.project.team) schedule(); };
    clearInterval(st.timer);
    st.timer = setInterval(function () {
      var r = window.curScreen && curScreen() && curScreen().route;
      if (r && (r.s === 'project' || r.s === 'report')) cycle(false);
    }, 4000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) cycle(true); });
    window.addEventListener('online', function () { cycle(true); });
  }

  return { cycle: cycle, create: create, join: join, label: label, start: start, state: st, clean: clean, dirty: dirty, cfg: CFG, fetchPhoto: fetchPhoto, api: api };
})();
