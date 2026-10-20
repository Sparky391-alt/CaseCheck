/* Who this phone is, and what the admin lets it do. The admin sets this on the PC dashboard.
   The phone asks the team database for its own row every sync and keeps a copy for when there is no signal. */
'use strict';
var Perms = (function () {
  var LIST = [
    ['checkin', 'Check items in'], ['checkout', 'Check items out'], ['count', 'Count pieces'],
    ['edit', 'Edit items and add items'], ['inside', 'Inside checks'], ['damage', 'Damage photos'],
    ['plan', 'Edit the site plan'], ['report', 'Reports and exports'], ['manage', 'Project settings'],
    ['wipe', 'Reset check ins and delete project']
  ];
  var PRESETS = {
    full: { label: 'Full access', on: ['checkin', 'checkout', 'count', 'edit', 'inside', 'damage', 'plan', 'report', 'manage', 'wipe'] },
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
  function isOwner() { return !!(window.P && P.project && P.project.team && P.project.team.owner === true); }
  function status() {
    if (!team() || st.off || isOwner()) return 'active';
    var r = row();
    if (r) return r.status || 'active';
    return P.project.pol && P.project.pol.approve ? 'pending' : 'active';
  }
  function can(perm, item) {
    if (!team() || st.off || isOwner()) return true;
    var s = status();
    if (s !== 'active') return false;
    var r = row();
    if (!r) return true;
    if (perm === 'wipe' && r.perms && r.perms.wipe === undefined) return r.role === 'full';
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

  function isAdmin() {
    if (!team() || st.off) return false;
    if (isOwner()) return true;
    var r = row();
    return status() === 'active' && !!r && r.role === 'full';
  }
  function describe() {
    var c = team(); if (!c) return '';
    if (st.off) return 'Permissions are not set up for this team yet.';
    if (isOwner()) return 'This phone: Owner, full access. It made this project.';
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
        var pol = p.pol || {}, own = p.team.owner === true, role = own ? 'full' : (pol.role || 'full');
        var body = { team: code, id: id, name: me, role: role, perms: permsOf(role), zones: [], status: own ? 'active' : (pol.approve ? 'pending' : 'active'), last_seen: now, info: await infoNow(), created_at: now };
        await api(code, 'cc_devices?on_conflict=team,id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: body });
        st.row = { code: code, role: role, perms: body.perms, zones: [], status: body.status }; save(code, st.row); st.lastPresence = now;
      } else {
        var r = rows[0];
        if (p.team.owner === true && (r.role !== 'full' || r.status !== 'active' || !r.perms || LIST.some(function (x) { return !r.perms[x[0]]; }))) {
          // The phone that made the project always keeps full access.
          r.role = 'full'; r.status = 'active'; r.perms = permsOf('full'); r.zones = [];
          await api(code, 'cc_devices?team=eq.' + code + '&id=eq.' + id, { method: 'PATCH', prefer: 'return=minimal', body: { role: 'full', status: 'active', perms: r.perms, zones: [] } });
        }
        st.row = { code: code, role: r.role, perms: r.perms || {}, zones: r.zones || [], status: r.status || 'active', label: r.label || '' }; save(code, st.row);
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
    return { v: (window.CC_WEB && CC_WEB.v) ? 'web ' + CC_WEB.v : '1.8', app: '1.8', mode: mode, act: st.lastAct, bat: bat, owner: isOwner() ? 1 : 0 };
  }

  /* The lock screen for blocked phones and the banner for phones waiting for approval. */
  function render() {
    var adm = isAdmin() + ':' + can('wipe') + ':' + can('manage') + ':' + can('report');
    if (st.admin !== adm) { st.admin = adm; try { if (window.curScreen && curScreen().route.tab === 'menu') window.render(); } catch (e) { /* ignore */ } }
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

  return { isOwner: isOwner, isAdmin: isAdmin, LIST: LIST, PRESETS: PRESETS, permsOf: permsOf, can: can, ok: ok, why: why, note: note, sync: sync, status: status, describe: describe, render: render, devId: devId, state: st, blocked: function () { return status() === 'blocked'; } };
})();


/* Phones and permissions, for the owner and for phones with full access. */
function phonesSheet() {
  var p = P.project, code = p.team && p.team.code; if (!code) return;
  var me = Perms.devId(), devs = [], root = h('div', { style: { display: 'grid', gap: '12px' } }), sh;
  function online(d) { return Date.now() - (d.last_seen || 0) < 75000; }
  function nameOf(d) { return d.label || d.name || ('Phone ' + String(d.id).slice(0, 4)); }
  function isOwnerRow(d) { return (d.info && d.info.owner) || (p.own && p.own === d.id); }
  function roleLabel(d) { return d.status === 'pending' ? 'Waiting' : d.status === 'blocked' ? 'Blocked' : ((Perms.PRESETS[d.role] || {}).label || 'Custom'); }
  async function load() {
    try { devs = (await Sync.api(code, 'cc_devices?team=eq.' + code + '&select=*&limit=500')) || []; draw(); }
    catch (e) { root.replaceChildren(h('div', { class: 'note' }, 'Could not load the phones. ' + (e.message || ''))); }
  }
  function draw() {
    var rank = { pending: 0, active: 1, blocked: 2 };
    devs.sort(function (a, b) { return (rank[a.status] || 1) - (rank[b.status] || 1) || (b.last_seen || 0) - (a.last_seen || 0); });
    var pol = p.pol || { approve: false, role: 'full' };
    var ap = h('select', null, h('option', { value: 'no', selected: !pol.approve ? true : null }, 'New phones get in straight away'), h('option', { value: 'yes', selected: pol.approve ? true : null }, 'New phones wait for approval'));
    var ro = h('select', null, Object.keys(Perms.PRESETS).map(function (k) { return h('option', { value: k, selected: (pol.role || 'full') === k ? true : null }, 'Start with ' + Perms.PRESETS[k].label); }));
    function savePol() { p.pol = { approve: ap.value === 'yes', role: ro.value }; Store.putProject(p); toast('Saved for new phones'); }
    ap.addEventListener('change', savePol); ro.addEventListener('change', savePol);
    var list = devs.map(function (d) {
      var you = d.id === me;
      return h('button', { class: 'item', onclick: function () { editPhone(d); } },
        h('div', { class: 'strip', style: { background: d.status === 'blocked' ? '#C0392B' : d.status === 'pending' ? '#E6A700' : online(d) || you ? '#27AE60' : '#7C8B99' } }),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'sn' }, nameOf(d) + (you ? ' (this phone)' : '')),
          h('div', { class: 'ds' }, (d.zones && d.zones.length ? 'Zones: ' + d.zones.join(', ') : 'All zones') + ' · ' + (online(d) || you ? 'Online now' : d.last_seen ? 'Seen ' + fmtT(d.last_seen) : 'Never seen'))),
        h('div', { class: 'rt' }, h('span', { class: 'badge' }, isOwnerRow(d) ? 'Owner' : roleLabel(d))));
    });
    root.replaceChildren(h('div', { class: 'field' }, ap), h('div', { class: 'field' }, ro), h('div', { class: 'label' }, devs.length + ' phones. Tap one to change it.'), h('div', { class: 'items' }, list),
      h('button', { class: 'btn small', onclick: load }, 'Refresh'));
  }
  function editPhone(d) {
    var owner = isOwnerRow(d), you = d.id === me;
    var role = d.role || 'full', perms = Object.assign(Perms.permsOf(role), d.perms || {}), zones = (d.zones || []).slice(), s2, zbox, pbox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }), rbox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    var label = h('input', { type: 'text', value: d.label || '', placeholder: d.name || 'Name for this phone', maxLength: 30 });
    function paint() {
      rbox.replaceChildren.apply(rbox, Object.keys(Perms.PRESETS).map(function (k) { return h('button', { class: 'chip', 'aria-pressed': String(role === k), disabled: owner ? true : null, onclick: function () { role = k; perms = Perms.permsOf(k); paint(); } }, Perms.PRESETS[k].label); }));
      pbox.replaceChildren.apply(pbox, Perms.LIST.map(function (x) {
        return h('button', { class: 'chip', 'aria-pressed': String(!!perms[x[0]]), disabled: owner ? true : null, onclick: function () {
          perms[x[0]] = !perms[x[0]];
          var m = Object.keys(Perms.PRESETS).filter(function (k) { return Perms.LIST.every(function (y) { return (Perms.PRESETS[k].on.indexOf(y[0]) >= 0) === !!perms[y[0]]; }); })[0];
          role = m || 'custom'; paint();
        } }, x[1]);
      }));
    }
    paint();
    var zs = P.project.zones.map(function (z) { return z.name; });
    zbox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, zs.map(function (z) {
      return h('button', { class: 'chip', 'aria-pressed': String(zones.indexOf(z) >= 0), disabled: owner ? true : null, onclick: function (e) {
        var on = zones.indexOf(z) >= 0; zones = zones.filter(function (x) { return x !== z; }); if (!on) zones.push(z);
        e.currentTarget.setAttribute('aria-pressed', String(!on));
      } }, z);
    }));
    async function patch(body, msg) {
      try { await Sync.api(code, 'cc_devices?team=eq.' + code + '&id=eq.' + encodeURIComponent(d.id), { method: 'PATCH', prefer: 'return=minimal', body: body }); Object.assign(d, body); s2.close(); draw(); toast(msg); }
      catch (e) { toast('Could not save. ' + (e.message || '')); }
    }
    var buttons = [];
    if (!owner) {
      if (d.status === 'pending') buttons.push(h('button', { class: 'btn primary grow', onclick: function () { patch({ status: 'active', label: label.value.trim(), role: role, perms: perms, zones: zones }, 'Approved'); } }, 'Approve'));
      else buttons.push(h('button', { class: 'btn primary grow', onclick: function () { patch({ label: label.value.trim(), role: you && role !== 'full' ? 'full' : role, perms: you ? Perms.permsOf('full') : perms, zones: you ? [] : zones }, 'Saved'); } }, 'Save'));
      if (!you) {
        if (d.status === 'blocked') buttons.push(h('button', { class: 'btn grow', onclick: function () { patch({ status: 'active' }, 'Unblocked'); } }, 'Unblock'));
        else buttons.push(h('button', { class: 'btn danger grow', onclick: function () { patch({ status: 'blocked' }, 'Blocked'); } }, 'Block'));
      }
    } else buttons.push(h('button', { class: 'btn primary grow', onclick: function () { patch({ label: label.value.trim() }, 'Saved'); } }, 'Save name'));
    var kids = [
      owner ? h('div', { class: 'note ok' }, 'This phone made the project. It always has full access.') : null,
      you && !owner ? h('div', { class: 'note' }, 'This is your phone. You keep full access so you cannot lock yourself out.') : null,
      h('div', { class: 'field' }, h('span', null, 'Name'), label),
      h('div', { class: 'label' }, 'What it may do'), rbox, pbox,
      h('div', { class: 'label' }, 'Zones it may work on. None means all zones.'), zbox,
      h('div', { class: 'row' }, buttons)];
    if (!owner && !you) kids.push(h('button', { class: 'btn small danger', onclick: async function () {
      if (!(await confirmDlg({ title: 'Remove ' + nameOf(d) + '?', body: 'It leaves this list. If it opens the project again it joins as a new phone.', ok: 'Remove', danger: true }))) return;
      try { await Sync.api(code, 'cc_devices?team=eq.' + code + '&id=eq.' + encodeURIComponent(d.id), { method: 'DELETE' }); devs = devs.filter(function (x) { return x.id !== d.id; }); s2.close(); draw(); toast('Removed'); }
      catch (e) { toast('Could not remove. ' + (e.message || '')); }
    } }, 'Remove from list'));
    s2 = sheet(nameOf(d), kids);
  }
  sh = sheet('Phones and permissions', [root]);
  root.replaceChildren(h('div', { class: 'mute' }, 'Loading'));
  load();
}

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
