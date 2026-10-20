/* Photos for damage and inside checks. Taken with the camera, shrunk, kept on the phone, and sent to the team. */
var Photos = (function () {
  'use strict';
  var urls = {};     // key -> object url, so a picture is only opened once per screen

  function toJpeg(src, w, h, maxw, q) {
    var s = Math.min(1, maxw / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', q || 0.72); });
  }
  async function fromFile(file) {
    var bmp = await createImageBitmap(file);
    return toJpeg(bmp, bmp.width, bmp.height, 1280, 0.72);
  }

  // Camera screen. Resolves with a JPEG blob, or null if the person backs out.
  function shoot(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false, el, video = h('video', { playsinline: true, muted: true, autoplay: true });
      var msg = h('div', { class: 'msg', hidden: true });
      var file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async function (e) {
        var f = e.target.files && e.target.files[0]; e.target.value = '';
        if (!f) return;
        try { finish(await fromFile(f)); } catch (err) { toast('Could not open that photo'); }
      } });
      var torchBtn = h('button', { class: 'pill', hidden: true, 'aria-pressed': 'false', onclick: function () {
        var on = torchBtn.getAttribute('aria-pressed') !== 'true';
        Cam.torch(on).then(function (ok) { torchBtn.setAttribute('aria-pressed', String(on && ok)); });
      } }, 'Light');
      var shutter = h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: async function () {
        if (!Cam.isLive() || !video.videoWidth) { toast('The camera is not ready yet'); return; }
        shutter.disabled = true;
        try { finish(await toJpeg(video, video.videoWidth, video.videoHeight, 1280, 0.72)); } catch (e) { toast('Could not take the photo'); shutter.disabled = false; }
      } });
      var cam = h('div', { class: 'cam shoot' }, video, h('div', { class: 'hint' }, o.hint || 'Take the photo'),
        h('div', { class: 'ctrl' }, h('div', { class: 'side' }, torchBtn), shutter,
          h('div', { class: 'side r' }, h('button', { class: 'pill', onclick: function () { file.click(); } }, icon('image')))), msg);
      el = h('div', { class: 'planov shootov' },
        h('div', { class: 'top' }, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: function () { finish(null); } }, icon('x')), h('div', { class: 'grow' }, h('h1', null, o.title || 'Photo'))),
        cam, file);
      function finish(blob) {
        if (done) return; done = true;
        Cam.stop(); if (window.S) S.busy = false;
        closeOv(el);
        if (window.S && S && S.mounted && typeof startCamera === 'function') startCamera();
        resolve(blob);
      }
      if (window.S) S.busy = true;
      openOv(el, function () { if (!done) { done = true; Cam.stop(); if (window.S) S.busy = false; if (window.S && S && S.mounted && typeof startCamera === 'function') startCamera(); resolve(null); } });
      Cam.start(video).then(function () { torchBtn.hidden = !Cam.hasTorch(); }).catch(function () {
        msg.replaceChildren(h('h2', { style: { fontSize: '26px' } }, 'Camera is off'), h('p', null, 'Allow the camera, or choose a photo from the gallery.'),
          h('button', { class: 'btn yellow small', onclick: function () { file.click(); } }, 'Choose photo'));
        msg.hidden = false;
      });
    });
  }

  function save(key, blob) { return Store.putPhoto(key, blob, true); }

  // The picture for a key. Looks on this phone first, then asks the team.
  async function get(key) {
    if (!key) return null;
    var rec = await Store.getPhoto(key);
    if (rec && rec.blob) return rec.blob;
    var p = window.P && P.project;
    if (!p || !p.team) return null;
    try {
      var blob = await Sync.fetchPhoto(p.team.code, key);
      if (blob) await Store.putPhoto(key, blob, false);
      return blob;
    } catch (e) { return null; }
  }
  async function url(key) {
    if (urls[key]) return urls[key];
    var b = await get(key); if (!b) return null;
    urls[key] = URL.createObjectURL(b); return urls[key];
  }
  function forget(key) { if (urls[key]) { URL.revokeObjectURL(urls[key]); delete urls[key]; } }

  // Small picture as text for the PDF report.
  async function forPdf(key, maxw) {
    var b = await get(key); if (!b) return null;
    var bmp = await createImageBitmap(b), s = Math.min(1, (maxw || 640) / bmp.width), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', 0.7), w: c.width, h: c.height };
  }

  return { shoot: shoot, save: save, get: get, url: url, forget: forget, forPdf: forPdf };
})();
