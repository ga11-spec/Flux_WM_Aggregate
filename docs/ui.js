/* ============================================================================
   World Monitor — Uniformisation de l'interface (ui.js)
   ---------------------------------------------------------------------------
   Fichier autonome à déposer dans `docs/`, à côté de index.html.
   Une seule ligne à ajouter dans index.html, juste avant </body> :
        <script src="ui.js"></script>

   Met l'onglet « Graphiques croisés » au même style que Cartographie et
   Graphe : un titre en haut + les menus (options) sur fond bleu sombre du
   thème, au lieu du fond blanc/gris actuel. La carte du graphique elle-même
   reste sur sa carte blanche (le rendu du canvas est prévu pour un fond clair).
   ========================================================================== */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    // 1) thème sombre pour l'onglet + les options (comme carto / graphe)
    if (!document.getElementById("wm-charts-style")) {
      var st = document.createElement("style");
      st.id = "wm-charts-style";
      st.textContent =
        "#tab-charts{background:var(--panel2);border-color:var(--border)}" +
        "#tab-charts .chartctl label{color:var(--muted)}" +
        "#tab-charts select{background:var(--panel);color:var(--text);border-color:var(--border)}" +
        "#tab-charts select:focus{outline:2px solid var(--accent)}" +
        "#tab-charts .hint{color:var(--muted)}";
      document.head.appendChild(st);
    }

    // 2) titre + intro en haut de l'onglet (comme carto / graphe)
    var panel = document.getElementById("tab-charts");
    if (panel && !document.getElementById("wm-charts-title")) {
      var intro = document.createElement("p");
      intro.className = "count";
      intro.style.marginBottom = "14px";
      intro.innerHTML = "Compose un graphique à partir de la sélection courante de l'onglet " +
        "<b>Explorer</b> : choisis une dimension, une mesure, un type, puis <b>Créer le graphique</b>.";

      var h = document.createElement("h2");
      h.id = "wm-charts-title";
      h.style.marginBottom = "6px";
      h.textContent = "📊 Graphiques croisés";

      panel.insertBefore(intro, panel.firstChild);
      panel.insertBefore(h, panel.firstChild);
    }
  });
})();
