/* readaloud.js - Read-aloud helper for Behruz Vocab Trainer
 * - Listen: browser text-to-speech says the English word (normal / slow)
 * - Say it: microphone check compares what you said with the word (Chrome, Edge, Android)
 * - Auto-read toggle remembered per device
 * No server changes needed. Works over HTTPS (Render already is).
 */
(function () {
  'use strict';

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var TTS = 'speechSynthesis' in window;
  var voice = null;

  function pickVoice() {
    if (!TTS) return;
    var list = speechSynthesis.getVoices();
    voice =
      list.find(function (v) { return /^en[-_]US/i.test(v.lang) && /google|samantha|natural|aria|jenny/i.test(v.name); }) ||
      list.find(function (v) { return /^en[-_]US/i.test(v.lang); }) ||
      list.find(function (v) { return /^en/i.test(v.lang); }) ||
      null;
  }
  if (TTS) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }

  function say(text, slow) {
    if (!TTS || !text) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = (voice && voice.lang) || 'en-US';
    if (voice) u.voice = voice;
    u.rate = slow ? 0.6 : 0.95;
    speechSynthesis.speak(u);
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    var m = a.length, n = b.length, i, j;
    var d = [];
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) { d[0][j] = j; }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return 1 - d[m][n] / Math.max(m, n);
  }

  var rec = null;

  function listen(expected, onDone) {
    if (!SR) { onDone({ error: 'unsupported' }); return; }
    if (rec) { try { rec.abort(); } catch (e) {} }
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    var finished = false;
    function finish(r) { if (!finished) { finished = true; onDone(r); } }

    rec.onresult = function (e) {
      var best = { heard: '', score: 0 };
      var res = e.results[0];
      for (var i = 0; i < res.length; i++) {
        var s = similarity(res[i].transcript, expected);
        if (s > best.score || i === 0) best = { heard: res[i].transcript, score: s };
      }
      best.match = best.score >= 0.8;
      finish(best);
    };
    rec.onerror = function (e) { finish({ error: e.error || 'error' }); };
    rec.onend = function () { finish({ error: 'no-speech' }); };
    try { rec.start(); } catch (e) { finish({ error: 'error' }); }
  }

  function autoRead() {
    try { return localStorage.getItem('vv_auto') === '1'; } catch (e) { return false; }
  }
  function setAutoRead(on) {
    try { localStorage.setItem('vv_auto', on ? '1' : '0'); } catch (e) {}
  }

  var css =
    '.vv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}' +
    '.vv-btn{border:0;border-radius:999px;padding:10px 16px;min-height:44px;font-weight:600;font-size:15px;font-family:inherit;line-height:1;' +
    'background:#7c3aed;color:#fff;cursor:pointer}' +
    '.vv-btn.alt{background:#334155}' +
    '.vv-btn:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}' +
    '.vv-btn.on{background:#16a34a}' +
    '.vv-auto{display:flex;gap:6px;align-items:center;color:inherit;opacity:.85;font-size:14px}' +
    '.vv-msg{flex-basis:100%;font-size:15px;min-height:1.2em;color:inherit}' +
    '.vv-msg.good{color:var(--ok,#16a34a);font-weight:600}.vv-msg.bad{color:var(--bad,#dc2626);font-weight:600}';

  function injectCss() {
    if (document.getElementById('vv-css')) return;
    var s = document.createElement('style');
    s.id = 'vv-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function btn(label, cls, aria) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'vv-btn ' + (cls || '');
    b.textContent = label;
    b.setAttribute('aria-label', aria || label);
    return b;
  }

  /* mount(container, word): add the toolbar under the current card.
   * Call again for each new card; the old toolbar is replaced. */
  function mount(container, word, opts) {
    if (!container || !word) return;
    injectCss();
    var old = container.querySelector('.vv-bar');
    if (old) old.remove();

    var bar = document.createElement('div');
    bar.className = 'vv-bar';
    var msg = document.createElement('div');
    msg.className = 'vv-msg';
    msg.setAttribute('aria-live', 'polite');

    if (TTS) {
      var b1 = btn('Listen', '', 'Listen to the word');
      var b2 = btn('Slow', 'alt', 'Listen slowly');
      b1.onclick = function () { say(word, false); };
      b2.onclick = function () { say(word, true); };
      bar.appendChild(b1);
      bar.appendChild(b2);
    }

    if (SR) {
      var b3 = btn('Say it', 'alt', 'Say the word and check your pronunciation');
      b3.onclick = function () {
        msg.className = 'vv-msg';
        msg.textContent = 'Listening… say the word.';
        b3.classList.add('on');
        listen(word, function (r) {
          b3.classList.remove('on');
          if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
            msg.className = 'vv-msg bad';
            msg.textContent = 'Microphone is blocked. Allow it in the browser address bar.';
          } else if (r.error) {
            msg.className = 'vv-msg bad';
            msg.textContent = 'I did not hear anything. Tap "Say it" and try again.';
          } else if (r.match) {
            msg.className = 'vv-msg good';
            msg.textContent = 'Great! Clear pronunciation.';
            if (opts && typeof opts.onMatch === 'function') {
              Promise.resolve()
                .then(function () { return opts.onMatch(); })
                .then(function (res) {
                  if (res && res.awarded) {
                    msg.textContent = 'Great! +' + res.xp + ' XP for pronunciation.';
                  } else {
                    msg.textContent = 'Great! You already earned XP for this word.';
                  }
                })
                .catch(function () {
                  msg.className = 'vv-msg bad';
                  msg.textContent = 'Good pronunciation, but the XP could not be saved. Check your connection and try again.';
                });
            }
          } else {
            msg.className = 'vv-msg bad';
            msg.textContent = 'I heard "' + r.heard + '". Tap Listen, then try again.';
          }
        });
      };
      bar.appendChild(b3);
    }

    if (TTS) {
      var lab = document.createElement('label');
      lab.className = 'vv-auto';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = autoRead();
      cb.onchange = function () {
        setAutoRead(cb.checked);
        if (cb.checked) say(word, false);
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode('Auto-read each card'));
      bar.appendChild(lab);
    }

    if (opts && opts.earned) {
      msg.className = 'vv-msg good';
      msg.textContent = 'Pronunciation XP earned for this word ✓';
    }
    bar.appendChild(msg);
    container.appendChild(bar);

    if (autoRead()) say(word, false);
  }

  window.VocabVoice = {
    say: say,
    listen: listen,
    mount: mount,
    canSpeak: TTS,
    canListen: !!SR
  };
})();
