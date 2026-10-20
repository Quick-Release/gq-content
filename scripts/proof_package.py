"""Select the retained npm archive or pack a fresh local proof input."""
import json
import os
from pathlib import Path
import shutil
import subprocess

VERSION = json.loads((Path(__file__).resolve().parents[1] / 'frontend/package.json').read_text())['version']
TARBALL = f'getquick-content-{VERSION}.tgz'


def prepare_npm(root: Path, destination: Path):
    if os.environ.get('GQ_RELEASE_BUNDLE'):
        # Selection validates the whole pair and source revision; failure never packs.
        retained = subprocess.check_output(
            ['node', 'scripts/release/candidate.mjs', 'npm'], cwd=root, text=True
        ).strip()
        shutil.copyfile(retained, destination / TARBALL)
    else:
        subprocess.run(
            ['vp', 'pm', 'pack', '--pack-destination', str(destination)],
            cwd=root / 'frontend', check=True,
        )
