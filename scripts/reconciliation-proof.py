#!/usr/bin/env python3
"""Real installed WordPress/Polylang/CLI HTTP → Alchemy workerd reconciliation.
GraphQL alone is a snapshot boundary; CMS hooks, scheduler, signing, HTTP, D1
and the installed package are real. Called asynchronously while workerd runs.
"""
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cmsproof', ROOT / 'scripts/cms-proof.py')
cms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cms)
phase, origin, graphql = sys.argv[1:]
WORK = ROOT / '.proofs/reconciliation'
secret = 'workerd-disposable-event-key-01234567890123456789'
fixture = WORK / 'graphql.json'
control = WORK / 'control.json'
observer = cms.SITE / 'web/app/mu-plugins/reconciliation-proof.php'
environment = {'WP_ENV': 'production', 'GQ_CONTENT_SITE_ID': 'P1', 'PUBLICATION_EVENT_SECRET': secret, 'GETQUICK_FRONTEND_URL': origin, 'PAIR_FIXTURE': str(fixture)}
setup_env = {'PAIR_FIXTURE': str(fixture)}

def wp(*args, ok=True, configured=True):
    return cms.wp(*args, env=environment if configured else setup_env, ok=ok)

def check(name, value):
    cms.check('integrated reconciliation: ' + name, value)

def request(path, body=None, headers=None, base=origin):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def signed(action='check', **fields):
    body = {'site': 'P1', 'id': 'proof-' + str(time.time_ns()), 'occurredAt': int(time.time() * 1000), 'action': action} | fields
    encoded = json.dumps(body).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), stamp.encode() + b'.' + encoded, hashlib.sha256).hexdigest()
    return request('/gq/events', body, {'GQ-Event-Timestamp': stamp, 'GQ-Event-Signature': 'v1=' + signature})

def state():
    return signed()[1]

def read(uri):
    return request('/proof/read?uri=' + uri)[1]

def home(language):
    return request('/proof/home?language=' + language)[1]

def reconcile(scheduler=False, ok=True):
    before = request('/stats', base=graphql.removesuffix('/graphql'))[1]['requests']
    result = wp('gq-events', 'retry-due' if scheduler else 'reconcile', *(['--quiet'] if scheduler else []), ok=ok)
    after = request('/stats', base=graphql.removesuffix('/graphql'))[1]['requests']
    check('run remains within 40 CMS requests', after - before <= 40)
    return result

def clear_events():
    wp('eval', "foreach(get_posts(['post_type'=>['page','post'],'post_status'=>array_values(get_post_stati()),'numberposts'=>-1,'lang'=>'']) as $p) delete_post_meta($p->ID,'_gq_publication_event'); foreach(['identity','menus','logo','design','patterns','identity:pt','identity:en','menus:pt','menus:en'] as $s) delete_option('gq_settings_event_'.$s); delete_option('gq_publication_events_deleted');", configured=False)

if phase == 'prepare-partial':
    check('Composer-installed CMS is 0.2.0', wp('gq-events', 'version').stdout.strip() == '0.2.0')
    check('actual Polylang is active', wp('eval', "echo function_exists('pll_set_post_language') ? 'yes' : 'no';", configured=False).stdout.strip() == 'yes')
    observer.write_text((ROOT / 'cms/tests/reconciliation-export.php').read_text())
    # Use WordPress/Polylang APIs to create real content. Omit endpoint configuration
    # while preparing it so publication events never reach this fresh store.
    created = wp('eval', """
    global $wpdb; $wpdb->update($wpdb->posts, ['post_status'=>'draft'], ['post_type'=>'page']);
    $ids=[];
    foreach(['pt'=>'Início','en'=>'Home'] as $lang=>$title) {
      $id=wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>$title,'post_name'=>'reconcile-home-'.$lang,'post_content'=>'<h1>'.$title.'</h1>']);
      pll_set_post_language($id,$lang); $ids[$lang]=$id;
    }
    pll_save_post_translations($ids); update_option('show_on_front','page'); update_option('page_on_front',$ids['pt']);
    for($n=0;$n<40;$n++) { $id=wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>'Story '.$n,'post_name'=>'reconcile-story-'.$n,'post_content'=>'<p>Story '.$n.'</p>']); pll_set_post_language($id,$n%2?'en':'pt'); $ids['story-'.$n]=$id; }
    echo json_encode($ids);
    """, configured=False)
    ids = json.loads(created.stdout)
    (WORK / 'ids.json').write_text(json.dumps(ids))
    clear_events()
    snapshot = json.loads(fixture.read_text())
    check('40 actual WordPress entries with modification times and both languages exported', len(snapshot['entries']) == 40 and all(e['modifiedGmt'] for e in snapshot['entries'].values()) and {e['language']['slug'] for e in snapshot['entries'].values()} == {'pt', 'en'})
    # False preserves the boolean extension contract and does no transport.
    observer.write_text((ROOT / 'cms/tests/reconciliation-export.php').read_text() + "\nadd_filter('gq_events_reconcile', '__return_false');\n")
    disabled = wp('gq-events', 'reconcile', ok=False)
    check('supported false filter skips reconciliation', disabled.returncode != 0 and 'Events aren' in disabled.stderr and state()['reconciliation'] is None)
    observer.write_text((ROOT / 'cms/tests/reconciliation-export.php').read_text())
    # No true filter installed: the supported default is enabled.
    result = reconcile()
    check('CLI reports partial completion without claiming a complete match', 'left' in result.stdout or 'next' in result.stdout)
    # 40 candidates: 7 shared slots + 1 list request leave 16 two-request reads.
    # Partial continuation is therefore 24 -> 8 -> 0, including home recovery.
    check('signed check reports durable partial state', state()['reconciliation']['outcome'] == 'behind' and state()['reconciliation']['pending'] == 24)
    check('shared rows for every language prepared', state()['store']['home'] == 'published' and state()['store']['languages']['en'] == {'home': 'published', 'chrome': 'published'})
    (WORK / 'partial-cli.txt').write_text(result.stdout)

elif phase == 'continue-outage':
    check('pending evidence still visible before continuation', state()['reconciliation']['outcome'] == 'behind' and state()['reconciliation']['pending'] == 24)
    reconcile(scheduler=True)
    check('real scheduler continues unfinished work', state()['reconciliation']['pending'] == 8)
    reconcile(scheduler=True)
    check('scheduler converges complete published list', state()['reconciliation']['outcome'] == 'reconciled' and state()['store']['entries']['published'] == 40)
    snapshot = json.loads(fixture.read_text())
    for uri, entry in snapshot['entries'].items():
        actual = read(uri)
        check('stored story ' + entry['title'], actual['kind'] == 'found' and actual['content']['entry']['content'] == entry['content'])
    # Hold a real D1 reconciliation lease while the external GraphQL boundary delays.
    from concurrent.futures import ThreadPoolExecutor
    control.write_text(json.dumps({'delayMs': 250}))
    before = request('/stats', base=graphql.removesuffix('/graphql'))[1]['requests']
    with ThreadPoolExecutor() as pool:
        running = pool.submit(signed, 'reconcile')
        deadline = time.monotonic() + 10
        while request('/stats', base=graphql.removesuffix('/graphql'))[1]['requests'] == before and time.monotonic() < deadline:
            time.sleep(.01)
        check('real D1 lease rejects overlap with exact busy wire answer', signed('reconcile')[1]['status'] == 'busy')
        check('leased run completes', running.result()[1]['status'] == 'reconciled')
    control.write_text('{}')
    (WORK / 'before-outage.json').write_text(json.dumps({'check': state(), 'pt': home('pt'), 'en': home('en')}))
    ids = json.loads((WORK / 'ids.json').read_text())
    # Bypass save hooks deliberately: this is a missed change, not a retry.
    wp('eval', f"global $wpdb; $wpdb->update($wpdb->posts,['post_content'=>'<p>Recovered missed change</p>','post_modified_gmt'=>gmdate('Y-m-d H:i:s',time()+2)],['ID'=>{ids['story-0']}]);", configured=False)
    control.write_text(json.dumps({'entryFailure': True}))
    failed = reconcile(ok=False)
    check('actual CMS CLI reports failed entry reconciliation', failed.returncode != 0 and "couldn't reconcile" in failed.stderr)
    check('failed synthetic publication is persisted', state()['store']['failedEvents'] == 1)
    control.write_text(json.dumps({'offline': True}))
    outage = reconcile(ok=False)
    check('CMS outage reports failure and retains last matched time', outage.returncode != 0 and state()['reconciliation']['outcome'] == 'failed' and state()['reconciliation']['failed'] == 6 and state()['reconciliation']['reconciledAt'] is not None)
    check('last-known-good language homes remain served', home('pt')['kind'] == 'found' and home('en')['kind'] == 'found')
    observer.write_text((ROOT / 'cms/tests/reconciliation-export.php').read_text() + "\nadd_filter('gq_events_now', static fn() => time() + 11 * 60);\n")
    health = json.loads(wp('eval-file', str(ROOT / 'cms/tests/diagnostics.php')).stdout)
    delays = wp('gq-events', 'delays')
    check('stale failed reconciliation reported safely through real Site Health and CLI', health['health']['status'] != 'good' and 'last matched WordPress' in health['health']['description'] and 'Reconciliation last ran' in delays.stderr and secret not in json.dumps(health) + delays.stderr)
    observer.write_text((ROOT / 'cms/tests/reconciliation-export.php').read_text())
    (WORK / 'failed-cli.txt').write_text(failed.stderr + outage.stderr)

elif phase == 'recover':
    check('failed evidence visible BEFORE recovery', state()['reconciliation']['outcome'] == 'failed' and state()['reconciliation']['failed'] == 6 and state()['store']['failedEvents'] == 1)
    control.write_text('{}')
    reconcile(scheduler=True)
    check('scheduler repairs missed change after outage', state()['reconciliation']['outcome'] == 'reconciled' and state()['store']['failedEvents'] == 0)
    uri = next(uri for uri, entry in json.loads(fixture.read_text())['entries'].items() if entry['title'] == 'Story 0')
    check('recovered content publicly served', read(uri)['content']['entry']['content'] == '<p>Recovered missed change</p>')
    ids = json.loads((WORK / 'ids.json').read_text())
    # Real CMS hook delivery still reaches workerd, with actual transport/signing.
    wp('post', 'update', str(ids['story-0']), '--post_title=Hook reached workerd')
    record = json.loads(wp('post', 'meta', 'get', str(ids['story-0']), '_gq_publication_event', '--format=json').stdout)
    check('actual WordPress publication hook/signature/HTTP reaches installed workerd handler', record['delivery']['status'] == 'refreshed' and record['event']['site'] == 'P1')
    # Restore the same missed publication's timestamp for durable retry identity
    # comparisons; title change may advance a separate ordinary event only.
    clear_events()
    # Shared updates, a moved language route and a removed entry bypass hooks.
    wp('eval', f"global $wpdb; $wpdb->update($wpdb->posts,['post_name'=>'reconcile-moved','post_modified_gmt'=>gmdate('Y-m-d H:i:s',time()+3)],['ID'=>{ids['story-1']}]); $wpdb->update($wpdb->posts,['post_status'=>'draft'],['ID'=>{ids['story-2']}]); $wpdb->update($wpdb->posts,['post_content'=>'<h1>English repaired</h1>'],['ID'=>{ids['en']}]); $wpdb->update($wpdb->options,['option_value'=>'Reconciled tagline'],['option_name'=>'blogdescription']);", configured=False)
    control.write_text(json.dumps({'incomplete': True}))
    incomplete = reconcile(ok=False)
    check('incomplete list fails without removing stored entry', incomplete.returncode != 0 and read('/reconcile-story-2/')['kind'] == 'found')
    control.write_text('{}')
    reconcile(scheduler=True)
    check('lost move redirects old English route', read('/en/reconcile-story-1/') == {'kind': 'moved', 'uri': '/en/reconcile-moved/'})
    check('confirmed removal becomes missing', read('/reconcile-story-2/')['kind'] == 'missing')
    check('English home repaired without Portuguese leakage', home('en')['content']['home']['page']['content'] == '<h1>English repaired</h1>' and home('pt')['content']['home']['page']['content'] == '<h1>Início</h1>')
    # CLI/scheduler record and readiness remain bounded metadata, no content/key.
    final = state()
    check('check exposes only accepted evidence', set(final) == {'status', 'site', 'reconciliation', 'store'} and secret not in json.dumps(final) and 'Recovered missed change' not in json.dumps(final))
    (WORK / 'final-check.json').write_text(json.dumps(final, indent=2))
    (WORK / 'cms-reconciliation.json').write_text(wp('option', 'get', 'gq_reconciliation', '--format=json').stdout)
    observer.unlink(missing_ok=True)
elif phase in ['runtime', 'aged-after-update', 'bulk']:
    import runpy
    runpy.run_path(str(ROOT / 'scripts/workerd-regression.py'))['prove'](cms, environment, origin, fixture, control, WORK, phase)
elif phase == 'daemon':
    import runpy
    runpy.run_path(str(ROOT / 'scripts/cron-proof.py'))['prove'](cms, environment, origin, fixture, control, WORK)
else:
    raise ValueError(phase)
