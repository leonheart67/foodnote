#!/usr/bin/env python3
"""Import CIQUAL XML vers /data/ciqual_data.json et /data/off.db.

Entrées attendues (dans DATA_DIR=/data, /data ou le dossier courant) :
- alim.xml  : liste des aliments
- compo.xml : compositions nutritionnelles
- grp.xml   : groupes alimentaires (optionnel)
- const.xml : constituants/nutriments (optionnel, améliore la détection des codes)

Le script est volontairement tolérant pour accepter les noms officiels ANSES
renommés en alim.xml / compo.xml / grp.xml.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data'))
APP_DIR = Path('/app')
CWD = Path.cwd()


def local(tag: str) -> str:
    return str(tag).split('}', 1)[-1].lower()


def text(v):
    if v is None:
        return ''
    return str(v).strip()


def pick(d, *keys):
    low = {k.lower(): v for k, v in d.items()}
    for key in keys:
        if key.lower() in low and text(low[key.lower()]):
            return text(low[key.lower()])
    # fallback suffix match
    for key in keys:
        kl = key.lower()
        for k, v in low.items():
            if k.endswith(kl) and text(v):
                return text(v)
    return ''


def parse_number(raw):
    s = text(raw).replace('\xa0', ' ').replace(',', '.')
    if not s or s in {'-', '—', 'NA', 'NaN'}:
        return None
    is_less = s.lstrip().startswith('<')
    m = re.search(r'-?\d+(?:\.\d+)?', s)
    if not m:
        # traces, non quantifié
        if 'trace' in s.lower():
            return 0.0
        return None
    val = float(m.group(0))
    if is_less:
        val = val / 2.0
    return round(val, 4)


def find_file(names):
    candidates = []
    for base in (DATA_DIR, CWD, APP_DIR):
        for name in names:
            candidates.append(base / name)
    for p in candidates:
        if p.exists() and p.is_file() and p.stat().st_size > 0:
            return p
    return None


def flatten_direct(el):
    out = {}
    for k, v in el.attrib.items():
        out[local(k)] = text(v)
    for child in list(el):
        tag = local(child.tag)
        if len(list(child)) == 0:
            out[tag] = text(child.text)
        else:
            # récupère aussi les petits-enfants sous préfixe si besoin
            for sub in list(child):
                if len(list(sub)) == 0:
                    out[f'{tag}_{local(sub.tag)}'] = text(sub.text)
    return out


ROW_HINTS = {
    'alim', 'aliment', 'food', 'compo', 'composition', 'grp', 'groupe', 'group', 'const', 'constituant', 'nutrient'
}

def looks_like_row(tag, d):
    if tag in ROW_HINTS:
        return True
    keys = set(d.keys())
    return bool(
        {'alim_code', 'const_code'} <= keys
        or 'alim_nom_fr' in keys
        or 'alim_grp_nom_fr' in keys
        or 'const_nom_fr' in keys
    )

def iter_rows(xml_file):
    # Important : on ne clear pas les feuilles avant que leur parent ligne soit traité,
    # sinon le texte des champs disparaît. On clear uniquement les éléments qui ressemblent
    # à des lignes de table.
    for event, el in ET.iterparse(str(xml_file), events=('end',)):
        if len(list(el)):
            tag = local(el.tag)
            d = flatten_direct(el)
            if d and looks_like_row(tag, d):
                yield tag, d
                el.clear()


def load_groups(xml_file):
    groups = {}
    if not xml_file:
        return groups
    for tag, d in iter_rows(xml_file):
        code = pick(d, 'alim_grp_code', 'grp_code', 'code', 'id')
        name = pick(d, 'alim_grp_nom_fr', 'grp_nom_fr', 'nom_fr', 'name_fr', 'label', 'nom')
        if code and name:
            groups[code] = name
    return groups


def normalize_const_label(name, unit=''):
    n = (text(name) + ' ' + text(unit)).lower()
    n = n.replace('é', 'e').replace('è', 'e').replace('ê', 'e').replace('ë', 'e')
    n = n.replace('à', 'a').replace('â', 'a').replace('î', 'i').replace('ï', 'i')
    n = n.replace('ô', 'o').replace('ù', 'u').replace('û', 'u').replace('ç', 'c')
    n = re.sub(r'\s+', ' ', n)
    return n.strip()


def infer_foodnote_key_from_const(name, unit=''):
    """Déduit la clé FoodNote depuis le libellé officiel const.xml.

    On privilégie const.xml plutôt que des codes numériques figés, car les codes
    peuvent varier selon les versions et certains codes historiques sont piégeux
    (ex: 400 = eau dans les tables récentes, pas protéines).
    """
    n = normalize_const_label(name, unit)
    if not n:
        return None
    is_g100 = ('g/100' in n) or ('g / 100' in n) or ('g pour 100' in n)
    has_kj = bool(re.search(r'\bkj\b', n))
    has_kcal = bool(re.search(r'\bkcal\b', n))

    # Energie : on ne garde que les kcal. Les libellés kJ ne doivent jamais
    # alimenter kcal100, sinon on obtient des valeurs type 1340 kcal/100g.
    if 'energie' in n and has_kcal and not has_kj:
        return 'kcal100'

    # Macro-nutriments. Exclusions explicites pour éviter les sous-composants.
    if is_g100 and 'proteine' in n and 'acide amine' not in n and 'azote' not in n:
        return 'prot100'
    if is_g100 and 'glucide' in n and all(x not in n for x in ('sucre', 'amidon', 'polyol', 'lactose', 'glucose', 'fructose', 'saccharose', 'maltose')):
        return 'gluc100'
    if is_g100 and ('lipide' in n or 'matiere grasse' in n) and all(x not in n for x in ('acide gras', 'cholesterol')):
        return 'lip100'
    if is_g100 and 'fibre' in n:
        return 'fibres100'
    if is_g100 and (re.search(r'\bsel\b', n) or 'chlorure de sodium' in n):
        return 'sel100'
    return None


def load_const_map(xml_file):
    """Retourne code constituant -> clé FoodNote selon le libellé si const.xml est présent."""
    out = {}
    if not xml_file:
        return out
    for tag, d in iter_rows(xml_file):
        code = pick(d, 'const_code', 'code', 'id')
        name = pick(d, 'const_nom_fr', 'const_name_fr', 'nom_fr', 'name_fr', 'label', 'nom')
        unit = pick(d, 'const_unite', 'unit', 'unite')
        key = infer_foodnote_key_from_const(name, unit)
        if code and key:
            out[code] = key
    return out


# Codes CIQUAL historiques utilisables uniquement en secours.
# IMPORTANT : dans les tables récentes, le code 400 correspond à l'eau (g/100g).
# Il ne doit surtout pas être interprété comme des protéines, sinon des aliments
# très aqueux comme la tomate remontent avec 90+ g de protéines.
FALLBACK_CODE_MAP = {
    # Secours ultra limité si const.xml est absent. 328 est documenté comme
    # Energie UE en kcal/100g dans les docs XML historiques. Les autres codes
    # énergie peuvent être du kJ selon les versions, donc on ne les mappe pas.
    '328': 'kcal100',
    # Pas de fallback protéines/glucides/lipides ici : const.xml est la source fiable.
}


def load_foods(alim_file, groups):
    foods = {}
    for tag, d in iter_rows(alim_file):
        code = pick(d, 'alim_code', 'code', 'id')
        name = pick(d, 'alim_nom_fr', 'nom_fr', 'alim_name_fr', 'name_fr', 'alim_nom_eng', 'nom')
        if not code or not name:
            continue
        grp_code = pick(d, 'alim_grp_code', 'grp_code', 'group_code')
        foods[code] = {
            'code': code,
            'nom': name,
            'groupe': groups.get(grp_code, grp_code or ''),
            'kcal100': None,
            'prot100': None,
            'gluc100': None,
            'lip100': None,
            'fibres100': None,
            'sel100': None,
            'source': 'ciq'
        }
    return foods


def apply_compo(compo_file, foods, code_map):
    for tag, d in iter_rows(compo_file):
        alim_code = pick(d, 'alim_code', 'code_alim', 'food_code')
        const_code = pick(d, 'const_code', 'code_const', 'nutrient_code')
        if not alim_code or not const_code or alim_code not in foods:
            continue
        key = code_map.get(const_code)
        if not key:
            continue
        val = parse_number(pick(d, 'teneur', 'value', 'valeur', 't'))
        if val is None:
            continue
        # garde la première valeur utile si doublons
        if foods[alim_code].get(key) is None:
            foods[alim_code][key] = val


def foodnote_ciqual_norm_text(value):
    n = text(value).lower()
    n = n.replace('é', 'e').replace('è', 'e').replace('ê', 'e').replace('ë', 'e')
    n = n.replace('à', 'a').replace('â', 'a').replace('î', 'i').replace('ï', 'i')
    n = n.replace('ô', 'o').replace('ù', 'u').replace('û', 'u').replace('ç', 'c')
    return re.sub(r'[^a-z0-9]+', ' ', n).strip()


def foodnote_ciqual_allows_high_protein(f):
    t = foodnote_ciqual_norm_text((f.get('nom') or '') + ' ' + (f.get('groupe') or ''))
    high_terms = (
        'viande', 'boeuf', 'bœuf', 'porc', 'veau', 'agneau', 'poulet', 'dinde', 'canard', 'jambon', 'charcut',
        'poisson', 'thon', 'saumon', 'cabillaud', 'sardine', 'maquereau', 'crevette', 'crabe', 'moule', 'oeuf', 'œuf',
        'fromage', 'lait', 'yaourt', 'skyr', 'quark', 'soja', 'tofu', 'tempeh', 'seitan', 'proteine', 'whey',
        'lentille', 'pois chiche', 'haricot', 'feve', 'legumineuse', 'amande', 'noix', 'cacahuete', 'pistache', 'graine'
    )
    return any(x in t for x in high_terms)


def foodnote_plausible_clean(f):
    """Nettoie les valeurs manifestement incohérentes avant écriture.

    Exemples corrigés :
    - énergie kJ importée comme kcal (1340 kJ -> environ 320 kcal) ;
    - eau ou glucides importés comme protéines.
    """
    def num(v):
        try:
            if v is None or v == '':
                return 0.0
            x = float(v)
            return x if x == x else 0.0
        except Exception:
            return 0.0

    kcal = num(f.get('kcal100'))
    if kcal > 950:
        f['kcal100'] = round(kcal / 4.184)
        kcal = num(f.get('kcal100'))

    p = num(f.get('prot100'))
    g = num(f.get('gluc100'))
    l = num(f.get('lip100'))

    # Bornes physiques simples.
    for key in ('prot100', 'gluc100', 'lip100', 'fibres100'):
        v = num(f.get(key))
        if v < 0 or v > 100:
            f[key] = 0
    if num(f.get('sel100')) < 0 or num(f.get('sel100')) > 100:
        f['sel100'] = 0

    p = num(f.get('prot100'))
    g = num(f.get('gluc100'))
    l = num(f.get('lip100'))

    # Protéines aberrantes sur aliments non protéiques : pâtisseries/fruits/légumes
    # peuvent parfois recevoir l'eau ou les glucides à cause d'un mauvais mapping.
    high_protein_ok = foodnote_ciqual_allows_high_protein(f)
    if p > 35 and not high_protein_ok:
        divided = round(p / 10.0, 2)
        if kcal >= 120 and g >= 10 and l >= 1 and divided <= 8:
            f['prot100'] = divided
            p = divided
        else:
            f['prot100'] = 0
            p = 0

    # Si l'énergie issue des macros dépasse de très loin l'énergie CIQUAL, un champ
    # est probablement mal mappé.
    macro_kcal = p * 4 + g * 4 + l * 9
    too_much_energy = kcal > 0 and macro_kcal > max(kcal * 1.35 + 80, kcal + 160)
    if too_much_energy and p > 30 and not high_protein_ok:
        f['prot100'] = 0
        p = 0
        macro_kcal = g * 4 + l * 9
    if kcal > 0 and macro_kcal > max(kcal * 1.35 + 80, kcal + 160) and g > 90:
        f['gluc100'] = 0
        g = 0
        macro_kcal = p * 4 + l * 9
    if kcal > 0 and macro_kcal > max(kcal * 1.35 + 80, kcal + 160) and l > 70:
        f['lip100'] = 0

    return f


def clean_foods(foods):
    out = []
    for f in foods.values():
        for k in ('kcal100', 'prot100', 'gluc100', 'lip100', 'fibres100', 'sel100'):
            if f.get(k) is None:
                f[k] = 0
        f = foodnote_plausible_clean(f)
        # aliments sans aucune macro utile : on les garde uniquement si nom présent,
        # mais ils ne seront pas prioritaires dans la recherche.
        out.append(f)
    out.sort(key=lambda x: x['nom'].lower())
    return out


def write_sqlite(db_file, rows):
    db_file.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_file))
    cur = con.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS ciqual (
        code TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        groupe TEXT,
        kcal100 REAL DEFAULT 0,
        prot100 REAL DEFAULT 0,
        gluc100 REAL DEFAULT 0,
        lip100 REAL DEFAULT 0,
        fibres100 REAL DEFAULT 0,
        sel100 REAL DEFAULT 0
    )''')
    cur.execute('DELETE FROM ciqual')
    cur.executemany('''INSERT OR REPLACE INTO ciqual
        (code, nom, groupe, kcal100, prot100, gluc100, lip100, fibres100, sel100)
        VALUES (:code, :nom, :groupe, :kcal100, :prot100, :gluc100, :lip100, :fibres100, :sel100)''', rows)
    cur.execute('CREATE INDEX IF NOT EXISTS idx_ciqual_nom ON ciqual(nom)')
    con.commit()
    con.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=str(DATA_DIR))
    parser.add_argument('--json-out', default=None)
    parser.add_argument('--db-out', default=None)
    args = parser.parse_args()
    data_dir = Path(args.data_dir)
    globals()['DATA_DIR'] = data_dir

    alim = find_file(['alim.xml', 'alim_2025_11_03.xml'])
    compo = find_file(['compo.xml', 'compo_2025_11_03.xml'])
    grp = find_file(['grp.xml', 'alim_grp_2025_11_03.xml'])
    const = find_file(['const.xml', 'const_2025_11_03.xml'])
    if not alim or not compo:
        print('ERREUR: alim.xml et compo.xml sont requis dans /data ou /app.', file=sys.stderr)
        return 2

    print(f'[CIQUAL] alim={alim}')
    print(f'[CIQUAL] compo={compo}')
    if grp: print(f'[CIQUAL] grp={grp}')
    if const: print(f'[CIQUAL] const={const}')

    groups = load_groups(grp)
    const_map = load_const_map(const)
    if const_map:
        code_map = FALLBACK_CODE_MAP.copy()
        code_map.update(const_map)
        print(f'[CIQUAL] constituants détectés via const.xml: {len(const_map)}')
    else:
        # Pas de const.xml : on garde uniquement les anciens codes peu risqués.
        # Les protéines ne sont pas importées en fallback pour éviter le bug eau -> protéines.
        code_map = FALLBACK_CODE_MAP.copy()
        print('[CIQUAL] AVERTISSEMENT: const.xml absent ou illisible. Import en mode secours, protéines non déduites par code numérique.')
    foods = load_foods(alim, groups)
    print(f'[CIQUAL] aliments détectés: {len(foods)}')
    apply_compo(compo, foods, code_map)
    rows = clean_foods(foods)

    json_out = Path(args.json_out) if args.json_out else data_dir / 'ciqual_data.json'
    db_out = Path(args.db_out) if args.db_out else data_dir / 'off.db'
    json_out.parent.mkdir(parents=True, exist_ok=True)
    with open(json_out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
    write_sqlite(db_out, rows)
    print(f'[CIQUAL] JSON écrit: {json_out} ({len(rows)} aliments)')
    print(f'[CIQUAL] SQLite mis à jour: {db_out} table ciqual')
    print('[CIQUAL] Source: Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025. https://doi.org/10.57745/RDMHWY')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
