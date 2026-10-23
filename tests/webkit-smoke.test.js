'use strict';
/**
 * Whispering Body - First-Aid Box - headless DOM smoke suite.
 *
 * Drives the *real* app page in happy-dom and asserts that persistence now goes
 * through web-kit's Loom.storage (namespaced under "loom:"), that a preference
 * saved *before* the retrofit (the raw un-prefixed "fab_lang" key) is migrated
 * into Loom.storage with no data loss, and that nothing is written to the raw
 * keys any more.
 *
 * The app ships two mirrored copies of the page (index.html and the GitHub Pages
 * copy docs/play/index.html); both must behave identically, so the suite runs the
 * whole battery against both.
 *
 *   node tests/webkit-smoke.test.js [path-to-index.html]
 */
const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');

const root = path.join(__dirname, '..');
const targets = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : [path.join(root, 'index.html'), path.join(root, 'docs', 'play', 'index.html')];

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra });

function loadParts(file) {
  const html = fs.readFileSync(file, 'utf8');
  const wkPath = path.join(path.dirname(file), 'web-kit.js');
  const wk = fs.existsSync(wkPath) ? fs.readFileSync(wkPath, 'utf8') : '';
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return { wk, inline, htmlNoScripts };
}

function boot(parts, seed) {
  const w = new Window({ url: 'https://local.test/' });
  for (const [k, v] of Object.entries(seed || {})) {
    try { w.localStorage.setItem(k, v); } catch (e) {}
  }
  w.document.write(parts.htmlNoScripts);
  if (parts.wk) w.eval(parts.wk);
  w.eval(parts.inline.join('\n'));
  return w;
}

function snapshot(w) {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    out[k] = w.localStorage.getItem(k);
  }
  return out;
}

function suite(label, file) {
  const parts = loadParts(file);
  const tag = label + ': ';

  // 1. web-kit boots and exposes Loom.storage
  let w = boot(parts);
  ok(tag + 'web-kit loaded (window.Loom.storage present)',
    w.eval('typeof Loom') === 'object' && w.eval('typeof Loom.storage.get') === 'function');

  // 2. the app itself still renders
  const app = w.document.getElementById('app');
  ok(tag + 'app renders (root + tab bar present)',
    !!app && app.innerHTML.length > 500 && w.document.querySelectorAll('[data-tab]').length >= 4,
    app ? String(app.innerHTML.length) : 'no #app');

  // 3. a fresh install starts clean: nothing persisted yet
  ok(tag + 'fresh install writes nothing on first load',
    !Object.keys(snapshot(w)).some(k => k.indexOf('loom:') === 0 || k === 'fab_lang' || k === 'fab_safe'),
    JSON.stringify(snapshot(w)));

  // 4. the first-run safety acknowledgement persists through Loom.storage
  const okBtn = w.document.getElementById('ok');
  ok(tag + 'first run shows the safety modal', !!w.document.querySelector('.modal') && !!okBtn);
  if (okBtn) okBtn.click();
  ok(tag + 'safety ack round-trips through Loom.storage',
    w.eval('JSON.stringify(Loom.storage.get("fab_safe", null))') === '"1"',
    w.eval('JSON.stringify(Loom.storage.get("fab_safe", null))'));
  ok(tag + 'safety ack writes nothing to the raw key', !('fab_safe' in snapshot(w)));

  // 5. choosing a language persists through Loom.storage (and is honoured on reload)
  const hi = w.document.querySelector('[data-l="hi"]');
  ok(tag + 'language switcher is present', !!hi);
  if (hi) hi.click();
  ok(tag + 'language choice round-trips through Loom.storage',
    w.eval('JSON.stringify(Loom.storage.get("fab_lang", null))') === '"hi"',
    w.eval('JSON.stringify(Loom.storage.get("fab_lang", null))'));
  ok(tag + 'language choice writes nothing to the raw key', !('fab_lang' in snapshot(w)));

  const w2 = boot(parts, snapshot(w));
  ok(tag + 'language choice survives a reload (Devanagari rendered)',
    /[\u0900-\u097F]/.test((w2.document.getElementById('app') || {}).textContent || ''),
    String(((w2.document.getElementById('app') || {}).textContent || '').slice(0, 40)));

  // 6. a preference saved BEFORE the retrofit (raw key) is migrated, not lost
  const w3 = boot(parts, { fab_lang: 'gu' });
  const snap3 = snapshot(w3);
  ok(tag + 'legacy raw preference is migrated into Loom.storage',
    w3.eval('JSON.stringify(Loom.storage.get("fab_lang", null))') === '"gu"',
    w3.eval('JSON.stringify(Loom.storage.get("fab_lang", null))'));
  ok(tag + 'legacy raw key is removed after migration', !('fab_lang' in snap3));
}

(function main() {
  for (const t of targets) suite(path.relative(root, t), t);

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('PASS  ' + r.name); }
    else { fail++; console.log('FAIL  ' + r.name + (r.extra ? '  ' + r.extra : '')); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
