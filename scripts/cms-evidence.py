#!/usr/bin/env python3
"""Check immutable CMS extraction sources against their recorded Git identities."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'gq-site'
evidence = json.loads((ROOT / 'docs/evidence/issue-5/provenance.json').read_text())
for file in evidence['files']:
    data = subprocess.check_output(['git', '-C', str(source), 'show',
                                    evidence['reviewedCheckpoint'] + ':' + file['sourcePath']])
    assert hashlib.sha256(data).hexdigest() == file['sha256'], file['sourcePath']
    subprocess.run(['git', '-C', str(source), 'diff', '--exit-code',
                    evidence['reviewedCheckpoint'], evidence['verifiedUpstreamMain'],
                    '--', file['sourcePath']], check=True)
print(f"PASS {len(evidence['files'])} CMS/smoke/Bedrock/ADR source paths: recorded checkpoint hashes and no relevant upstream delta")
