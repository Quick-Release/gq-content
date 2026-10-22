#!/usr/bin/env python3
"""Collect actual #11 candidate identities after uncached integrated verification."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/evidence/issue-11'
WORK = ROOT / '.proofs'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def command(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()

records = [json.loads((WORK / 'artifacts' / (name + '.json')).read_text()) for name in ['consumer', 'alchemy', 'reconciliation']]
for record in records:
    assert digest(WORK / 'artifacts' / (record['proof'] + '-' + record['filename'])) == record['sha256'], 'Retained artifact bytes differ'
for name in ['pair', 'multilingual']:
    path = WORK / name / 'getquick-content-0.3.0.tgz'
    records.append({'proof': name, 'filename': path.name, 'sha256': digest(path)})
assert len({r['sha256'] for r in records}) == 1, 'Proofs must consume identical candidate npm bytes'
archive = ROOT / '.artifacts/gq-content-0.3.0.zip'
composer = json.loads((WORK / 'p2/bedrock/composer.lock').read_text())
assert next(p for p in composer['packages'] if p['name'] == 'getquick/gq-content')['dist']['reference'] == digest(archive), 'Installed Composer ZIP identity differs'
versions = {p['name']: p['version'] for p in composer['packages']}
versions.update({'node': command(['node', '--version']), 'pnpm': '12.11.2 (Vite+ toolchain)', 'vite-plus': '1.1.0', 'typescript': '6.0.3', 'alchemy': '2.0.0-beta.79', 'effect': '4.0.0-rc.115', 'workerd': '1.20260901.1', 'compatibilityDate': '2026-09-08', 'PHP': command(['php', '--version']).splitlines()[0], 'Composer': command(['composer', '--version']).splitlines()[0], 'Bedrock project': '1.31.7', 'WP-CLI': '2.12.0', 'Polylang': '3.8.11', 'SQLite integration': '3.1.0', 'Astro': 'not installed: framework-neutral thin consumer exercises public standard handlers; source Astro presentation/build wiring is gq-site#77', 'cron': 'BusyBox 1.37.0, PHP 8.4.26 in digest-pinned local wordpress CLI container'})
proofs = ['sixty-publications.json', 'persistence.json', 'aged-persistence.json', 'daemon.json', 'inflight.json', 'final-check.json', 'cms-reconciliation.json', 'partial-cli.txt', 'failed-cli.txt']
shutil.copyfile(WORK / 'p2/bedrock/composer.lock', OUT / 'installed-composer.lock')
for name in proofs:
    shutil.copyfile(WORK / 'reconciliation' / name, OUT / name)
for name in ['daemon.log', 'process.txt', 'stdout', 'stderr']:
    shutil.copyfile(WORK / 'reconciliation/cron' / name, OUT / ('cron-' + name))
shutil.copyfile(WORK / 'pair/retry-records.json', OUT / 'retry-records.json')
shutil.copyfile(WORK / 'multilingual/proof-artifacts.json', OUT / 'multilingual-records.json')
# Hash the canonical retained representation, after formatting the copied JSON.
subprocess.run(['vp', 'fmt', str(OUT)], cwd=ROOT, check=True)
manifest = {'schemaVersion': 1, 'scope': '#11 local candidate regression; not a release manifest', 'contentBase': command(['git', 'rev-parse', 'HEAD']), 'npmCandidates': records, 'composerZip': {'filename': archive.name, 'sha256': digest(archive)}, 'composerLockSha256': digest(WORK / 'p2/bedrock/composer.lock'), 'composerPackages': versions, 'wpCliPharSha256': digest(WORK / 'p2/downloads/wp-cli.phar'), 'evidenceHashes': {name: digest(OUT / name) for name in proofs}, 'gates': {'P1': 'installed Alchemy migration lifecycle and unchanged identities/data on Worker update', 'P2': 'actual Composer ZIP/Bedrock/WordPress/PHP/WP-CLI and minute cron daemon', 'P3': 'public-only credential-isolated installed consumer, declarations/artifact inspection and all tests', 'P4': 'public boundary access/isolation/fresh bindings/canonical language identity', 'P6': 'package suites; actual CMS/pair/retry/Polylang and integrated workerd regression', 'P5': 'independent #10; actual gq-content GITHUB_TOKEN CI access awaits final push; NOT passed by #11', 'P7': 'independent publication recovery; NOT executed by #11'}, 'limitations': ['No actual Ploi provisioning or PHP-FPM response-completion measurement', 'No deployed Cloudflare CPU/subrequest-enforcement proof; local actual GraphQL request counts are <=40', 'GraphQL-only fixtures: no live GETQUICK GraphQL schema proof', 'No Astro generated Site, Blueprint switch, release, registry availability or publication recovery claim']}
(OUT / 'candidate-artifacts.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Collected identical npm candidate bytes across P1/P3/pair/multilingual/integrated workerd; Composer ZIP and complete persistent evidence recorded.')
