# Guide d'installation — World Monitor autonome

Ton site de données qui se met à jour tout seul, toutes les 6 heures, sans
serveur et gratuitement. Temps d'installation : **20 à 30 minutes**, aucune
ligne de code à écrire. Tout se fait dans le navigateur.

## Comment ça marche (en 30 secondes)

GitHub héberge tes fichiers et ton site (gratuit). Toutes les 6 h, un robot
GitHub (« Action ») exécute la chaîne : il télécharge le catalogue de flux du
projet open source World Monitor → lit les flux RSS → classe chaque nouvel
article (pays, thème, fiabilité, score naval) avec TES dictionnaires → met à
jour le site et les fichiers CSV/XLSX/DB. Toi, tu n'as plus qu'à éditer tes
dictionnaires quand tu veux affiner.

## Étape 1 — Créer un compte GitHub (5 min)

1. Va sur <https://github.com/signup> ;
2. e-mail, mot de passe, nom d'utilisateur → compte gratuit classique.

## Étape 2 — Créer le dépôt (2 min)

1. En haut à droite : bouton **+** → **New repository** ;
2. Nom : `world-monitor` (ou ce que tu veux) ;
3. Visibilité : **Public** (obligatoire pour GitHub Pages gratuit) ;
4. Ne coche rien d'autre → **Create repository**.

## Étape 3 — Déposer les fichiers du kit (5 min)

1. Sur la page du dépôt : **uploading an existing file** (lien dans le texte
   d'accueil), ou **Add file → Upload files** ;
2. Glisse TOUT le contenu du dossier `kit/` : les dossiers `pipeline/` et
   `docs/`, plus `requirements.txt` et ce `GUIDE.md`.
   ⚠️ Glisse les dossiers eux-mêmes, l'arborescence doit être conservée ;
3. En bas : **Commit changes**.

Le fichier du robot (`.github/workflows/update.yml`) commence par un point,
certains systèmes le cachent — si l'upload ne l'a pas pris :

1. **Add file → Create new file** ;
2. Nom du fichier : tape exactement `.github/workflows/update.yml`
   (les `/` créent les dossiers automatiquement) ;
3. Colle dedans le contenu du fichier `update.yml` du kit → **Commit**.

## Étape 4 — Autoriser le robot à écrire (1 min)

1. Dans le dépôt : **Settings → Actions → General** ;
2. Section « Workflow permissions » : coche **Read and write permissions**
   → **Save**.

## Étape 5 — Activer le site (2 min)

1. **Settings → Pages** ;
2. « Source » : **Deploy from a branch** ;
3. Branche : **main**, dossier : **/docs** → **Save** ;
4. Après ~2 minutes, l'adresse de ton site s'affiche en haut :
   `https://TON-PSEUDO.github.io/world-monitor/` — accessible par tous.

## Étape 6 — Premier lancement du robot (2 min)

1. Onglet **Actions** du dépôt → « Mise à jour World Monitor » ;
2. Bouton **Run workflow** → confirme ;
3. Regarde-le tourner (~2-4 min). S'il finit avec une coche verte ✓, c'est
   gagné : il tournera ensuite tout seul toutes les 6 heures.

## La vie d'après : ton vrai travail d'éditeur

Tout se passe dans `pipeline/`, éditable en ligne (ouvre le fichier sur
GitHub → icône crayon ✏️ → modifie → **Commit changes**) :

| Fichier | Rôle | Exemple de modification |
|---|---|---|
| `themes.txt` | mots-clés des thèmes (`*` = mot fort) | ajouter `mpox` à Santé |
| `pays.txt` | alias des pays (villes, dirigeants…) | ajouter un nouveau ministre |
| `regles.txt` | règles de contexte (`mot1 + mot2 + !exclu`, `@pays`) | `Guerre/violence: @pays + drone swarm` |
| `naval.txt` | barème naval (`poids: mots`) | ajouter `dreadnought` à 20 |
| `medias.csv` | fiche de chaque source : siège, thème, note, **indice de fiabilité** | noter une nouvelle source de 1 à 5 |

Les nouvelles sources inconnues apparaissent avec fiabilité 5 (défaut
prudent) : pense à les noter dans `medias.csv` de temps en temps.

Pour mesurer l'effet de tes changements sur les 5 499 articles de référence
(sur ton ordinateur, si Python est installé) :
`python3 pipeline/evaluer.py world_monitor_consolide_3.xlsx`

## Si quelque chose casse

- Onglet **Actions** → clique sur l'exécution rouge ✗ → le journal dit ce qui
  a échoué (le plus souvent : une faute de frappe dans un fichier édité) ;
- Chaque fichier a un historique : bouton **History** → tu peux revenir à la
  version d'avant en un clic ;
- Le robot ne tourne plus ? GitHub suspend les plannings après 60 jours sans
  activité sur le dépôt : un simple commit (ou Run workflow manuel) le relance.
