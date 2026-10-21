"""#8 installed CMS/CLI scheduler and installed public consumer. No PHP mocks."""
import base64
import datetime
import json
import os
import shlex
import subprocess
import time


def prove(cms, environment, request, fixture, work):
    check = lambda name, value: cms.check('retry: ' + name, value)
    observer = cms.SITE / 'web/app/mu-plugins/retry-observer.php'
    clock = work / 'retry-clock'
    clock.write_text(str(int(time.time())))
    baseline = "<?php\nadd_filter('gq_events_reconcile', '__return_false');\n"
    baseline += "add_filter('gq_events_now', fn($now) => (int) file_get_contents(" + repr(str(clock)) + "));\n"
    observer.write_text(baseline)

    def wp(*args, ok=True):
        return cms.wp(*args, env=environment, ok=ok)

    def cli(*args):
        return json.loads(wp('gq-events', *args, '--format=json').stdout)

    def record(post):
        return json.loads(wp('post', 'meta', 'get', post, '_gq_publication_event', '--format=json').stdout)

    def rows():
        return cli('delays')

    def due(post):
        row = next(row for row in rows() if row['subject'] == 'post:' + post)
        return int(datetime.datetime.fromisoformat(row['next']).timestamp())

    def tick(at):
        clock.write_text(str(at))

    def saved(post):
        return request('/proof/read?uri=/retry-' + post + '/')['delivery']

    def create():
        post = wp('post', 'create', '--post_type=page', '--post_status=draft', '--post_title=Retry', '--porcelain').stdout.strip()
        wp('post', 'update', post, '--post_name=retry-' + post)
        return post

    def publish(post, text):
        uri = '/retry-' + post + '/'
        entries = json.loads(fixture.read_text())
        entries['entries'][uri] = {'id': base64.b64encode(('post:' + post).encode()).decode(), 'uri': uri, 'title': 'Retry', 'content': text, 'status': 'publish', 'isRestricted': False, 'featuredImage': None}
        fixture.write_text(json.dumps(entries))
        wp('post', 'update', post, '--post_status=publish', '--post_content=' + text)
        return record(post)

    def report(post):
        code = "wp_set_current_user(1); $r = rest_do_request('/gq-events/v1/entries/" + post + "'); echo wp_json_encode($r->get_data());"
        return json.loads(wp('eval', code).stdout)

    def cron():
        # Disposable server-cron execution harness: minimal environment, installed
        # WP-CLI executable, real working directory, exact package command suffix.
        # No WP-Cron, no system/user crontab modification, no daemon claim.
        bindir = work / 'cron-bin'
        bindir.mkdir(exist_ok=True)
        launcher = bindir / 'wp'
        launcher.write_text('#!/bin/sh\nexec php -d error_reporting=24575 -d memory_limit=512M ' + shlex.quote(str(cms.CACHE / 'wp-cli.phar')) + ' --path=' + shlex.quote(str(cms.SITE / 'web/wp')) + ' "$@"\n')
        launcher.chmod(0o755)
        env = {'PATH': str(bindir) + ':' + os.environ['PATH'], 'HOME': str(work), 'WP_CLI_ALLOW_ROOT': '1', 'WP_ENV': 'production', 'WP_HOME': 'http://p2.test', 'WP_SITEURL': 'http://p2.test/wp', 'DB_NAME': 'p2', 'DB_USER': 'p2', 'DB_PASSWORD': 'p2'} | environment
        result = subprocess.run(['/bin/sh', '-c', 'wp gq-events retry-due --quiet'], cwd=cms.SITE, env=env, capture_output=True, text=True)
        (work / 'cron.stdout').write_text(result.stdout)
        (work / 'cron.stderr').write_text(result.stderr)
        check('server-cron invocation preserves quiet CLI output contract', result.returncode == 0 and 'Success:' not in result.stdout and (result.stdout == '' or result.stdout.startswith('subject\tlabel\tevent\taction\tstatus\treason\tattempts\n')))

    try:
        request('/proof/online')
        # P2 deliberately leaves failed configuration fixtures; isolate scheduler
        # work through real WordPress record APIs in this disposable installation.
        wp('eval', "foreach (get_posts(['post_type'=>['page','post'], 'post_status'=>array_values(get_post_stati()), 'numberposts'=>-1]) as $p) delete_post_meta($p->ID, '_gq_publication_event'); foreach (['identity','menus','logo','design','patterns'] as $s) delete_option('gq_settings_event_' . $s); delete_option('gq_publication_events_deleted');")
        observer.write_text('<?php\n')
        reconciled = wp('gq-events', 'reconcile')
        check('explicit reconciliation reaches the installed handler', 'matches WordPress' in reconciled.stdout)
        observer.write_text(baseline)
        config_post = create()
        publish(config_post, '<p>Configuration recovery</p>')
        cms.wp('post', 'update', config_post, '--post_content=Saved without endpoint', env=environment | {'GETQUICK_FRONTEND_URL': ''})
        unconfigured = record(config_post)
        check('invalid configuration retains failed record without claiming public success', unconfigured['delivery']['reason'] == 'not-configured' and unconfigured['delivery']['status'] == 'failed')
        tick(due(config_post))
        cron()
        check('scheduler recovers retained record after configuration is repaired', record(config_post)['event'] == unconfigured['event'] and record(config_post)['delivery']['status'] == 'refreshed')
        tick(int(time.time()))
        post = create()
        publish(post, '<p>Last good</p>')
        request('/proof/offline')
        failed = publish(post, '<p>Recovered</p>')
        check('WordPress saves while public delivery remains last-known-good', failed['delivery']['status'] == 'failed' and failed['delivery']['reason'] == 'refresh' and saved(post)['content']['entry']['content'] == '<p>Last good</p>')
        check('Frontend failure reason remains secret-safe', failed['delivery']['message'] == "network: WordPress couldn't be reached" and environment['PUBLICATION_EVENT_SECRET'] not in json.dumps(failed))
        failed_report = report(post)
        check('editor REST report separates save and delivery without secrets', failed_report['state'] == 'retrying' and 'saved in WordPress' in failed_report['notice']['message'] and environment['PUBLICATION_EVENT_SECRET'] not in json.dumps(failed_report))
        check('editor delivery route requires edit permission', json.loads(wp('eval', "echo rest_do_request('/gq-events/v1/entries/" + post + "')->get_status();").stdout) in [401, 403])
        at = due(post)
        tick(at - 1)
        check('scheduler leaves an early retry alone', cli('retry-due') == [])
        tick(at)
        retried = cli('retry-due')
        check('due retry persists failure and same event identity', len(retried) == 1 and retried[0]['event'] == failed['event']['id'] and record(post)['delivery']['attempts'] == 2)
        # Backoff values are independently specified by ADR 0008, not computed from code.
        for attempts, delay in [(2, 120), (3, 300), (4, 600), (5, 1800), (6, 3600), (7, 3600), (8, 3600), (9, 3600), (10, 3600), (11, 3600)]:
            current = record(post)
            check('bounded backoff after attempt ' + str(attempts), due(post) == current['delivery']['attemptedAt'] + delay)
            tick(due(post))
            cli('retry-due')
        check('twelve failures stop automatic sends', record(post)['delivery']['attempts'] == 12 and next(row for row in rows() if row['subject'] == 'post:' + post)['state'] == 'failed' and cli('retry-due') == [])
        health = json.loads(wp('eval-file', str(cms.ROOT / 'cms/tests/diagnostics.php')).stdout)
        check('Site Health reports exhausted delivery critically and safely', health['health']['status'] == 'critical' and environment['PUBLICATION_EVENT_SECRET'] not in json.dumps(health))
        request('/proof/online')
        wp('gq-events', 'retry', post)
        check('operator retry recovers exhausted same event without another save', record(post)['event'] == failed['event'] and record(post)['delivery']['attempts'] == 13 and saved(post)['content']['entry']['content'] == '<p>Recovered</p>')
        tick(int(time.time()))
        check('recovery is visible to editor', report(post)['state'] == 'recovered' and report(post)['notice']['type'] == 'success')
        # New failure -> automatic recovery through actual shell command path.
        request('/proof/offline')
        first = publish(post, '<p>Automatic recovery</p>')
        tick(due(post))
        request('/proof/online')
        time.sleep(1.05)  # signing uses real wall time; do not mock PHP transport.
        cron()
        check('cron retry delivers the saved event to package public reads', record(post)['event'] == first['event'] and record(post)['delivery']['attempts'] == 2 and saved(post)['content']['entry']['content'] == '<p>Automatic recovery</p>')
        envelopes = [e for e in request('/proof/state')['envelopes'] if e['event']['id'] == first['event']['id']]
        check('retry preserves envelope identity with a fresh timestamp/signature', len(envelopes) == 2 and envelopes[0]['event'] == envelopes[1]['event'] and envelopes[0]['timestamp'] != envelopes[1]['timestamp'] and envelopes[0]['signature'] != envelopes[1]['signature'])
        # Kill a real CMS save process after WP's hooks persist pending work,
        # before shutdown can send it. No hook/transport/scheduler replacements.
        entries = json.loads(fixture.read_text())
        entries['entries']['/retry-' + post + '/']['content'] = '<p>Interrupted save recovered</p>'
        fixture.write_text(json.dumps(entries))
        interrupted = wp('eval', "wp_update_post(['ID'=>" + post + ", 'post_content'=>'Interrupted save']); posix_kill(getmypid(), 9);", ok=False)
        pending = record(post)
        check('killed real CMS save leaves a new persistent pending identity', interrupted.returncode != 0 and pending['delivery']['status'] == 'pending' and pending['delivery']['attempts'] == 0 and pending['event']['id'] != first['event']['id'])
        tick(pending['delivery']['queuedAt'] + 119)
        check('pending record survives commands during request grace', cli('retry-due') == [] and record(post)['delivery']['status'] == 'pending')
        tick(pending['delivery']['queuedAt'] + 120)
        check('interrupted pending record recovers after grace', cli('retry-due')[0]['event'] == pending['event']['id'] and record(post)['delivery']['status'] == 'refreshed' and saved(post)['content']['entry']['content'] == '<p>Interrupted save recovered</p>')
        request('/proof/offline')
        older = publish(post, '<p>Superseded</p>')
        request('/proof/online')
        newer = publish(post, '<p>Newest</p>')
        tick(int(time.time()) + 7200)
        check('new save supersedes failed scheduled work', newer['event']['id'] != older['event']['id'] and cli('retry-due') == [] and saved(post)['content']['entry']['content'] == '<p>Newest</p>')
        # Settings persist separately and recover through the same scheduler.
        previous_description = request('/proof/home')['delivery']['content']['home']['settings']['description']
        request('/proof/offline')
        wp('option', 'update', 'blogdescription', 'Retry settings ' + post)
        entries = json.loads(fixture.read_text())
        entries['identity'] = {'title': wp('option', 'get', 'blogname').stdout.strip(), 'description': wp('option', 'get', 'blogdescription').stdout.strip()}
        fixture.write_text(json.dumps(entries))
        setting = json.loads(wp('option', 'get', 'gq_settings_event_identity', '--format=json').stdout)
        check('failed settings record persists with its own identity', setting['delivery']['status'] == 'failed' and setting['event']['setting'] == 'identity' and request('/proof/home')['delivery']['content']['home']['settings']['description'] == previous_description)
        tick(int(time.time()) + 60)
        request('/proof/online')
        cron()
        recovered = json.loads(wp('option', 'get', 'gq_settings_event_identity', '--format=json').stdout)
        check('settings retry recovers same event across real commands', recovered['event'] == setting['event'] and recovered['delivery']['status'] == 'refreshed' and recovered['delivery']['attempts'] == 2 and request('/proof/home')['delivery']['content']['home']['settings']['description'] == entries['identity']['description'])
        # A deleted post has no post meta: its durable option must drive withdrawal.
        request('/proof/fail-delivery')
        wp('post', 'delete', post, '--force')
        deleted = json.loads(wp('option', 'get', 'gq_publication_events_deleted', '--format=json').stdout)[post]
        check('failed permanent deletion retains withdrawal after post is gone', deleted['event']['action'] == 'withdraw' and deleted['delivery']['status'] == 'failed' and saved(post)['kind'] == 'found' and wp('post', 'get', post, ok=False).returncode != 0)
        request('/proof/accept-delivery')
        tick(int(time.time()) + 60)
        cron()
        remaining = wp('option', 'get', 'gq_publication_events_deleted', '--format=json', ok=False)
        check('cron retries deleted withdrawal and removes only confirmed record', saved(post)['kind'] == 'missing' and (remaining.returncode != 0 or post not in json.loads(remaining.stdout)))
        # Extension callbacks below exercise actual 45-second budget and lock contention.
        budget = extension(cms, environment, baseline, observer, tick, cli, wp, work, check)
        check('delays table retains scheduler report and JSON retains columns', 'The retry scheduler last ran at' in wp('gq-events', 'delays').stdout and isinstance(rows(), list))
        evidence = {'configurationFailure': unconfigured, 'failedPublication': failed, 'automaticRecovery': record(config_post), 'interruptedPending': pending, 'superseded': older, 'newer': newer, 'failedSetting': setting, 'recoveredSetting': recovered, 'deletedWithdrawal': deleted, 'budget': budget, 'freshRetrySignature': True, 'cron': 'actual /bin/sh invocation of wp gq-events retry-due --quiet; no daemon'}
        directory = work
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'retry-records.json').write_text(json.dumps(evidence, indent=2) + '\n')
        print('P2/P6 #8: real installed CMS/CLI, shell server-cron invocation, callback HTTP work and public package reads passed. No cron daemon claimed.', flush=True)
    finally:
        observer.unlink(missing_ok=True)


def extension(cms, environment, baseline, observer, tick, cli, wp, work, check):
    marker = work / 'extension-started'
    marker.unlink(missing_ok=True)
    php = (cms.ROOT / 'cms/tests/retry-extension.php').read_text().replace('<?php', '')
    observer.write_text(baseline + "define('GQ_PROOF_MARKER', " + repr(str(marker)) + ");\n" + php)
    wp('option', 'delete', 'gq_proof_extension', ok=False)
    tick(int(time.time()) + 10000)
    output = work / 'budget.json'
    errors = work / 'budget.stderr'
    # Real concurrent WP-CLI processes, shared installed WordPress database.
    started = time.monotonic()
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        running = executor.submit(wp, 'gq-events', 'retry-due', '--format=json')
        deadline = time.monotonic() + 30
        while not marker.exists() and time.monotonic() < deadline:
            if running.done():
                raise RuntimeError(running.result().stderr)
            time.sleep(.1)
        check('first scheduler starts a real extension callback under lease', marker.exists())
        overlap = wp('gq-events', 'retry-due')
        check('overlapping actual CLI run sends nothing while first callback is active', 'Another run is sending events; nothing sent.' in overlap.stdout and not running.done())
        result = running.result(timeout=90)
    elapsed = time.monotonic() - started
    output.write_text(result.stdout)
    errors.write_text(result.stderr)
    sent = json.loads(result.stdout)
    persisted = json.loads(wp('option', 'get', 'gq_proof_extension', '--format=json').stdout)
    scheduler = json.loads(wp('option', 'get', 'gq_events_scheduler', '--format=json').stdout)
    check('45-second budget bounds real callback HTTP work and defers remainder', 46 <= elapsed < 85 and len(sent) == 2 and len(persisted) == 2 and scheduler['deferred'] == 1)
    check('filter retains row fields and callback-owned persistent outcomes', [r['subject'] for r in sent] == ['proof:0', 'proof:1'] and all(r['label'] == 'Extension check' and r['action'] == 'check' and r['status'] == 'refreshed' and r['attempts'] == 1 for r in sent) and all(r['delivery']['callbackOwned'] is True for r in (persisted.values() if isinstance(persisted, dict) else persisted)))
    # Remaining work uses the same callback without a second long delay.
    observer.write_text(observer.read_text().replace('sleep(23);', ''))
    check('deferred callback runs on next invocation and completed rows stay complete', len(cli('retry-due')) == 1 and len(json.loads(wp('option', 'get', 'gq_proof_extension', '--format=json').stdout)) == 3 and cli('retry-due') == [])
    wp('option', 'add', 'gq_events_retry_lock', str(int(time.time()) - 1))
    check('expired lease from killed process can be recovered', cli('retry-due') == [] and wp('option', 'get', 'gq_events_retry_lock', ok=False).returncode != 0)
    observer.write_text(baseline)

    return {'elapsedSeconds': round(elapsed, 3), 'sent': sent, 'persistedCallbacks': persisted, 'scheduler': scheduler, 'overlap': overlap.stdout.strip()}
