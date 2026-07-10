#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assembleur — enchaîne tout le pipeline :
 1. classifie les nouveaux logs (logs.csv, produits par collecteur.py) ;
 2. les fusionne dans l'historique consolide_master.csv (dédoublonnage par lien) ;
 3. régénère les fichiers du site : site/data.js, site/world_monitor.csv,
    site/world_monitor.xlsx, site/world_monitor.db.

Usage :
    python3 assembler.py            # logs.csv → master → site/
    python3 assembler.py --no-logs  # régénère seulement le site depuis le master
"""
import csv, json, sys, os, sqlite3, argparse, subprocess, tempfile
from pathlib import Path

HERE = Path(__file__).parent
MASTER = HERE / "consolide_master.csv"
SITE = HERE.parent / "docs"   # dossier servi par GitHub Pages

COLS = ["nom_du_media", "titre", "lien", "time_stamp", "country_headquarters",
        "country_article", "region", "sujet_article", "sujet_media",
        "official_rating", "indice_fiabilite", "fiabilité_calcul",
        "indice_interet_naval", "fiabilité2", "intérêt marine calcul",
        "intérêt_par_fiabilité", "confiance_pays_article", "langue", "titre_vo"]


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def write_master(rows):
    with open(MASTER, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, delimiter=";",
                           restval="", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def num(v):
    try:
        f = float(str(v).replace(",", "."))
        return int(f) if f == int(f) else round(f, 4)
    except (ValueError, TypeError):
        return None


def build_site(rows, added=0):
    SITE.mkdir(exist_ok=True)
    # --- meta.json (horodatage affiché par le bouton Actualiser) ---
    import datetime
    (SITE / "meta.json").write_text(json.dumps({
        "generated": datetime.datetime.now(datetime.timezone.utc)
                     .strftime("%d/%m/%Y %H:%M UTC"),
        "count": len(rows), "added": added}, ensure_ascii=False),
        encoding="utf-8")
    # --- data.js (données du site) ---
    recs = []
    for r in rows:
        recs.append({"m": r["nom_du_media"], "t": r["titre"], "l": r["lien"],
                     "d": (r["time_stamp"] or "")[:16],
                     "ch": r["country_headquarters"], "ca": r["country_article"],
                     "rg": r["region"], "sa": r["sujet_article"],
                     "sm": r["sujet_media"], "or": num(r["official_rating"]),
                     "fi": num(r["indice_fiabilite"]),
                     "nv": num(r["indice_interet_naval"]) or 0,
                     "ip": num(r["intérêt_par_fiabilité"]),
                     "cf": r["confiance_pays_article"],
                     "lg": r.get("langue") or "en",
                     "tv": r.get("titre_vo") or ""})
    js = "window.DATA_WM=" + json.dumps(
        recs, ensure_ascii=False, separators=(",", ":")).replace(
        "</script", "<\\/script") + ";"
    (SITE / "data.js").write_text(js, encoding="utf-8")

    # --- CSV téléchargeable ---
    with open(SITE / "world_monitor.csv", "w", encoding="utf-8-sig",
              newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, delimiter=";")
        w.writeheader()
        w.writerows(rows)

    # --- SQLite ---
    db = SITE / "world_monitor.db"
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE articles (%s)" %
                ", ".join(f'"{c}"' for c in COLS))
    con.executemany("INSERT INTO articles VALUES (%s)" %
                    ",".join("?" * len(COLS)),
                    [[r.get(c,"") for c in COLS] for r in rows])
    con.commit()
    con.close()

    # --- XLSX (si openpyxl est disponible) ---
    try:
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Articles"
        ws.append(COLS)
        for r in rows:
            ws.append([num(r.get(c)) if num(r.get(c)) is not None and
                       c in ("official_rating", "indice_fiabilite",
                             "fiabilité_calcul", "indice_interet_naval",
                             "fiabilité2", "intérêt marine calcul",
                             "intérêt_par_fiabilité") else r.get(c,"") for c in COLS])
        wb.save(SITE / "world_monitor.xlsx")
    except ImportError:
        print("(openpyxl absent : export XLSX sauté)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logs", default=str(HERE / "logs.csv"))
    ap.add_argument("--no-logs", action="store_true",
                    help="ne pas classifier, juste régénérer le site")
    args = ap.parse_args()

    rows = read_csv(MASTER) if MASTER.exists() else []
    print(f"historique : {len(rows)} articles")

    # ---- migration rétroactive (idempotente, à chaque passage) ----
    sys.path.insert(0, str(HERE))
    import classify
    alias = classify.load_alias(HERE / "medias_alias.csv")
    bans = classify.load_bans(HERE / "medias_bannis.txt")
    import traduction
    med_langues = traduction.load_medias_langues()
    medias = {}
    with open(HERE / "medias.csv", encoding="utf-8") as f:
        for m in csv.DictReader(f, delimiter=";"):
            medias[m["media"].strip().lower()] = m
    propres, n_ban, n_trad, n_dates, n_fusion = [], 0, 0, 0, 0
    for r in rows:
        if classify.est_banni(r["nom_du_media"], bans):
            n_ban += 1
            continue
        # traduction rétroactive des titres non anglais encore en VO
        if not r.get("langue"):
            t, vo, lang = traduction.ensure_english(
                r["titre"], r["nom_du_media"], med_langues)
            r["langue"] = lang
            if vo:
                n_trad += 1
                r["titre"], r["titre_vo"] = t, vo
            else:
                r.setdefault("titre_vo", "")
        d2 = classify.norm_date(r["time_stamp"])
        if d2 != r["time_stamp"]:
            n_dates += 1
            r["time_stamp"] = d2
        can = classify.canonical_media(r["nom_du_media"], alias)
        if can != r["nom_du_media"]:
            n_fusion += 1
            r["nom_du_media"] = can
            m = medias.get(can.lower())
            if m:  # hérite de la fiche du média canonique + recalcul fiabilité
                r["country_headquarters"] = m["pays_siege"] or r["country_headquarters"]
                r["sujet_media"] = m["theme_media"] or r["sujet_media"]
                r["official_rating"] = m["note"] or r["official_rating"]
                try:
                    fi = int(m["indice_fiabilite"] or 5)
                except ValueError:
                    fi = 5
                nv = num(r["indice_interet_naval"]) or 0
                r["indice_fiabilite"] = fi
                r["fiabilité_calcul"] = round(40 / fi, 4)
                r["fiabilité2"] = round(0.6 / fi, 4)
                r["intérêt marine calcul"] = round(nv * 0.4 / 40, 4)
                r["intérêt_par_fiabilité"] = round(0.6 / fi + nv * 0.4 / 40, 4)
        propres.append(r)
    if n_ban or n_trad or n_dates or n_fusion:
        print(f"migration : {n_trad} titres traduits en anglais, {n_ban} doublons"
              f" retirés, {n_dates} dates normalisées, {n_fusion} articles"
              f" rattachés à leur média canonique")
        rows = propres
        write_master(rows)
    rows = propres
    liens = {r["lien"] for r in rows}

    ajout = 0
    if not args.no_logs and Path(args.logs).exists():
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            out = tmp.name
        subprocess.run([sys.executable, str(HERE / "classify.py"),
                        args.logs, "-o", out], check=True)
        for r in read_csv(out):
            if r["lien"] and r["lien"] not in liens:
                liens.add(r["lien"])
                rows.append(r)
                ajout += 1
        os.unlink(out)
        print(f"+ {ajout} nouveaux articles classifiés")
        write_master(rows)
        # les logs intégrés sont archivés puis vidés
        Path(args.logs).rename(str(args.logs) + ".integres")

    rows.sort(key=lambda r: r["time_stamp"] or "", reverse=True)
    build_site(rows, ajout)
    print(f"site régénéré ({len(rows)} articles) → {SITE}/")


if __name__ == "__main__":
    main()
