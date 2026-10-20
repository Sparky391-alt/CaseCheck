/* Local storage on the phone. Everything stays in IndexedDB inside the app. */
var Store = (function () {
  'use strict';
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open('casecheck', 2);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('items')) {
          var items = db.createObjectStore('items', { keyPath: 'id' });
          items.createIndex('pid', 'pid', { unique: false });
        }
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        // Photos that still have to go up to the team.
        if (!db.objectStoreNames.contains('pq')) db.createObjectStore('pq', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var out;
        try { out = fn(tx); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('aborted')); };
      });
    });
  }

  function uid() {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  return {
    uid: uid,
    listProjects: function () { return run('projects', 'readonly', function (tx) { return tx.objectStore('projects').getAll(); }); },
    who: function () { try { return (localStorage.getItem('cc_name') || '').trim(); } catch (e) { return ''; } },
    // Records who did the change. An arrival or collection stamped in the last few seconds belongs to this person.
    stamp: function (it, now) {
      var w = Store.who(); if (!w) return;
      it.by = w;
      if (it.inAt && now - it.inAt < 6000) it.inBy = w;
      if (it.outAt && now - it.outAt < 6000) it.outBy = w;
    },
    quiet: false,        // set while applying data that came from the team, so it is not stamped as a local change
    onChange: null,
    putProject: function (p) {
      if (!Store.quiet) p.u = Date.now();
      return run('projects', 'readwrite', function (tx) { tx.objectStore('projects').put(p); }).then(function (r) { if (!Store.quiet && Store.onChange) Store.onChange(); return r; });
    },
    getItems: function (pid) {
      return run('items', 'readonly', function (tx) { return tx.objectStore('items').index('pid').getAll(pid); });
    },
    putItem: function (it) {
      if (!Store.quiet) { it.u = Date.now(); Store.stamp(it, it.u); }
      return run('items', 'readwrite', function (tx) { tx.objectStore('items').put(it); }).then(function (r) { if (!Store.quiet && Store.onChange) Store.onChange(); return r; });
    },
    putItems: function (list) {
      var now = Date.now();
      if (!Store.quiet) list.forEach(function (it) { it.u = now; Store.stamp(it, now); });
      return run('items', 'readwrite', function (tx) {
        var os = tx.objectStore('items');
        list.forEach(function (it) { os.put(it); });
      }).then(function (r) { if (!Store.quiet && Store.onChange) Store.onChange(); return r; });
    },
    countItems: function (pid) {
      return run('items', 'readonly', function (tx) { return tx.objectStore('items').index('pid').count(pid); });
    },
    // queue = true marks the photo to be sent to the team.
    putPhoto: function (id, blob, queue) {
      if (!queue) return run('photos', 'readwrite', function (tx) { tx.objectStore('photos').put({ id: id, blob: blob }); });
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['photos', 'pq'], 'readwrite');
          tx.objectStore('photos').put({ id: id, blob: blob });
          tx.objectStore('pq').put({ id: id, at: Date.now() });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    },
    pendingPhotos: function () { return run('pq', 'readonly', function (tx) { return tx.objectStore('pq').getAllKeys(); }); },
    donePhoto: function (id) { return run('pq', 'readwrite', function (tx) { tx.objectStore('pq').delete(id); }); },
    deletePhoto: function (id) { return run('photos', 'readwrite', function (tx) { tx.objectStore('photos').delete(id); }); },
    getPhoto: function (id) { return run('photos', 'readonly', function (tx) { return tx.objectStore('photos').get(id); }); },
    deleteProject: function (pid) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['projects', 'items', 'photos'], 'readwrite');
          tx.objectStore('projects').delete(pid);
          var items = tx.objectStore('items');
          var keysReq = items.index('pid').getAllKeys(pid);
          keysReq.onsuccess = function () {
            keysReq.result.forEach(function (k) {
              items.delete(k);
              tx.objectStore('photos').delete(k + ':in');
              tx.objectStore('photos').delete(k + ':out');
            });
          };
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }
  };
})();
