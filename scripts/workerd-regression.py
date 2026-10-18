"""Additional installed WordPress -> workerd public regression observations."""
from concurrent.futures import ThreadPoolExecutor
import json
import time
import urllib.error
import urllib.request


def prove(cms, environment, origin, fixture, control, work, phase):
    check = lambda name, value: cms.check('workerd regression: ' + name, value)
    def request(path, body=None, headers=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(origin + path, data=data, headers=headers or {}, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, dict(response.headers), json.load(response)
    def read(uri):
        return request('/proof/read?uri=' + uri)[2]
    if phase == 'bulk':
        observer = cms.SITE / 'web/app/mu-plugins/reconciliation-proof.php'
        observer.write_text((cms.ROOT / 'cms/tests/reconciliation-export.php').read_text())
        try:
            def stats():
                graphql_origin = json.loads((work / 'bridge.json').read_text())['origin']
                with urllib.request.urlopen(graphql_origin + '/stats') as response:
                    return json.load(response)['requests']
            def state():
                # Complete records are observed at the disposable consumer diagnostics;
                # public delivery is checked separately after convergence.
                return request('/proof/diagnostics')[2]
            before = state()
            # Omit event configuration while creating the sixty actual WordPress
            # publications; GraphQL is the only substituted boundary.
            created = cms.wp('eval', """
            $ids=[];
            for($n=0;$n<60;$n++) {
              $id=wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>'Bulk '.$n,'post_name'=>'bulk-story-'.$n,'post_content'=>'<p>Bulk '.$n.'</p>']);
              pll_set_post_language($id,'pt');
              if(get_post_meta($id,'_gq_publication_event',true)) throw new RuntimeException('unexpected event');
              $ids[]=$id;
            }
            echo json_encode($ids);
            """, env={'PAIR_FIXTURE': str(fixture)})
            check('sixty actual WordPress publications have no recorded events', len(json.loads(created.stdout)) == 60)
            runs = []
            for _ in range(8):
                start = stats()
                cms.wp('gq-events', 'retry-due', '--quiet', env=environment)
                count = stats() - start
                record = state()['reconciliation'][0]
                check('sixty-publication continuation remains within forty actual requests', count <= 40)
                runs.append({'requests': count, 'record': record})
                if record['outcome'] == 'reconciled':
                    break
            check('sixty lost publications require and complete multiple scheduler runs', len(runs) > 1 and runs[0]['record']['pending'] > 0 and runs[-1]['record']['outcome'] == 'reconciled' and runs[-1]['record']['pending'] == 0)
            count_before_reads = stats()
            for n in range(60):
                check('lost publication ' + str(n) + ' is already stored with its exact HTML', read('/bulk-story-' + str(n) + '/')['content']['entry']['content'] == '<p>Bulk ' + str(n) + '</p>')
            check('visits did not cause any of the sixty recoveries', stats() == count_before_reads)
            (work / 'sixty-publications.json').write_text(json.dumps({'created': json.loads(created.stdout), 'runs': runs, 'before': before, 'after': state()}, indent=2) + '\n')
        finally:
            observer.unlink(missing_ok=True)
        return
    if phase == 'aged-after-update':
        before = json.loads((work / 'aged-public.json').read_text())
        check('year-old home and entry survive rebuilt Worker during CMS outage', request('/proof/home?language=en')[2] == before['home'] and read('/en/reconcile-story-3/') == before['entry'])
        check('withdrawal survives rebuilt Worker and outage', read('/en/reconcile-story-5/')['kind'] == 'missing')
        control.write_text('{}')
        return
    observer = cms.SITE / 'web/app/mu-plugins/reconciliation-proof.php'
    observer.write_text((cms.ROOT / 'cms/tests/reconciliation-export.php').read_text())
    try:
        ids = json.loads((work / 'ids.json').read_text())
        uri = '/en/reconcile-story-5/'
        held = work / 'held.json'
        held.unlink(missing_ok=True)
        control.write_text(json.dumps({'holdUri': uri}))
        token = 'workerd-disposable-refresh-key-01234567890123456789'
        with ThreadPoolExecutor() as pool:
            inflight = pool.submit(request, '/gq/refresh', {'uris': [uri]}, {'Authorization': 'Bearer ' + token})
            deadline = time.monotonic() + 5
            while not held.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            check('refresh holds an actual in-flight GraphQL read in workerd', held.exists() and not inflight.done())
            cms.wp('post', 'update', str(ids['story-5']), '--post_status=draft', env=environment)
            check('actual WordPress withdrawal wins before held read completes', read(uri)['kind'] == 'missing')
            control.write_text('{"release":true}')
            result = inflight.result(timeout=15)
        check('in-flight read cannot restore actual CMS withdrawal', result[0] == 200 and result[2]['entries'][uri]['outcome'] == 'withdrawn' and read(uri)['kind'] == 'missing')
        control.write_text('{}')
        # Wire policy through workerd's real Request/Response implementation.
        for path in ['/gq/events', '/gq/refresh']:
            status, headers, _ = request(path)
            check(path + ' retains POST-only Allow and no-store wire headers', status == 405 and headers.get('Allow') == 'POST' and headers.get('Cache-Control') == 'no-store')
        status, headers, _ = request('/gq/refresh', {'uris': []}, {'Authorization': 'Bearer wrong'})
        check('workerd refuses refresh credentials with no-store challenge', status == 401 and headers.get('Cache-Control') == 'no-store' and 'Bearer' in headers.get('WWW-Authenticate', ''))
        # Age the disposable D1 rows via test-only consumer, never a runtime export.
        aged = request('/proof/age', {})[2]
        check('every publication timestamp is older than a year before update', bool(aged['publications']) and all(row['promoted_at'] < int(time.time()*1000) - 31535000000 for row in aged['publications']))
        control.write_text('{"offline":true}')
        public = {'home': request('/proof/home?language=en')[2], 'entry': read('/en/reconcile-story-3/')}
        check('year-old stored HTML stays served through outage', public['home']['kind'] == 'found' and public['entry']['content']['entry']['content'] == '<p>Delivered by actual cron daemon</p>')
        (work / 'aged-public.json').write_text(json.dumps(public))
        (work / 'inflight.json').write_text(json.dumps({'held': json.loads(held.read_text()), 'refresh': result, 'withdrawn': read(uri)}, indent=2) + '\n')
    finally:
        observer.unlink(missing_ok=True)
