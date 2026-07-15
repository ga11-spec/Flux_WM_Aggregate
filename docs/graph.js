/* ============================================================================
   World Monitor — Onglet Graphe pondéré (graph.js)
   ---------------------------------------------------------------------------
   Fichier autonome à déposer dans `docs/`, à côté de index.html + carto.js.
   Une seule ligne à ajouter dans index.html, juste avant </body> :
        <script src="graph.js"></script>
   (peu importe l'ordre par rapport à carto.js)

   Générateur de graphe : deux menus « Nœud de départ » / « Nœud d'arrivée »
   (Média, Pays traité, Pays d'origine, Thème article, Thème média), dans le
   sens qu'on veut. Un lien A→B = nombre d'articles reliant la valeur A (départ)
   à la valeur B (arrivée) ; flèche orientée, épaisseur = poids.

   Rendu : vis-network (physique ForceAtlas2Based, gravité à la Gephi), chargé
   dynamiquement depuis un CDN au premier affichage. Clic sur un nœud → fiche
   correspondante (openCountry / openSource / openTheme), réutilise l'existant.
   ========================================================================== */
(function () {
  "use strict";

  var VIS_URL = "https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js";

  // dimensions sélectionnables : clé de champ -> libellé + type (pour le clic)
  var DIMS = {
    ch: { label: "Pays d'origine du média", kind: "country" },
    ca: { label: "Pays traité",             kind: "country" },
    m:  { label: "Média",                   kind: "media"   },
    sa: { label: "Thème de l'article",      kind: "theme"   },
    sm: { label: "Thème du média",          kind: "theme"   }
  };

  var COLORS = {
    source: "#4f8cff",   // apparaît seulement comme départ
    target: "#37c99e",   // apparaît seulement comme arrivée
    both:   "#9b7bf6"    // les deux
  };

  var state = {
    src: "ch", tgt: "ca", topN: 30,
    built: false, network: null, visLoading: null
  };

  function ready(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  // charge vis-network une seule fois (promesse mémoïsée)
  function loadVis() {
    if (window.vis && window.vis.Network) return Promise.resolve();
    if (state.visLoading) return state.visLoading;
    state.visLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = VIS_URL;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("CDN vis-network injoignable")); };
      document.head.appendChild(s);
    });
    return state.visLoading;
  }

  function isBad(v) {
    return !v || (typeof isJunk === "function" && isJunk(v)) ||
           (typeof NONPAYS !== "undefined" && NONPAYS.has && NONPAYS.has(v));
  }

  function topByValue(obj, n) {
    return Object.keys(obj)
      .sort(function (a, b) { return obj[b] - obj[a]; })
      .slice(0, n);
  }

  // ---- agrégation : articles reliant (valeur départ -> valeur arrivée) ----
  function buildGraphData(rows, srcDim, tgtDim, topN) {
    var edge = {};                 // key -> { from, to, w }
    var srcTot = {}, tgtTot = {};
    rows.forEach(function (r) {
      var a = r[srcDim], b = r[tgtDim];
      if (isBad(a) || isBad(b)) return;
      if (srcDim === tgtDim && a === b) return;   // pas de boucle sur soi-même
      var k = a + "\n" + b;                        // \n : séparateur absent des valeurs
      var e = edge[k] || (edge[k] = { from: a, to: b, w: 0 });
      e.w += 1;
      srcTot[a] = (srcTot[a] || 0) + 1;
      tgtTot[b] = (tgtTot[b] || 0) + 1;
    });

    var keepSrc = new Set(topByValue(srcTot, topN));
    var keepTgt = new Set(topByValue(tgtTot, topN));

    var nodes = {};
    function touch(val, role, dim) {
      var n = nodes[val] || (nodes[val] = { id: val, weight: 0, roles: {}, dim: dim });
      n.roles[role] = true;
      return n;
    }

    var edges = [];
    Object.keys(edge).forEach(function (k) {
      var e = edge[k];
      if (!keepSrc.has(e.from) || !keepTgt.has(e.to)) return;
      touch(e.from, "source", srcDim).weight += e.w;
      touch(e.to, "target", tgtDim).weight += e.w;
      edges.push({ from: e.from, to: e.to, value: e.w,
        title: esc(e.from + " → " + e.to + " : " + e.w + " article(s)") });
    });

    var visNodes = Object.keys(nodes).map(function (val) {
      var n = nodes[val];
      var role = (n.roles.source && n.roles.target) ? "both"
               : n.roles.source ? "source" : "target";
      return {
        id: n.id,
        label: n.id.length > 22 ? n.id.slice(0, 21) + "…" : n.id,
        value: n.weight,
        title: esc(n.id + " · " + n.weight + " lien(s)"),
        color: { background: COLORS[role], border: "#0f1420",
                 highlight: { background: COLORS[role], border: "#fff" } },
        font: { color: "#e8ecf4", size: 14, strokeWidth: 3, strokeColor: "#0f1420" },
        _kind: DIMS[n.dim] ? DIMS[n.dim].kind : "country"
      };
    });
    return { nodes: visNodes, edges: edges };
  }

  // ---- clic sur un nœud → fiche existante ----
  function openNode(id, kind) {
    if (kind === "media" && typeof openSource === "function") return openSource(id);
    if (kind === "theme" && typeof openTheme === "function") return openTheme(id);
    if (typeof openCountry === "function") return openCountry(id);
  }

  // ---- construction / rendu ----
  function render() {
    if (!state.built && !injectTab()) return;
    var host = document.getElementById("graphCanvas");
    var info = document.getElementById("graphInfo");
    if (typeof DATA === "undefined" || !DATA.length) { info.textContent = "Données non chargées."; return; }

    info.textContent = "Chargement du moteur de graphe…";
    loadVis().then(function () {
      var g = buildGraphData(DATA, state.src, state.tgt, state.topN);
      if (!g.edges.length) {
        info.textContent = "Aucun lien pour ce couple de dimensions.";
        host.innerHTML = "";
        return;
      }
      info.innerHTML = "<b>" + g.nodes.length + "</b> nœuds · <b>" + g.edges.length +
        "</b> liens · " + DIMS[state.src].label.toLowerCase() +
        " <span style='color:#4f8cff'>➜</span> " + DIMS[state.tgt].label.toLowerCase() +
        " · tout le corpus (top " + state.topN + " par côté)";

      var data = {
        nodes: new vis.DataSet(g.nodes),
        edges: new vis.DataSet(g.edges.map(function (e, i) {
          return { id: i, from: e.from, to: e.to, value: e.value, title: e.title,
                   arrows: "to",
                   color: { color: "#8ba0c0", opacity: 0.35, highlight: "#4f8cff" },
                   smooth: { type: "continuous" } };
        }))
      };
      var options = {
        nodes: { shape: "dot", scaling: { min: 8, max: 46,
                 label: { enabled: true, min: 11, max: 22 } }, borderWidth: 1 },
        edges: { scaling: { min: 0.4, max: 9 }, selectionWidth: 2 },
        interaction: { hover: true, tooltipDelay: 120, navigationButtons: false, keyboard: false },
        physics: {
          solver: "forceAtlas2Based",
          forceAtlas2Based: { gravitationalConstant: -55, centralGravity: 0.012,
            springLength: 110, springConstant: 0.08, damping: 0.5, avoidOverlap: 0.4 },
          stabilization: { iterations: 220 }
        }
      };
      if (state.network) { state.network.destroy(); state.network = null; }
      state.network = new vis.Network(host, data, options);
      var kindOf = {};
      g.nodes.forEach(function (n) { kindOf[n.id] = n._kind; });
      state.network.on("click", function (params) {
        if (params.nodes && params.nodes.length)
          openNode(params.nodes[0], kindOf[params.nodes[0]]);
      });
    }).catch(function (e) {
      info.textContent = "⚠ Impossible de charger le moteur de graphe (" + e.message +
        "). Vérifie ta connexion, ou réessaie.";
    });
  }

  // ---- injection de l'onglet + du panneau ----
  function injectTab() {
    var tabs = document.querySelector(".tabs");
    var main = document.querySelector("main");
    if (!tabs || !main) return false;
    if (document.getElementById("tab-graph")) { state.built = true; return true; }

    var tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.tab = "graph";
    tab.textContent = "🕸️ Graphe";
    tabs.appendChild(tab);

    var dimOpts = function (sel) {
      return Object.keys(DIMS).map(function (k) {
        return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" +
          DIMS[k].label + "</option>";
      }).join("");
    };

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "tab-graph";
    panel.style.display = "none";
    panel.innerHTML =
      '<h2 style="margin-bottom:6px">🕸️ Graphe pondéré</h2>' +
      '<p class="count" style="margin-bottom:12px">Chaque nœud est une entité ; ' +
      'un lien A ➜ B = nombre d\'articles reliant la valeur de départ à celle d\'arrivée ' +
      '(flèche = sens, épaisseur = poids). Clique un nœud pour ouvrir sa fiche. ' +
      'Molette = zoom, glisser = déplacer.</p>' +
      '<div class="chartctl" style="margin-bottom:12px;align-items:flex-end">' +
        '<div><label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:5px">Nœud de départ</label>' +
          '<select id="graphSrc">' + dimOpts(state.src) + "</select></div>" +
        '<div style="align-self:center;padding-bottom:8px;color:var(--accent);font-size:1.3rem">➜</div>' +
        '<div><label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:5px">Nœud d\'arrivée</label>' +
          '<select id="graphTgt">' + dimOpts(state.tgt) + "</select></div>" +
        '<div><label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:5px">Top N / côté</label>' +
          '<select id="graphTop">' +
            [15, 20, 30, 40, 50].map(function (n) {
              return '<option value="' + n + '"' + (n === state.topN ? " selected" : "") + ">" + n + "</option>";
            }).join("") + "</select></div>" +
        '<div><button class="go" id="graphBtn">▶ Générer</button></div>' +
        '<div><button id="graphSwap" title="Inverser départ et arrivée">⇄ Inverser</button></div>' +
      "</div>" +
      '<div class="count" id="graphInfo" style="margin-bottom:8px">Choisis tes dimensions puis clique sur <b>&nbsp;Générer&nbsp;</b></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
        '<span class="count"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + COLORS.source + ';vertical-align:middle"></span> départ seul</span>' +
        '<span class="count"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + COLORS.target + ';vertical-align:middle"></span> arrivée seule</span>' +
        '<span class="count"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + COLORS.both + ';vertical-align:middle"></span> les deux</span>' +
      "</div>" +
      '<div id="graphCanvas" style="height:620px;background:#0b1018;border:1px solid var(--border);border-radius:10px"></div>';
    main.appendChild(panel);

    panel.querySelector("#graphSrc").addEventListener("change", function () { state.src = this.value; });
    panel.querySelector("#graphTgt").addEventListener("change", function () { state.tgt = this.value; });
    panel.querySelector("#graphTop").addEventListener("change", function () { state.topN = +this.value; });
    panel.querySelector("#graphBtn").addEventListener("click", render);
    panel.querySelector("#graphSwap").addEventListener("click", function () {
      var s = state.src; state.src = state.tgt; state.tgt = s;
      panel.querySelector("#graphSrc").value = state.src;
      panel.querySelector("#graphTgt").value = state.tgt;
      render();
    });

    // onglet Graphe : montrer le graphe / masquer les autres panneaux
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      tab.classList.add("active");
      ["explore", "charts", "carto"].forEach(function (k) {
        var el = document.getElementById("tab-" + k); if (el) el.style.display = "none";
      });
      panel.style.display = "";
    });
    // clic sur un AUTRE onglet : masquer le graphe
    document.querySelectorAll(".tab").forEach(function (t) {
      if (t.dataset.tab !== "graph")
        t.addEventListener("click", function () {
          panel.style.display = "none";
          tab.classList.remove("active");
        });
    });

    state.built = true;
    return true;
  }

  ready(function () { injectTab(); });
})();
