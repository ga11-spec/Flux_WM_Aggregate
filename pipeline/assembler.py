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
        "intérêt_par_fiabilité", "confiance_pays_article"]


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def write_master(rows):
    with open(MASTER, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, delimiter=";")
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
                     "cf": r["confiance_pays_article"]})
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
                    [[r[c] for c in COLS] for r in rows])
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
            ws.append([num(r[c]) if num(r[c]) is not None and
                       c in ("official_rating", "indice_fiabilite",
                             "fiabilité_calcul", "indice_interet_naval",
                             "fiabilité2", "intérêt marine calcul",
                             "intérêt_par_fiabilité") else r[c] for c in COLS])
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
    liens = {r["lien"] for r in rows}
    print(f"historique : {len(rows)} articles")

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
