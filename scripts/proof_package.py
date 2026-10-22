"""Select the retained npm archive or pack a fresh local proof input."""
import os
from pathlib import Path
import shutil
import subprocess


def prepare_npm(root: Path, destination: Path):
    if os.environ.get('GQ_RELEASE_BUNDLE'):
        # Selection validates the whole pair and source revision; failure never packs.
        retained = subprocess.check_output(
            ['node', 'scripts/release/candidate.mjs', 'npm'], cwd=root, text=True
        ).strip()
        shutil.copyfile(retained, destination / 'getquick-content-0.3.0.tgz')
    else:
        subprocess.run(
            ['vp', 'pm', 'pack', '--pack-destination', str(destination)],
            cwd=root / 'frontend', check=True,
        )
