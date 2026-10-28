/* web-kit — the shared offline-first runtime for drsamonline apps.
 * One file. No build step. No CDN. Works from file:// and GitHub Pages.
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 *
 * Exposes window.Loom with: storage, i18n, csv, theme, a11y, pwa, seo, ui.
 */
(function (root) {
  "use strict";
  var VERSION = "0.1.0";
  var Loom = { version: VERSION };

  /* ---------- storage (localStorage + a tiny IndexedDB wrapper) ---------- */
  Loom.storage = (function () {
    var PREFIX = "loom:";
    function key(k) { return PREFIX + k; }
    function idb(dbName, store) {
      return new Promise(function (res, rej) {
        var req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }
    function tx(dbName, store, mode, fn) {
      return idb(dbName, store).then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(store, mode);
          var out = fn(t.objectStore(store));
          t.oncomplete = function () { res(out && out.result); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (name, fallback) {
        try { var v = localStorage.getItem(key(name)); return v == null ? fallback : JSON.parse(v); }
        catch (e) { return fallback; }
      },
      set: function (name, value) {
        try { localStorage.setItem(key(name), JSON.stringify(value)); return true; }
        catch (e) { return false; }
      },
      remove: function (name) { try { localStorage.removeItem(key(name)); } catch (e) {} },
      clear: function () {
        try {
          Object.keys(localStorage).filter(function (x) { return x.indexOf(PREFIX) === 0; })
            .forEach(function (x) { localStorage.removeItem(x); });
        } catch (e) {}
      },
      put: function (db, store, k, v) { return tx(db, store, "readwrite", function (s) { return s.put(v, k); }); },
      getItem: function (db, store, k) { return tx(db, store, "readonly", function (s) { return s.get(k); }); },
      all: function (db, store) { return tx(db, store, "readonly", function (s) { return s.getAll(); }); },

      /* ---------- namespace (opt-in, default unchanged) ----------
       * An app that already has keys under its OWN prefix cannot adopt this store
       * without orphaning what its users have saved: every read would miss. Until
       * now the prefix was fixed at "loom:", so three repos that vendor this kit
       * and never call it (kent-repertory-explorer, offline-pdf-toolkit,
       * remedy-relationship-explorer) had no way across.
       *
       * Call it ONCE, before the first read, and the store uses that prefix:
       *
       *     Loom.storage.namespace("rre").get("cases")   // reads "rre:cases"
       *
       * The default is untouched: an app that never calls this sees exactly the
       * keys it saw before, which is why this is safe to ship to every consumer.
       * Pass "" or null to go back to "loom:". The name is stripped to
       * [A-Za-z0-9_.-] so a namespace cannot smuggle in a separator of its own.
       */
      namespace: function (name) {
        if (name == null || name === "") { PREFIX = "loom:"; return this; }
        var s = String(name).replace(/[^A-Za-z0-9_.-]/g, "");
        PREFIX = s ? s + ":" : "loom:";
        return this;
      },
      /* what prefix the store is writing under right now - so a migration script
         can prove which key a value lives at instead of assuming */
      prefix: function () { return PREFIX; }
    };
  })();

  /* ---------- i18n (English / Hindi / Gujarati) ---------- */
  Loom.i18n = (function () {
    var dict = {
      en: { app_ready: "Ready. Your data stays on this device.", save: "Save", cancel: "Cancel",
            search: "Search", export: "Export", import: "Import", settings: "Settings", language: "Language" },
      hi: { app_ready: "तैयार। आपका डेटा इस डिवाइस पर ही रहता है।", save: "सहेजें", cancel: "रद्द करें",
            search: "खोजें", export: "निर्यात", import: "आयात", settings: "सेटिंग्स", language: "भाषा" },
      gu: { app_ready: "તૈયાર. તમારો ડેટા આ ઉપકરણ પર જ રહે છે.", save: "સાચવો", cancel: "રદ કરો",
            search: "શોધો", export: "નિકાસ", import: "આયાત", settings: "સેટિંગ્સ", language: "ભાષા" }
    };
    var lang = Loom.storage.get("lang", "en");
    return {
      get lang() { return lang; },
      langs: function () { return Object.keys(dict); },
      setLang: function (l) { if (dict[l]) { lang = l; Loom.storage.set("lang", l); try { document.documentElement.lang = l; } catch (e) {} } },
      t: function (key, fallback) { return (dict[lang] && dict[lang][key]) || (dict.en && dict.en[key]) || fallback || key; },
      extend: function (l, obj) { dict[l] = Object.assign(dict[l] || {}, obj); }
    };
  })();

  /* ---------- csv ---------- */
  Loom.csv = (function () {
    // CSV injection guard: a leading = + - @ (or TAB/CR) is a FORMULA to Excel and
    // Sheets. Prefix it with an apostrophe - but leave a NUMBER alone, so "-5"
    // does not become "'-5". (The apps had this guard before the kit did.)
    function csvSafe(v) { v = v == null ? "" : String(v); return (/^[=+\-@\t\r]/.test(v) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) ? "'" + v : v; }
    function esc(v) { v = csvSafe(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function parseLine(line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; } }
          else { cur += ch; }
        } else {
          if (ch === '"') q = true;
          else if (ch === ",") { out.push(cur); cur = ""; }
          else cur += ch;
        }
      }
      out.push(cur);
      return out;
    }
    return {
      csvSafe: csvSafe,
      toCSV: function (rows) {
        if (!rows || !rows.length) return "";
        var cols = Object.keys(rows[0]);
        return cols.map(esc).join(",") + "\n" +
          rows.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(","); }).join("\n");
      },
      fromCSV: function (text) {
        var lines = String(text).replace(/\r/g, "").split("\n").filter(Boolean);
        if (!lines.length) return [];
        var cols = parseLine(lines[0]);
        return lines.slice(1).map(function (l) {
          var v = parseLine(l), o = {};
          cols.forEach(function (c, i) { o[c] = v[i]; });
          return o;
        });
      },
      download: function (filename, text) {
        var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }
    };
  })();

  /* ---------- theme ---------- */
  Loom.theme = (function () {
    var dark = { "--bg": "#0f1115", "--card": "#171a21", "--ink": "#e7e9ee", "--mut": "#9aa3b2", "--line": "#252a34", "--acc": "#22c55e" };
    var light = { "--bg": "#ffffff", "--card": "#f6f7f9", "--ink": "#12151b", "--mut": "#5b6472", "--line": "#e3e6ea", "--acc": "#15803d" };
    function applyTokens(t) {
      Object.keys(t).forEach(function (k) { document.documentElement.style.setProperty(k, t[k]); });
    }
    return {
      tokens: dark,
      apply: function (mode) {
        mode = mode || Loom.storage.get("theme", "system");
        var isDark = mode === "dark" ||
          (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        applyTokens(isDark ? dark : light);
        document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
      },
      set: function (mode) { Loom.storage.set("theme", mode); this.apply(mode); },
      toggle: function () { this.set(Loom.storage.get("theme", "system") === "dark" ? "light" : "dark"); }
    };
  })();

  /* ---------- a11y ---------- */
  Loom.a11y = (function () {
    return {
      trapFocus: function (el) {
        var sel = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
        function h(e) {
          if (e.key !== "Tab") return;
          var f = el.querySelectorAll(sel); if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
          else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
        el.addEventListener("keydown", h);
        return function () { el.removeEventListener("keydown", h); };
      },
      announce: function (msg) {
        var r = document.getElementById("loom-live");
        if (!r) {
          r = document.createElement("div"); r.id = "loom-live";
          r.setAttribute("aria-live", "polite");
          r.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
          document.body.appendChild(r);
        }
        r.textContent = msg;
      }
    };
  })();

  /* ---------- pwa ---------- */
  Loom.pwa = (function () {
    return {
      register: function (swPath) {
        if ("serviceWorker" in navigator && location.protocol !== "file:") {
          navigator.serviceWorker.register(swPath || "./sw.js").catch(function () {});
        }
      },
      themeColor: function (color) {
        var m = document.querySelector('meta[name="theme-color"]');
        if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
        m.content = color;
      }
    };
  })();

  /* ---------- seo ---------- */
  Loom.seo = (function () {
    function meta(name, content, attr) {
      attr = attr || "name";
      var m = document.querySelector("meta[" + attr + '="' + name + '"]');
      if (!m) { m = document.createElement("meta"); m.setAttribute(attr, name); document.head.appendChild(m); }
      m.content = content;
    }
    return {
      title: function (t) { document.title = t; meta("og:title", t, "property"); },
      description: function (d) { meta("description", d); meta("og:description", d, "property"); },
      jsonld: function (obj) {
        var s = document.createElement("script"); s.type = "application/ld+json";
        s.textContent = JSON.stringify(obj); document.head.appendChild(s);
      }
    };
  })();

  /* ---------- ui (tiny DOM helper) ---------- */
  Loom.ui = (function () {
    return {
      el: function (tag, props, children) {
        var e = document.createElement(tag);
        if (props) {
          for (var k in props) {
            if (k === "class") e.className = props[k];
            else if (k === "html") e.innerHTML = props[k];
            else if (k === "text") e.textContent = props[k];
            else if (k.indexOf("on") === 0 && typeof props[k] === "function") e.addEventListener(k.slice(2).toLowerCase(), props[k]);
            else e.setAttribute(k, props[k]);
          }
        }
        (children || []).forEach(function (c) {
          e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        });
        return e;
      }
    };
  })();

  root.Loom = Loom;
})(typeof window !== "undefined" ? window : this);
