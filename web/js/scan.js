/* Camera and text reading. Runs fully offline. */
var Cam = (function () {
  'use strict';
  var stream = null, track = null;

  function start(video) {
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Camera is not available on this device.'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      stream = s;
      track = s.getVideoTracks()[0];
      video.srcObject = s;
      video.setAttribute('playsinline', '');
      video.muted = true;
      var p = video.play();
      try {
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.indexOf('continuous') !== -1) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        }
      } catch (e) { /* optional */ }
      return p;
    });
  }

  function stop() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; track = null;
  }

  function hasTorch() {
    try { var c = track && track.getCapabilities ? track.getCapabilities() : null; return !!(c && c.torch); }
    catch (e) { return false; }
  }

  function torch(on) {
    if (!track) return Promise.resolve(false);
    return track.applyConstraints({ advanced: [{ torch: !!on }] }).then(function () { return !!on; }, function () { return false; });
  }

  // Cut the area inside the on screen frame out of the video, allowing for object-fit: cover.
  function crop(video, box) {
    var vw = video.videoWidth, vh = video.videoHeight;
    var ew = video.clientWidth, eh = video.clientHeight;
    var scale = Math.max(ew / vw, eh / vh);
    var offX = (vw * scale - ew) / 2, offY = (vh * scale - eh) / 2;
    var sx = (box.x * ew + offX) / scale, sy = (box.y * eh + offY) / scale;
    var sw = box.w * ew / scale, sh = box.h * eh / scale;
    var c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function whole(video) {
    var c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  return { start: start, stop: stop, hasTorch: hasTorch, torch: torch, crop: crop, whole: whole,
           isLive: function () { return !!stream; } };
})();

var OCR = (function () {
  'use strict';
  var base = location.origin;
  var ready = null, worker = null, statusCb = null;

  function init(cb) {
    if (cb) statusCb = cb;
    if (ready) return ready;
    ready = Tesseract.createWorker('eng', 1, {
      workerPath: base + '/ocr/worker.min.js',
      corePath: base + '/ocr/core',
      langPath: base + '/ocr/lang',
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: function (m) { if (statusCb) statusCb(m); }
    }).then(function (w) {
      worker = w;
      return w.setParameters({
        tessedit_pageseg_mode: '11',
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/.#: '
      });
    }).then(function () { return worker; }).catch(function (e) { ready = null; throw e; });
    return ready;
  }

  // Grey, stretch contrast, size for reading. invert helps with light text on dark labels.
  function prep(src, invert) {
    var maxW = 1500, minW = 900;
    var s = src.width > maxW ? maxW / src.width : (src.width < minW ? minW / src.width : 1);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    var img = ctx.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length / 4;
    var hist = new Uint32Array(256), i, g;
    for (i = 0; i < n; i++) {
      g = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      d[i * 4] = g; hist[g]++;
    }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
    var span = Math.max(20, hi - lo);
    for (i = 0; i < n; i++) {
      g = (d[i * 4] - lo) * 255 / span;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function read(canvas, invert) {
    var pre = prep(canvas, invert);
    return init().then(function (w) {
      return new Promise(function (res) { pre.toBlob(res, 'image/png'); }).then(function (blob) {
        return w.recognize(blob);
      });
    }).then(function (r) { return (r && r.data && r.data.text) || ''; });
  }

  return { init: init, read: read, prep: prep };
})();

/* Read a picture and say which item it is. */
var Scanner = (function () {
  'use strict';
  function pass(text, acc) { return acc ? acc + '\n' + text : text; }

  function rotate(src, deg) {
    var c = document.createElement('canvas'), sw = src.width, sh = src.height, q = deg === 90 || deg === 270;
    c.width = q ? sh : sw; c.height = q ? sw : sh;
    var ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(src, -sw / 2, -sh / 2);
    return c;
  }

  // Cut a picture into overlapping tiles, so small labels in a wide photo get read at a good size.
  function tiles(src, nx, ny) {
    var out = [], tw = src.width / nx, th = src.height / ny, ox = tw * 0.3, oy = th * 0.3;
    for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
      (function (x, y) {
        out.push(function () {
          var sx = Math.max(0, x * tw - ox / 2), sy = Math.max(0, y * th - oy / 2);
          var sw = Math.min(src.width - sx, tw + ox), sh = Math.min(src.height - sy, th + oy);
          var c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
          c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
          return c;
        });
      })(x, y);
    }
    return out;
  }

  // frames: { crop: canvas, full: canvas|null }
  // Reads every piece of text it can find. It tries the frame, the dark on light flip, the whole
  // picture, then the picture turned upside down and on its side, until one item stands out.
  function identify(frames, index) {
    var all = '', pool = {};
    function judge(text) {
      Match.findAll(index, text).forEach(function (x) {
        var c = pool[x.item.id]; if (!c || x.score > c.score) pool[x.item.id] = x;
      });
      var m = Object.keys(pool).map(function (k) { return pool[k]; });
      m.sort(function (a, b) { return b.score - a.score; });
      return { decision: Match.decide(m), matches: m };
    }
    var steps = [[frames.crop, false]];
    steps.push([frames.crop, true]);
    if (frames.full) steps.push([frames.full, false]);
    var big = frames.full || frames.crop;
    steps.push([function () { return rotate(frames.crop, 180); }, false]);
    tiles(big, 3, 3).forEach(function (t) { steps.push([t, false]); });
    steps.push([function () { return rotate(big, 180); }, false]);
    steps.push([function () { return rotate(big, 90); }, false]);
    steps.push([function () { return rotate(big, 270); }, false]);
    var j = null, ix = 0;
    function next() {
      if (ix >= steps.length) return Promise.resolve(j);
      var st = steps[ix++], src = typeof st[0] === 'function' ? st[0]() : st[0];
      return OCR.read(src, st[1]).then(function (t) {
        all = pass(t, all);
        j = judge(t);
        if (j.decision.type === 'sure') return j;
        // stop early on a short list of clear candidates after the plain passes
        if (ix >= 3 && j.decision.type === 'choose' && j.matches.length && j.matches[0].score >= 90) return j;
        return next();
      });
    }
    return next().then(function (r) {
      return { decision: r.decision, matches: r.matches, text: all };
    });
  }

  return { identify: identify };
})();
