#!/usr/bin/env python3
"""FoodNote — téléchargement CIQUAL officiel.

Rôle : télécharger les XML publics ANSES CIQUAL vers DATA_DIR (/data).
Gère : URLs officielles, reprise sûre fichier par fichier, contrôle MD5,
        téléchargement atomique et distinction fichiers requis/optionnels.
Ne doit pas gérer : import SQLite/JSON, routes HTTP, interface utilisateur,
                    recherche alimentaire ou logique OpenFoodFacts.

Source : Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025.
DOI : https://doi.org/10.57745/RDMHWY
Licence : Licence Ouverte Etalab 2.0.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# name, url, expected_md5, required_for_foodnote_import
FILES = [
    ('alim.xml',    'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/OH8KXC', '8e1171d63cee4b6010cfce25dd29243d', True),
    ('grp.xml',     'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/FMNIUZ', 'c31aeea90349c3aab86f98ef5f4f10da', True),
    ('compo.xml',   'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/O73GDX', '2da725585946434df320d8041631998b', True),
    ('const.xml',   'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/FWSPCX', 'd8f2f25fdacb887bc993a6eeaf80f203', True),
    # sources.xml n'est pas utilisé par l'import FoodNote. On le récupère si possible,
    # mais une panne réseau dessus ne doit pas bloquer une base CIQUAL exploitable.
    ('sources.xml', 'https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/3MVEOJ', '5469598d6b4811672b65e1644dfc6485', False),
]

USER_AGENT = os.environ.get('CIQUAL_USER_AGENT', 'FoodNote-CIQUAL/0.22.179 (+self-hosted)')


def log(message: str) -> None:
    print(message, flush=True)


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def existing_file_is_valid(path: Path, expected_md5: str | None) -> bool:
    if not path.exists() or not path.is_file() or path.stat().st_size <= 0:
        return False
    if not expected_md5:
        return True
    got = md5(path)
    if got == expected_md5:
        return True
    log(f'[CIQUAL] {path.name} présent mais MD5 différent ({got} != {expected_md5})')
    return False


def download_once(url: str, dest: Path, timeout: int) -> None:
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': USER_AGENT,
            'Accept': 'application/octet-stream,*/*;q=0.8',
            'Connection': 'close',
        },
        method='GET',
    )
    with urllib.request.urlopen(req, timeout=timeout) as response, dest.open('wb') as f:
        status = getattr(response, 'status', None) or response.getcode()
        if status and int(status) >= 400:
            raise urllib.error.URLError(f'HTTP {status}')
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            f.write(chunk)
    if dest.stat().st_size <= 0:
        raise RuntimeError('fichier téléchargé vide')


def download_with_retries(name: str, url: str, tmp: Path, retries: int, timeout: int) -> None:
    attempts = max(1, int(retries))
    for attempt in range(1, attempts + 1):
        tmp.unlink(missing_ok=True)
        try:
            log(f'[CIQUAL] téléchargement {name} — tentative {attempt}/{attempts}')
            download_once(url, tmp, timeout=timeout)
            return
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            if attempt >= attempts:
                raise
            wait = min(75, 4 * attempt * attempt)
            log(f'[CIQUAL] tentative {attempt}/{attempts} échouée pour {name}: {exc}')
            log(f'[CIQUAL] nouvelle tentative dans {wait}s')
            time.sleep(wait)


def download_file(dest_dir: Path, name: str, url: str, expected_md5: str, required: bool, force: bool, retries: int, timeout: int) -> bool:
    out = dest_dir / name
    if not force and existing_file_is_valid(out, expected_md5):
        log(f'[CIQUAL] {name} déjà présent et valide')
        return True

    tmp = out.with_suffix(out.suffix + '.tmp')
    try:
        download_with_retries(name, url, tmp, retries=retries, timeout=timeout)
        if expected_md5:
            got = md5(tmp)
            if got != expected_md5:
                raise RuntimeError(f'MD5 invalide pour {name}: {got} attendu {expected_md5}')
        tmp.replace(out)
        log(f'[CIQUAL] OK {name} ({out.stat().st_size/1024/1024:.1f} MB)')
        return True
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        if existing_file_is_valid(out, expected_md5):
            log(f'[CIQUAL] téléchargement impossible pour {name}, fichier local valide conservé: {exc}')
            return True
        if required:
            raise RuntimeError(f'{name} requis indisponible: {exc}') from exc
        log(f'[CIQUAL] AVERTISSEMENT: {name} optionnel ignoré: {exc}')
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dest', default=os.environ.get('DATA_DIR', '/data'))
    parser.add_argument('--force', action='store_true', help='retélécharge même si le fichier local est valide')
    parser.add_argument('--retries', type=int, default=int(os.environ.get('CIQUAL_DOWNLOAD_RETRIES', '5') or '5'))
    parser.add_argument('--timeout', type=int, default=int(os.environ.get('CIQUAL_DOWNLOAD_TIMEOUT', '300') or '300'))
    args = parser.parse_args()

    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    log(f'[CIQUAL] destination: {dest}')
    log(f'[CIQUAL] retries={args.retries} timeout={args.timeout}s force={args.force}')

    missing_required = []
    for name, url, expected_md5, required in FILES:
        try:
            ok = download_file(dest, name, url, expected_md5, required, args.force, args.retries, args.timeout)
            if required and not ok:
                missing_required.append(name)
        except Exception as exc:
            missing_required.append(name)
            log(f'[CIQUAL] ERREUR: {exc}')

    if missing_required:
        log('[CIQUAL] téléchargement incomplet, fichiers requis manquants: ' + ', '.join(missing_required))
        return 1

    log('[CIQUAL] téléchargement terminé')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
