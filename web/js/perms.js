/* Who this phone is, and what the admin lets it do. The admin sets this on the PC dashboard.
   The phone asks the team database for its own row every sync and keeps a copy for when there is no signal. */
'use strict';
var Perms = (function () {
  var LIST = [
    ['checkin', 'Check items in'], ['checkout', 'Check items out'], ['count', 'Count pieces'],
    ['edit', 'Edit items and add items'], ['inside', 'Inside checks'], ['damage', 'Damage photos'],
    ['plan', 'Edit the site plan'], ['report', 'Reports and exports'], ['manage', 'Project settings']
  ];
  var PRESETS = {
    full: { label: 'Full access', on: ['checkin', 'checkout', 'count', 'edit', 'inside', 'damage', 'plan', 'report', 'manage'] },
    receiving: { label: 'Receiving', on: ['checkin', 'count', 'damage', 'inside'] },
    dispatch: { label: 'Dispatch', on: ['checkout', 'count', 'damage'] },
    inside: { label: 'Inside checks', on: ['inside', 'damage'] },
    viewer: { label: 'View only', on: [] }
  };
  function permsOf(role) { var o = {}, pr = PRESETS[role] || PRESETS.full; LIST.forEach(function (x) { o[x[0]] = pr.on.indexOf(x[0]) >= 0; }); return o; }

  var st = { off: false, row: null, lastPresence: 0, lastGet: 0, lastAct: '', busy: false };

  function devId() {
    try {
      var v = localStorage.getItem('cc_dev');
      if (!v) { v = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6); localStorage.setItem('cc_dev', v); }
      return v;
    } catch (e) { return st.mem || (st.mem = 'tmp' + Math.random().toString(36).slice(2, 8)); }
  }
  function cacheKey(code) { return 'cc_perm_' + code; }
  function load(code) {
    try { var s = localStorage.getItem(cacheKey(code)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save(code, row) { try { localStorage.setItem(cacheKey(code), JSON.stringify(row)); } catch (e) { /* ignore */ } }
  function team() { return window.P && P.project && P.project.team ? P.project.team.code : ''; }
  function row() {
    var c = team(); if (!c) return null;
    if (!st.row || st.row.code !== c) { var r = load(c); st.row = r ? Object.assign({ code: c }, r) : null; }
    return st.row;
  }
  function status() {
    if (!team() || st.off) return 'active';
    var r = row();
    if (r) return r.status || 'active';
    return P.project.pol && P.project.pol.approve ? 'pending' : 'active';
  }
  function can(perm, item) {
    if (!team() || st.off) return true;
    var s = status();
    if (s !== 'active') return false;
    var r = row();
    if (!r) return true;
    if (!r.perms || !r.perms[perm]) return false;
    if (item && r.zones && r.zones.length && item.zone && r.zones.indexOf(item.zone) < 0) return false;
    return true;
  }
  function why(perm, item) {
    var s = status();
    if (s === 'blocked') return 'The admin has blocked this phone.';
    if (s === 'pending') return 'Waiting for the admin to approve this phone.';
    var r = row();
    if (r && r.perms && r.perms[perm] && item && r.zones && r.zones.length && r.zones.indexOf(item.zone) < 0) return 'This phone cannot work on the ' + item.zone + ' zone.';
    return 'The admin has not given this phone that permission.';
  }
  // Use before an action. Shows the reason when it is not allowed.
  function ok(perm, item) {
    if (can(perm, item)) return true;
    try { toast(why(perm, item)); feedback('warn'); } catch (e) { /* ignore */ }
    return false;
  }
  function note(text) { st.lastAct = text; }

  function describe() {
    var c = team(); if (!c) return '';
    if (st.off) return 'Permissions are not set up for this team yet.';
    var s = status(), r = row();
    if (s === 'blocked') return 'Blocked by the admin.';
    if (s === 'pending') return 'Waiting for the admin to approve this phone.';
    var role = r && r.role ? ((PRESETS[r.role] || {}).label || 'Custom') : 'Full access';
    var z = r && r.zones && r.zones.length ? ' · zones: ' + r.zones.join(', ') : ' · all zones';
    return 'This phone: ' + role + z;
  }

  function battery() {
    try { if (navigator.getBattery) return navigator.getBattery().then(function (b) { return Math.round(b.level * 100); }, function () { return null; }); } catch (e) { /* ignore */ }
    return Promise.resolve(null);
  }

  // One round with the team database. Returns false when this phone is blocked.
  async function sync(p, api) {
    var code = p.team.code, id = devId(), now = Date.now();
    if (st.busy) return status() !== 'blocked';
    st.busy = true;
    try {
      var rows;
      try { rows = await api(code, 'cc_devices?team=eq.' + code + '&id=eq.' + id + '&select=name,label,role,perms,zones,status'); }
      catch (e) {
        if (e.status === 404 || /PGRST205|42P01|cc_devices/.test(e.message || '')) { st.off = true; render(); return true; }
        throw e;
      }
      st.off = false;
      var me = Store.who() || '';
      if (!rows || !rows.length) {
        var pol = p.pol || {}, role = pol.role || 'full';
        var body = { team: code, id: id, name: me, role: role, perms: permsOf(role), zones: [], status: pol.approve ? 'pending' : 'active', last_seen: now, info: await infoNow(), created_at: now };
        await api(code, 'cc_devices?on_conflict=team,id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: body });
        st.row = { code: code, role: role, perms: body.perms, zones: [], status: body.status }; save(code, st.row); st.lastPresence = now;
      } else {
        var r = rows[0]; st.row = { code: code, role: r.role, perms: r.perms || {}, zones: r.zones || [], status: r.status || 'active', label: r.label || '' }; save(code, st.row);
        if (now - st.lastPresence > 20000) {
          st.lastPresence = now;
          await api(code, 'cc_devices?team=eq.' + code + '&id=eq.' + id, { method: 'PATCH', prefer: 'return=minimal', body: { name: me, last_seen: now, info: await infoNow() } });
        }
      }
    } finally { st.busy = false; }
    render();
    return status() !== 'blocked';
  }
  async function infoNow() {
    var bat = await battery(), mode = '';
    try { mode = S && S.inside ? 'Inside' : P.project.mode === 'out' ? 'Check out' : 'Check in'; } catch (e) { /* ignore */ }
    return { v: (window.CC_WEB && CC_WEB.v) ? 'web ' + CC_WEB.v : '1.8', app: '1.8', mode: mode, act: st.lastAct, bat: bat };
  }

  /* The lock screen for blocked phones and the banner for phones waiting for approval. */
  function render() {
    var s = status(), el = document.getElementById('permlock');
    if (s === 'blocked') {
      if (!el) {
        el = document.createElement('div'); el.id = 'permlock'; el.className = 'permlock';
        el.innerHTML = '<div><h2>This phone is blocked</h2><p>The admin has blocked this phone from the team. Ask the admin to unblock it.</p><button class="btn" id="permretry">Check again</button></div>';
        document.body.appendChild(el);
        el.querySelector('#permretry').onclick = function () { if (window.Sync) Sync.cycle(true); };
      }
    } else if (el) el.remove();
    var b = document.getElementById('permwait');
    if (s === 'pending') {
      if (!b) { b = document.createElement('div'); b.id = 'permwait'; b.className = 'permwait'; b.textContent = 'Waiting for the admin to approve this phone. You can look but not change.'; document.body.appendChild(b); }
    } else if (b) b.remove();
  }

  return { LIST: LIST, PRESETS: PRESETS, permsOf: permsOf, can: can, ok: ok, why: why, note: note, sync: sync, status: status, describe: describe, render: render, devId: devId, state: st, blocked: function () { return status() === 'blocked'; } };
})();

/* Put the checks in front of the actions that change things. */
(function () {
  function wrap(name, fn) {
    var o = window[name]; if (typeof o !== 'function') return;
    window[name] = function () { return fn.call(this, o, arguments); };
  }
  RESULT_TEXT['view'] = ['Not allowed on this phone', true];
  wrap('applyScan', function (o, a) {
    var item = a[0];
    if (S && S.inside) return o.apply(null, a);
    var mode = P.project.mode, perm = mode === 'in' ? 'checkin' : 'checkout';
    if (!Perms.can(perm, item)) {
      if (document.querySelector('.result')) return Promise.resolve();
      var r = Perms.why(perm, item); feedback('warn');
      showResult(item, 'view', null, mode); toast(r); return Promise.resolve();
    }
    var res = o.apply(null, a);
    Perms.note((mode === 'in' ? 'Check in ' : 'Check out ') + nm(item));
    return res;
  });
  wrap('openInside', function (o, a) { if (!Perms.ok('inside', a[0])) return; return o.apply(null, a); });
  wrap('openDamage', function (o, a) { if (!Perms.ok('damage', a[0])) return; return o.apply(null, a); });
  wrap('pickZoneSheet', function (o, a) { if (!Perms.ok('edit', a[0])) return; return o.apply(null, a); });
  wrap('pickDropSheet', function (o, a) { if (!Perms.ok('edit', a[0])) return; return o.apply(null, a); });
  wrap('addUnlistedSheet', function (o, a) { if (!Perms.ok('edit')) return; return o.apply(null, a); });
  wrap('setMode', function (o, a) { if (a[0] === 'inside' && !Perms.ok('inside')) return; return o.apply(null, a); });
  wrap('openPlan', function (o, a) { var opts = a[0] || {}; opts.ro = !Perms.can('plan'); return o.call(null, opts); });
  wrap('goScreen', function (o, a) { if (a[0] && a[0].s === 'report' && !Perms.ok('report')) return; return o.apply(null, a); });
})();
