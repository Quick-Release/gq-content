#!/usr/bin/env python3
"""#6 P2/P6: installed WordPress -> installed package handler -> public delivery."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
from proof_package import prepare_npm
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cmsproof', ROOT / 'scripts/cms-proof.py')
cms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cms)
WORK = ROOT / '.proofs/pair'
WORK.mkdir(parents=True, exist_ok=True)
consumer = WORK / 'consumer'
if consumer.exists():
    shutil.rmtree(consumer)
consumer.mkdir()
prepare_npm(ROOT, WORK)
(consumer / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'packageManager': 'pnpm@12.11.2', 'dependencies': {'@getquick/content': 'file:' + str(WORK / 'getquick-content-0.3.1.tgz')}}))
subprocess.run(['vp', 'install', '--ignore-scripts'], cwd=consumer, check=True)
shutil.copy(ROOT / 'scripts/pair-receiver.mjs', consumer)
shutil.copy(ROOT / 'frontend/tests/support/sqlite-d1.ts', consumer)
fixture = WORK / 'graphql.json'
fixture.write_text(json.dumps({'entries': {}}))
secret = 'pair-local-disposable-signing-key-0123456789'
token = 'pair-local-disposable-refresh-key-0123456789'
env = os.environ | {'PAIR_DATABASE': str(WORK / 'store.sqlite'), 'PAIR_FIXTURE': str(fixture), 'PAIR_SECRET': secret, 'PAIR_TOKEN': token}
(WORK / 'store.sqlite').unlink(missing_ok=True)
log = (WORK / 'receiver.log').open('w+')
server = subprocess.Popen(['node', 'pair-receiver.mjs'], cwd=consumer, env=env, stdout=log, stderr=subprocess.STDOUT)
proof_config = cms.SITE / 'web/app/mu-plugins/pair-observer.php'
try:
    deadline = time.monotonic() + 30
    port = None
    while time.monotonic() < deadline:
        log.flush()
        lines = (WORK / 'receiver.log').read_text().splitlines()
        port = next((line.split()[1] for line in lines if line.startswith('READY ')), None)
        if port:
            break
        if server.poll() is not None:
            raise RuntimeError((WORK / 'receiver.log').read_text())
        time.sleep(.1)
    assert port, 'installed receiver did not start'
    origin = 'http://127.0.0.1:' + port
    environment = {'WP_ENV': 'production', 'GQ_CONTENT_SITE_ID': '  Pair Site / Á:06  ', 'PUBLICATION_EVENT_SECRET': secret, 'GETQUICK_FRONTEND_URL': origin}

    def request(path, data=None, auth=False):
        headers = {'Authorization': 'Bearer ' + token} if auth else {}
        body = json.dumps(data).encode() if data is not None else None
        with urllib.request.urlopen(urllib.request.Request(origin + path, data=body, headers=headers), timeout=30) as response:
            return json.load(response)

    def check(name, value):
        cms.check('pair: ' + name, value)

    def wp(*args):
        return cms.wp(*args, env=environment).stdout.strip()

    def record(post):
        return json.loads(wp('post', 'meta', 'get', post, '_gq_publication_event', '--format=json'))

    # Observe WordPress HTTP options without replacing transport or response.
    timeout_log = WORK / 'timeouts.jsonl'
    timeout_log.unlink(missing_ok=True)
    observer = "add_action('http_api_debug', function($response, $context, $class, $args, $url) { if (str_ends_with($url, '/gq/events')) file_put_contents(" + repr(str(timeout_log)) + ", json_encode(['timeout'=>$args['timeout']]) . PHP_EOL, FILE_APPEND); }, 10, 5);\n"
    proof_config.write_text('<?php\n' + observer)
    # Existing real WordPress installation came from the fresh Composer/Bedrock P2 task.
    wp('rewrite', 'structure', '/%postname%/')
    post = wp('post', 'create', '--post_type=page', '--post_status=draft', '--post_name=pair-entry', '--post_title=Pair entry', '--post_content=Pair publication v1', '--porcelain')
    wp('post', 'update', post, '--post_name=pair-entry-' + post)
    uri = '/pair-entry-' + post + '/'
    node_id = base64.b64encode(('post:' + post).encode()).decode()
    entry = {'id': node_id, 'uri': uri, 'title': 'Pair entry', 'content': '<p>Pair publication v1</p>', 'status': 'publish', 'isRestricted': False, 'featuredImage': None}
    prepared = request('/gq/refresh', {}, True)
    check('refresh installs usable chrome through public handler', prepared['refreshed'] and prepared['ready'])
    fixture.write_text(json.dumps({'entries': {uri: entry}}))
    check('saving a draft retains no publication event', cms.wp('post', 'meta', 'get', post, '_gq_publication_event', env=environment, ok=False).returncode != 0)
    wp('post', 'update', post, '--post_status=publish')
    saved = record(post)
    check('actual CMS signature and configured Site accepted by installed handler', saved['event']['site'] == 'Pair Site / Á:06' and saved['delivery']['status'] == 'refreshed')
    check('record key and source event wire fields retained', set(saved) == {'event', 'delivery'} and set(saved['event']) == {'site', 'id', 'action', 'occurredAt', 'entry'} and saved['event']['entry'] == {'id': node_id, 'uri': uri})
    check('default publication HTTP timeout is 15 seconds', json.loads(timeout_log.read_text().splitlines()[-1]) == {'timeout': 15})
    delivered = request('/proof/read?uri=' + uri)
    check('public delivery contains CMS publication from GraphQL boundary', delivered['delivery']['kind'] == 'found' and delivered['delivery']['content']['entry']['content'] == '<p>Pair publication v1</p>')
    # Observe a real update through the supported timeout filter, with integer coercion retained.
    proof_config.write_text('<?php\n' + observer + "add_filter('gq_publication_events_timeout', function($default) { if ($default !== 15) throw new RuntimeException('timeout default changed'); return '7'; });\n")
    time.sleep(.01)
    entry['content'] = '<p>Pair publication v2</p>'
    fixture.write_text(json.dumps({'entries': {uri: entry}}))
    wp('post', 'update', post, '--post_content=Pair publication v2')
    updated = record(post)
    check('update has fresh event identity and changes stored public delivery', updated['event']['id'] != saved['event']['id'] and request('/proof/read?uri=' + uri)['delivery']['content']['entry']['content'] == '<p>Pair publication v2</p>')
    check('timeout filter receives 15 and its numeric result controls transport', json.loads(timeout_log.read_text().splitlines()[-1]) == {'timeout': 7})
    # Actual unreachable receiver is independent of a readable CMS/GraphQL outage.
    started = time.monotonic()
    outcome = cms.wp('post', 'update', post, '--post_content=Save during receiver outage', env=environment | {'GETQUICK_FRONTEND_URL': 'http://127.0.0.1:1'})
    unavailable = record(post)
    check('unreachable receiver does not fail a WordPress save', outcome.returncode == 0 and time.monotonic() - started < 18 and unavailable['delivery']['status'] == 'failed' and unavailable['delivery']['reason'] == 'network')
    wp('gq-events', 'retry', post)
    check('receiver recovery retries same recorded identity', record(post)['event'] == unavailable['event'] and record(post)['delivery']['status'] == 'refreshed')
    previous_uri = uri
    uri = '/pair-moved-' + post + '/'
    entry['uri'] = uri
    fixture.write_text(json.dumps({'entries': {uri: entry}}))
    wp('post', 'update', post, '--post_name=pair-moved-' + post)
    moved = record(post)
    check('actual rename retains previousUri and moves the old stored route', moved['event']['entry'] == {'id': node_id, 'uri': uri, 'previousUri': previous_uri} and request('/proof/read?uri=' + previous_uri)['delivery'] == {'kind': 'moved', 'uri': uri})
    before = request('/proof/offline')['reads']
    check('stored publication survives CMS outage', request('/proof/read?uri=' + uri)['delivery']['kind'] == 'found')
    wp('gq-events', 'retry', post)
    retried = record(post)
    check('retry retains event identity and duplicate acceptance reads no CMS', retried['event'] == moved['event'] and retried['delivery']['status'] == 'refreshed' and request('/proof/read?uri=' + uri)['reads'] == before)
    wp('post', 'update', post, '--post_status=draft')
    withdrawn = record(post)
    public = request('/proof/read?uri=' + uri)
    check('actual withdrawal changes public delivery without CMS read', withdrawn['event']['action'] == 'withdraw' and withdrawn['delivery']['status'] == 'refreshed' and public['delivery']['kind'] == 'missing' and public['reads'] == before)
    check('withdrawal retains source record/wire shape and node identity', set(withdrawn) == {'event', 'delivery'} and withdrawn['event']['entry'] == {'id': node_id, 'uri': uri})
    check('actual withdrawal also hides the moved route without reading CMS', request('/proof/read?uri=' + previous_uri)['delivery']['kind'] == 'missing' and request('/proof/read?uri=' + uri)['reads'] == before)
    request('/proof/online')
    wp('post', 'update', post, '--post_status=publish')
    check('actual later republication restores public delivery', request('/proof/read?uri=' + uri)['delivery']['kind'] == 'found')
    before = request('/proof/offline')['reads']
    wp('post', 'update', post, '--post_password=local-proof-password')
    protected = record(post)
    check('password protection sends real withdrawal without CMS reads', protected['event']['action'] == 'withdraw' and protected['delivery']['status'] == 'refreshed' and request('/proof/read?uri=' + uri)['delivery']['kind'] == 'missing' and request('/proof/read?uri=' + uri)['reads'] == before)
    request('/proof/online')
    wp('post', 'update', post, '--post_password=')
    check('removing password sends real later publication', record(post)['event']['action'] == 'publish' and request('/proof/read?uri=' + uri)['delivery']['kind'] == 'found')
    before = request('/proof/offline')['reads']
    wp('post', 'update', post, '--post_status=trash')
    check('trashing a publication sends withdrawal and hides its public route', record(post)['event']['action'] == 'withdraw' and request('/proof/read?uri=' + uri)['delivery']['kind'] == 'missing')
    request('/proof/online')
    wp('post', 'update', post, '--post_status=publish')
    before = request('/proof/offline')['reads']
    wp('post', 'delete', post, '--force')
    check('permanent deletion withdraws all stored routes without CMS reads', request('/proof/read?uri=' + uri)['delivery']['kind'] == 'missing' and request('/proof/read?uri=' + previous_uri)['delivery']['kind'] == 'missing' and request('/proof/read?uri=' + uri)['reads'] == before)
    deleted = cms.wp('option', 'get', 'gq_publication_events_deleted', '--format=json', env=environment, ok=False)
    check('successfully delivered deletion leaves no dangling deleted-entry record', deleted.returncode != 0 or post not in json.loads(deleted.stdout))
    if '--retries' in sys.argv:
        import runpy
        runpy.run_path(str(ROOT / 'scripts/retry-proof.py'))['prove'](cms, environment, request, fixture, WORK)
    print('P2/P6 #6 installed pair passed: real Bedrock/WordPress transport; GraphQL boundary stub; Node SQLite publication store.', flush=True)
finally:
    proof_config.unlink(missing_ok=True)
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    log.close()
