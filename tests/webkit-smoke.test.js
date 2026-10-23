'use strict';
/**
 * The Whispering Body - First-Aid Box: headless DOM smoke suite.
 *
 * Drives the real app pages in happy-dom and asserts that persistence now runs
 * through web-kit's Loom.storage, that the app's own behaviour is unchanged,
 * and that values saved *before* the retrofit (the legacy raw, un-prefixed
 * `fab_lang` / `fab_safe` localStorage keys) are migrated into Loom.storage
 * with no data loss.
 *
 * Both mirrored pages are exercised by default:
 *   - index.html            (the root app)
 *   - docs/play/index.html  (the GitHub Pages copy)
 *
 *   node tests/webkit-smoke.test.js [path-to-index.html ...]
 */
const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');

const root = path.join(__dirname, '..');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(root, 'index.html'), path.join(root, 'docs/play/index.html')];

// Read a page: its web-kit runtime, the inline <script> blocks (the migration
// shim + the app), and the same HTML with every script stripped so it can be
// parsed without executing anything until we say so.
function prepare(file) {
  const html = fs.readFileSync(file, 'utf8');
  const wk = fs.readFileSync(path.join(path.dirname(file), 'web-kit.js'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const htmlNoScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return { wk, inline, htmlNoScripts };
}

// Boot the page in a fresh window, optionally seeding legacy localStorage first.
// The app's state object `C` is lexical, so expose it on window from within the
// same evaluation, then drive/read it through window.__C.
function boot(p, seed) {
  const w = new Window({ url: 'https://local.test/' });
  for (const [k, v] of Object.entries(seed || {})) { try { w.localStorage.setItem(k, v); } catch (e) {} }
  w.document.write(p.htmlNoScripts);
  w.eval(p.wk);
  w.eval(p.inline + '\n;window.__C = (typeof C !== "undefined") ? C : null;');
  return w;
}
function snapshot(w) {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); out[k] = w.localStorage.getItem(k); }
  return out;
}

const results = [];
const ok = (page, name, cond, extra = '') => results.push({ page, name, pass: !!cond, extra });

function suite(file) {
  const p = prepare(file);
  const label = path.relative(root, file) || file;

  // 1. the app boots on the shared runtime
  let w = boot(p);
  ok(label, 'web-kit loads: window.Loom exists after boot', w.eval('typeof Loom') === 'object');
  const appEl = w.document.getElementById('app');
  ok(label, 'the app renders into #app', appEl && appEl.innerHTML.length > 0);

  // 2. a fresh install starts on the default language and writes nothing yet
  ok(label, 'fresh install: default language is "en"', w.eval('window.__C && window.__C.lang') === 'en');
  ok(label, 'fresh install: nothing persisted under loom: yet', Object.keys(snapshot(w)).length === 0);

  // 3. switching language persists through Loom.storage (namespaced, JSON-safe)
  const hi = w.document.querySelector('button[data-l="hi"]');
  if (hi) hi.click();
  let snap = snapshot(w);
  ok(label, 'language switch is written to Loom.storage (loom:fab_lang)', snap['loom:fab_lang'] === JSON.stringify('hi'), JSON.stringify(snap));
  ok(label, 'language switch writes nothing to the raw legacy key', !('fab_lang' in snap));

  // 4. and it survives a reload
  let w2 = boot(p, snap);
  ok(label, 'language survives a reload through Loom.storage', w2.eval('window.__C.lang') === 'hi', String(w2.eval('window.__C.lang')));

  // 5. a language chosen BEFORE the retrofit is migrated, not lost
  let w3 = boot(p, { fab_lang: 'gu' });
  const snap3 = snapshot(w3);
  ok(label, 'legacy raw fab_lang is migrated with no data loss', w3.eval('window.__C.lang') === 'gu', String(w3.eval('window.__C.lang')));
  ok(label, 'legacy fab_lang key is removed after migration', ('loom:fab_lang' in snap3) && !('fab_lang' in snap3), JSON.stringify(snap3));

  // 6. the one-time safety modal round-trips through Loom.storage
  let w4 = boot(p);
  ok(label, 'safety modal is shown on a fresh install', !!w4.document.querySelector('.modal'));
  const okBtn = w4.document.getElementById('ok');
  if (okBtn) okBtn.click();
  const snap4 = snapshot(w4);
  ok(label, 'dismissing the modal writes loom:fab_safe (and no raw fab_safe)', snap4['loom:fab_safe'] === JSON.stringify('1') && !('fab_safe' in snap4), JSON.stringify(snap4));
  ok(label, 'dismissing the modal closes it', !w4.document.querySelector('.modal'));
  let w5 = boot(p, snap4);
  ok(label, 'the modal is not shown twice after a reload', !w5.document.querySelector('.modal'));

  // 7. a dismiss recorded BEFORE the retrofit keeps the modal away too
  let w6 = boot(p, { fab_safe: '1' });
  const snap6 = snapshot(w6);
  ok(label, 'legacy raw fab_safe is migrated so the modal stays away', !w6.document.querySelector('.modal') && ('loom:fab_safe' in snap6) && !('fab_safe' in snap6), JSON.stringify(snap6));
}

files.forEach(suite);

let pass = 0, fail = 0;
for (const r of results) {
  if (r.pass) { pass++; console.log('PASS  [' + r.page + '] ' + r.name); }
  else { fail++; console.log('FAIL  [' + r.page + '] ' + r.name + (r.extra ? '  ' + r.extra : '')); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
