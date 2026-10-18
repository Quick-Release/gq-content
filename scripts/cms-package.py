#!/usr/bin/env python3
"""Build the plugin-root release ZIP; no containing directory or test files."""
import json
import os
import shutil
import subprocess
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
metadata = json.loads((root / 'cms/composer.json').read_text())
version = metadata['version']
output = root / '.artifacts' / f'gq-content-{version}.zip'
output.parent.mkdir(exist_ok=True)
if os.environ.get('GQ_RELEASE_BUNDLE'):
    retained = subprocess.check_output(['node', 'scripts/release/candidate.mjs', 'cms'], cwd=root, text=True).strip()
    shutil.copyfile(retained, output)
    print(output)
    raise SystemExit(0)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['composer.json', 'gq-content.php', 'README.md', 'LICENSE']:
        archive.write(root / 'cms' / name, name)
    for source in sorted((root / 'cms/modules').glob('*.php')):
        archive.write(source, source.relative_to(root / 'cms'))
print(output)
