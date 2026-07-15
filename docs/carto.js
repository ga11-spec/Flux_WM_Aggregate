/* ============================================================================
   World Monitor — Onglet Cartographie (carto.js)
   ---------------------------------------------------------------------------
   Fichier autonome à déposer dans le dossier `docs/`, à côté de index.html.
   Une seule ligne à ajouter dans index.html, juste avant </body> :
        <script src="carto.js"></script>

   Ce script REMPLIT l'onglet « 🗺️ Cartographie » (qui était vide) en
   réutilisant tout ce qui existe déjà dans index.html :
     - WORLD ............ géométrie SVG de chaque pays
     - colorScale() ..... échelle de couleur bleue
     - mapTip()/mapTipHide() ... infobulle au survol
     - openCountry() .... fiche pays au clic
     - filtered() ....... la sélection courante de l'onglet Explorer
     - isJunk / NONPAYS / disp / esc ... utilitaires
   Aucune dépendance externe. Rien d'autre à modifier.
   ========================================================================== */
(function () {
  "use strict";

  // Attend que index.html ait fini de définir ses fonctions et chargé les données.
  function ready(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // --- les mesures proposées (calculées par pays sur la sélection courante) ---
  var MEASURES = {
    count:    { label: "Nombre d'articles",              unit: "article(s)" },
    sources:  { label: "Nombre de sources distinctes",   unit: "source(s)"  },
    naval:    { label: "Intérêt naval moyen (/40)",       unit: "pts (moy.)" },
    navcount: { label: "Articles à signal naval (⚓ > 0)", unit: "article(s) ⚓" }
  };

  var state = { measure: "count", built: false };

  // Agrège la sélection courante par pays traité (r.ca), hors valeurs non classées.
  function aggregate(rows, measure) {
    var g = {};
    rows.forEach(function (r) {
      var c = r.ca;
      if (!c || isJunk(c) || NONPAYS.has(c)) return;
      var o = g[c] || (g[c] = { n: 0, medias: new Set(), nvsum: 0, nvpos: 0 });
      o.n++;
      o.medias.add(r.m);
      if (r.nv != null) { o.nvsum += r.nv; if (r.nv > 0) o.nvpos++; }
    });
    var out = {};
    for (var c in g) {
      var o = g[c];
      out[c] =
        measure === "sources"  ? o.medias.size :
        measure === "naval"    ? +(o.nvsum / o.n).toFixed(2) :
        measure === "navcount" ? o.nvpos :
                                 o.n;
    }
    return out;
  }

  // Rendu de la carte mondiale (choroplèthe) — reprend la logique de realSvgMap
  // mais avec une infobulle adaptée à la mesure choisie et sans étoile de siège.
  function mapSVG(counts, unit) {
    var all = Object.keys(WORLD);
    var vals = all.map(function (n) { return counts[n] || 0; });
    var max = Math.max.apply(null, [1].concat(vals));
    var shapes = all.map(function (n) {
      var w = WORLD[n], cnt = counts[n] || 0;
      var fill = cnt ? colorScale(cnt / max) : "#e8edf5";
      var tip = esc(n + (cnt ? " — " + fmt(cnt) + " " + unit : " — 0"));
      var common =
        'data-c="' + esc(n) + '" data-tip="' + tip + '" ' +
        'onmousemove="mapTip(event,this.dataset.tip)" onmouseout="mapTipHide()" ' +
        'onclick="mapTipHide();openCountry(this.dataset.c)" style="cursor:pointer"';
      if (w.d)
        return '<path d="' + w.d + '" fill="' + fill +
               '" stroke="#8ba0c0" stroke-width="0.5" ' + common + "/>";
      return '<circle cx="' + w.c[0] + '" cy="' + w.c[1] +
             '" r="3" fill="' + (cnt ? colorScale(cnt / max) : "#b9c6da") +
             '" stroke="#8ba0c0" stroke-width=".4" ' + common + "/>";
    }).join("");
    return '<div class="mapbox"><svg viewBox="0 25 1000 405" ' +
           'style="width:100%;height:560px" preserveAspectRatio="xMidYMid meet">' +
           shapes + "</svg></div>";
  }

  function fmt(v) {
    return (v % 1) ? v.toFixed(2) : v.toLocaleString("fr-FR");
  }

  // Légende dégradée min → max.
  function legend(max, unit) {
    var stops = [0, 0.25, 0.5, 0.75, 1]
      .map(function (t) {
        return '<span style="flex:1;height:14px;background:' +
               colorScale(t) + '"></span>';
      }).join("");
    return (
      '<div style="display:flex;align-items:center;gap:10px;margin:10px 0 4px;flex-wrap:wrap">' +
        '<span class="count">Faible</span>' +
        '<div style="display:flex;width:220px;border:1px solid var(--border);border-radius:4px;overflow:hidden">' +
          stops + "</div>" +
        '<span class="count">Élevé — jusqu\'à <b>' + fmt(max) + "</b> " + unit + "</span>" +
        '<span class="count" style="margin-left:auto">⬜ pays sans article dans la sélection</span>' +
      "</div>"
    );
  }

  // Panneau latéral : classement des pays (cliquable), y compris ceux sans géométrie.
  function ranking(counts, unit) {
    var entries = Object.keys(counts)
      .map(function (c) { return [c, counts[c]]; })
      .filter(function (e) { return e[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var covered = entries.length;
    var top = entries.slice(0, 25);
    var maxv = top.length ? top[0][1] : 1;
    var rows = top.map(function (e) {
      var pct = Math.round(100 * e[1] / maxv);
      return (
        '<div class="mrow" data-c="' + esc(e[0]) +
        '" onclick="openCountry(this.dataset.c)" ' +
        'style="display:block;position:relative;padding:8px 10px">' +
          '<span style="position:absolute;left:0;top:0;bottom:0;width:' + pct +
          '%;background:rgba(79,140,255,.16);border-radius:6px"></span>' +
          '<span style="position:relative;display:flex;justify-content:space-between;gap:10px">' +
            '<b style="color:var(--text);font-weight:600">' + esc(e[0]) + "</b>" +
            '<span class="badge">' + fmt(e[1]) + "</span>" +
          "</span>" +
        "</div>"
      );
    }).join("");
    return (
      '<div>' +
        '<div class="count" style="margin-bottom:6px"><b>' + covered +
        "</b> pays couverts · classement par " + unit +
        (entries.length > 25 ? " · top 25" : "") + "</div>" +
        rows +
      "</div>"
    );
  }

  // Construit le squelette de l'onglet (une seule fois).
  function build() {
    var host = document.getElementById("tab-carto");
    if (!host) return false;
    var opts = Object.keys(MEASURES).map(function (k) {
      return '<option value="' + k + '"' +
        (k === state.measure ? " selected" : "") + ">" +
        MEASURES[k].label + "</option>";
    }).join("");
    host.innerHTML =
      '<h2 style="margin-bottom:6px">🗺️ Cartographie</h2>' +
      '<p class="count" style="margin-bottom:14px">Répartition géographique de la ' +
      'sélection courante (recherche + filtres de l\'onglet <b>Explorer</b>). ' +
      'Survole un pays pour le détail, clique pour ouvrir sa fiche.</p>' +
      '<div class="chartctl" style="margin-bottom:6px">' +
        '<div><label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:5px">Mesure</label>' +
          '<select id="cartoMeasure">' + opts + "</select></div>" +
        '<div style="align-self:flex-end"><span class="count" id="cartoScope"></span></div>' +
      "</div>" +
      '<div id="cartoLegend"></div>' +
      '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
        '<div id="cartoMap" style="flex:1;min-width:320px"></div>' +
        '<div id="cartoRank" style="width:280px;max-width:100%;max-height:600px;overflow:auto"></div>' +
      "</div>";
    document.getElementById("cartoMeasure").addEventListener("change", function () {
      state.measure = this.value;
      render();
    });
    state.built = true;
    return true;
  }

  function visible() {
    var host = document.getElementById("tab-carto");
    return host && host.style.display !== "none";
  }

  function render() {
    if (typeof WORLD === "undefined") {
      var h = document.getElementById("tab-carto");
      if (h) h.innerHTML =
        '<div class="mapwait">🗺️ Fond de carte introuvable (variable WORLD manquante dans index.html).</div>';
      return;
    }
    if (!state.built && !build()) return;
    if (typeof filtered !== "function") return;  // filtered() lit DATA en interne

    var rows = filtered();
    var m = MEASURES[state.measure];
    var counts = aggregate(rows, state.measure);
    var vals = Object.keys(counts).map(function (c) { return counts[c]; });
    var max = Math.max.apply(null, [1].concat(vals));

    document.getElementById("cartoScope").innerHTML =
      "sur <b>" + rows.length.toLocaleString("fr-FR") + "</b> article(s) sélectionné(s)";
    document.getElementById("cartoLegend").innerHTML = legend(max, m.unit);
    document.getElementById("cartoMap").innerHTML = mapSVG(counts, m.unit);
    document.getElementById("cartoRank").innerHTML = ranking(counts, m.unit);
  }

  ready(function () {
    // 1) rendu quand on clique sur l'onglet Cartographie (après le handler d'origine)
    document.querySelectorAll(".tab").forEach(function (t) {
      if (t.dataset.tab === "carto")
        t.addEventListener("click", function () { setTimeout(render, 0); });
    });

    // 2) garder la carte synchronisée avec les filtres de l'onglet Explorer :
    //    on englobe renderAll() sans casser son comportement d'origine.
    if (typeof window.renderAll === "function") {
      var orig = window.renderAll;
      window.renderAll = function () {
        orig.apply(this, arguments);
        if (visible()) render();
      };
    }

    // 3) si l'utilisateur arrive directement sur l'onglet déjà ouvert
    if (visible()) render();
  });
})();
