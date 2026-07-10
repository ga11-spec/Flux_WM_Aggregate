#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Classificateur World Monitor — thèmes, pays, région, enrichissement média.
Aucune dépendance externe (bibliothèque standard Python uniquement).

Usage :
    python3 classify.py logs.csv -o consolide.csv
logs.csv attendu (séparateur ;) : media;titre;lien;date
Les dictionnaires themes.txt / pays.txt / medias.csv / regions.json
doivent être dans le même dossier.
"""
import re, csv, json, sys, argparse, unicodedata
from pathlib import Path

HERE = Path(__file__).parent

# ---------------------------------------------------------------- dictionnaires
def load_dict(path):
    """Lit un fichier 'Classe: mot1, *motfort, …' → liste (classe, [(mot, poids)])."""
    out = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        cls, kws = line.split(":", 1)
        entries = []
        for kw in kws.split(","):
            kw = kw.strip().lower()
            if not kw:
                continue
            weight = 2 if kw.startswith("*") else 1
            entries.append((kw.lstrip("*"), weight))
        out.append((cls.strip(), entries))
    return out

def compile_dict(d):
    """Pré-compile chaque mot-clé en regex avec frontières de mots."""
    comp = []
    for cls, entries in d:
        pats = [(re.compile(r"(?<![\w’'])" + re.escape(kw) + r"(?![\w])"), w)
                for kw, w in entries]
        comp.append((cls, pats))
    return comp

def _kw_regex(kw):
    return r"(?<![\w’'])" + re.escape(kw) + r"(?![\w])"

def load_rules(path, pays_dict):
    """Règles de contexte : 'Thème: mot1|variante + mot2 + !exclu'.
    @pays = n'importe quel pays (mots forts du dictionnaire pays).
    '@pays + @pays' exige DEUX pays différents dans le titre.
    Dans une alternative mixte ('@pays|meeting'), @pays compte comme
    'un pays supplémentaire distinct'.
    Toutes les parties reliées par + doivent être présentes ; ! exclut.
    Règles prioritaires sur le score par mots-clés, première gagnante."""
    if not Path(path).exists():
        return None
    # une regex par pays (mots forts), pour compter les pays distincts
    country_pats = []
    for cls, entries in pays_dict:
        strong = [kw for kw, w in entries if w == 2]
        if strong:
            country_pats.append(re.compile("|".join(_kw_regex(k) for k in strong)))
    rules = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        cls, expr = line.split(":", 1)
        pos, neg, needed_pays = [], [], 0
        for term in expr.split("+"):
            term = term.strip().lower()
            if not term:
                continue
            negate = term.startswith("!")
            term = term.lstrip("!").strip()
            alts = [a.strip() for a in term.split("|") if a.strip()]
            has_pays = "@pays" in alts
            words = [a for a in alts if a != "@pays"]
            pat = re.compile("|".join(_kw_regex(a) for a in words)) if words else None
            if negate:
                if pat:
                    neg.append(pat)
            elif has_pays and not words:
                needed_pays += 1                  # '@pays' seul : +1 pays requis
            else:
                pos.append((has_pays, pat))       # mots, ou mixte '@pays|mots'
        rules.append((cls.strip(), pos, neg, needed_pays))
    return {"rules": rules, "country_pats": country_pats}

def apply_rules(title, ruleset):
    t = norm(title)
    distinct = sum(1 for p in ruleset["country_pats"] if p.search(t))
    for cls, pos, neg, needed in ruleset["rules"]:
        if distinct < needed:
            continue
        if any(n.search(t) for n in neg):
            continue
        ok = True
        for has_pays, pat in pos:
            hit = bool(pat and pat.search(t))
            if has_pays:                          # mixte : mots OU un pays de plus
                hit = hit or distinct >= needed + 1
            if not hit:
                ok = False
                break
        if ok:
            return cls
    return None

# ---------------------------------------------------------------- classification
def norm(s):
    return unicodedata.normalize("NFKD", str(s)).lower()

def score(title, comp):
    """[(classe, score)] trié par score, puis par position du 1er mot trouvé
    dans le titre (le plus tôt gagne), puis par ordre du fichier."""
    t = norm(title)
    res = []
    for idx, (cls, pats) in enumerate(comp):
        s, first = 0, 10**9
        for p, w in pats:
            m = p.search(t)
            if m:
                s += w
                first = min(first, m.start())
        if s:
            res.append((s, -first, -idx, cls))
    res.sort(reverse=True)
    return [(cls, s) for s, _, _, cls in res]

def classify_theme(title, comp, rules=None):
    if rules:
        hit = apply_rules(title, rules)
        if hit:
            return hit
    r = score(title, comp)
    return r[0][0] if r else "Non déterminé"

def classify_pays(title, comp, media_info=None):
    """media_info = (pays_siege, theme_media) : repli quand le titre est muet,
    pour les médias locaux / politiques / gouvernementaux (.gov)."""
    r = score(title, comp)
    if r and r[0][1] >= 2:
        conf = "high" if r[0][1] >= 3 else "medium"
        return r[0][0], conf
    if media_info:
        ch, sm = media_info
        if sm in ("Local/Régional", "Politique"):
            if ch:
                return ch, "media-default"
    # un mot faible seul ne décide jamais (trop de faux positifs)
    return "Undetermined", "none"

def load_naval(path):
    """Barème naval : lignes 'poids: mot1, mot2, …' → [(regex, poids)]."""
    if not Path(path).exists():
        return []
    pats = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        w, kws = line.split(":", 1)
        try:
            w = int(w.strip())
        except ValueError:
            continue
        for kw in kws.split(","):
            kw = kw.strip().lower()
            if kw:
                pats.append((re.compile(_kw_regex(kw)), w))
    return pats

def score_naval(title, naval_pats, cap=40):
    """Somme des poids des mots trouvés, plafonnée (défaut 40)."""
    t = norm(title)
    return min(cap, sum(w for p, w in naval_pats if p.search(t)))

# repli : si le titre ne permet pas de classer, le thème du média décide
THEME_FALLBACK = {
    "Tech": "Tech",
    "Business": "Markets and business",
    "Sports": "Sports",
    "Tensions/guerre/violences/géopolitique": "Guerre/violence",
    "Politique américaine": "Politique américaine",
}

# ---------------------------------------------------------------- pipeline
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", help="CSV d'entrée : media;titre;lien;date")
    ap.add_argument("-o", "--out", default="consolide.csv")
    args = ap.parse_args()

    themes = compile_dict(load_dict(HERE / "themes.txt"))
    pays_raw = load_dict(HERE / "pays.txt")
    pays = compile_dict(pays_raw)
    rules = load_rules(HERE / "regles.txt", pays_raw)
    naval = load_naval(HERE / "naval.txt")
    regions = json.loads((HERE / "regions.json").read_text(encoding="utf-8"))
    medias = {}
    with open(HERE / "medias.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            medias[row["media"].strip().lower()] = row

    n_in = n_theme = n_pays = 0
    with open(args.logs, encoding="utf-8") as fin, \
         open(args.out, "w", encoding="utf-8", newline="") as fout:
        r = csv.DictReader(fin, delimiter=";")
        w = csv.writer(fout, delimiter=";")
        w.writerow(["nom_du_media", "titre", "lien", "time_stamp",
                    "country_headquarters", "country_article", "region",
                    "sujet_article", "sujet_media", "official_rating",
                    "indice_fiabilite", "fiabilité_calcul",
                    "indice_interet_naval", "fiabilité2",
                    "intérêt marine calcul", "intérêt_par_fiabilité",
                    "confiance_pays_article"])
        for row in r:
            n_in += 1
            titre = row.get("titre", "")
            media = row.get("media", "").strip()
            m = medias.get(media.lower(), {})
            gov = ".gov" in media.lower()
            minfo = (m.get("pays_siege", ""),
                     "Politique" if gov else m.get("theme_media", ""))
            th = classify_theme(titre, themes, rules)
            if th == "Non déterminé":
                th = THEME_FALLBACK.get(m.get("theme_media", ""), "Non déterminé")
            ca, conf = classify_pays(titre, pays, minfo)
            rg = regions.get(ca, "Undetermined")
            if th != "Non déterminé": n_theme += 1
            if ca != "Undetermined": n_pays += 1
            # indices fiabilité / naval
            try:
                fia = int(m.get("indice_fiabilite") or 5)
            except ValueError:
                fia = 5
            nav = score_naval(titre, naval)
            fia_calc = round(40 / fia, 4)
            fia2 = round(0.6 / fia, 4)
            marine = round(nav * 0.4 / 40, 4)
            composite = round(fia2 + marine, 4)
            w.writerow([media, titre, row.get("lien", ""), row.get("date", ""),
                        m.get("pays_siege", "Undetermined"), ca, rg, th,
                        m.get("theme_media", ""), m.get("note", ""),
                        fia, fia_calc, nav, fia2, marine, composite, conf])

    print(f"{n_in} articles | thème déterminé : {n_theme} ({n_theme/max(n_in,1):.0%})"
          f" | pays déterminé : {n_pays} ({n_pays/max(n_in,1):.0%})")
    print(f"→ {args.out}")

if __name__ == "__main__":
    main()
