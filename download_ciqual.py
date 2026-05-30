#!/usr/bin/env python3
"""Télécharge les XML officiels ANSES CIQUAL 2025 dans /data.

Les fichiers sont publiés sur Recherche Data Gouv sous Licence Ouverte Etalab 2.0.
Citation recommandée :
Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025. https://doi.org/10.57745/RDMHWY
"""
import argparse
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

FILES = [
    ('alim.xml',    'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/OH8KXC', '8e1171d63cee4b6010cfce25dd29243d'),
    ('grp.xml',     'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/FMNIUZ', 'c31aeea90349c3aab86f98ef5f4f10da'),
    ('compo.xml',   'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/O73GDX', '2da725585946434df320d8041631998b'),
    ('const.xml',   'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/FWSPCX', 'd8f2f25fdacb887bc993a6eeaf80f203'),
    ('sources.xml', 'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/3MVEOJ', '5469598d6b4811672b65e1644dfc6485'),
]


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'FoodNote-CIQUAL/0.22.179'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', default=os.environ.get('DATA_DIR', '/data'))
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    for name, url, expected_md5 in FILES:
        out = dest / name
        if out.exists() and out.stat().st_size > 0 and not args.force:
            print(f'[CIQUAL] {name} déjà présent')
            continue
        tmp = out.with_suffix(out.suffix + '.tmp')
        print(f'[CIQUAL] téléchargement {name}...')
        download(url, tmp)
        if expected_md5:
            got = md5(tmp)
            if got != expected_md5:
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f'MD5 invalide pour {name}: {got} attendu {expected_md5}')
        tmp.replace(out)
        print(f'[CIQUAL] OK {name} ({out.stat().st_size/1024/1024:.1f} MB)')
    print('[CIQUAL] téléchargement terminé')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
