"""Actual isolated cron daemon -> pinned WP-CLI -> installed package/workerd.
No host crontab, WP-Cron, visitor reads or save-triggered recovery.
"""
import datetime
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import urllib.request


def _prove(cms, environment, origin, fixture, control, work):
    check = lambda name, value: cms.check('daemon: ' + name, value)
    directory = work / 'cron'
    if directory.exists():
        shutil.rmtree(directory)
    (directory / 'tabs').mkdir(parents=True)
    observer = cms.SITE / 'web/app/mu-plugins/cron-proof.php'
    exporter = cms.SITE / 'web/app/mu-plugins/reconciliation-proof.php'
    exporter.write_text((cms.ROOT / 'cms/tests/reconciliation-export.php').read_text())
    observer.write_text("<?php\nadd_filter('gq_events_reconcile', '__return_false');\nadd_filter('gq_events_now', fn() => time() + 120);\n")
    ids = json.loads((work / 'ids.json').read_text())
    post = str(ids['story-3'])
    uri = '/en/reconcile-story-3/'
    def wp(*args):
        return cms.wp(*args, env=environment).stdout.strip()
    def record():
        return json.loads(wp('post', 'meta', 'get', post, '_gq_publication_event', '--format=json'))
    def public():
        with urllib.request.urlopen(origin + '/proof/read?uri=' + uri) as response:
            return json.load(response)
    before = public()
    control.write_text('{"offline":true}')
    wp('post', 'update', post, '--post_content=<p>Delivered by actual cron daemon</p>')
    failed = record()
    check('save failure retains failed event and old public content', failed['delivery']['status'] == 'failed' and public() == before)
    control.write_text('{}')
    observer.write_text("<?php\nadd_filter('gq_events_now', fn() => time() + 120);\n")
    missed_post = str(ids['story-7'])
    wp('eval', "global $wpdb; $wpdb->update($wpdb->posts, ['post_content'=>'<p>Missed change repaired by actual cron</p>', 'post_modified_gmt'=>gmdate('Y-m-d H:i:s',time()+5)], ['ID'=>" + missed_post + "]); ")
    check('missed change has no recorded publication event before daemon', cms.wp('post', 'meta', 'get', missed_post, '_gq_publication_event', env=environment, ok=False).returncode != 0)

    check('record is due before daemon starts', any(row['subject'] == 'post:' + post and datetime.datetime.fromisoformat(row['next']).timestamp() <= time.time() + 120 for row in json.loads(wp('gq-events', 'delays', '--format=json'))))
    # The regression must fail while only the earlier /bin/sh proof exists.
    if os.environ.get('GQ_PROOF_DISABLE_DAEMON') == '1':
        check('daemon required: recovery cannot be claimed from a shell-only runner', public()['content']['entry']['content'] == '<p>Delivered by actual cron daemon</p>')
    bindir = directory / 'bin'
    bindir.mkdir()
    clean = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(directory), 'WP_CLI_ALLOW_ROOT': '1', 'WP_ENV': 'production', 'WP_HOME': 'http://p2.test', 'WP_SITEURL': 'http://p2.test/wp', 'DB_NAME': 'p2', 'DB_USER': 'p2', 'DB_PASSWORD': 'p2'} | environment
    # Keep disposable signing configuration in a private temporary launcher only.
    launcher = bindir / 'wp'
    launcher.write_text('#!/bin/sh\n' + 'printf "pid=%s parent=%s cwd=%s uid=%s gid=%s\\n" "$$" "$PPID" "$PWD" "$(id -u)" "$(id -g)" >> ' + shlex.quote(str(directory / 'process.txt')) + '\nexec env -i ' + ' '.join(shlex.quote(k + '=' + v) for k, v in clean.items()) + ' ' + '/usr/local/bin/php' + ' -d error_reporting=24575 -d memory_limit=512M ' + shlex.quote(str(cms.CACHE / 'wp-cli.phar')) + ' --path=' + shlex.quote(str(cms.SITE / 'web/wp')) + ' "$@"\n')
    launcher.chmod(0o700)
    command = 'cd ' + shlex.quote(str(cms.SITE)) + ' && PATH=' + shlex.quote(str(bindir) + ':/usr/local/bin:/usr/bin:/bin') + ' wp gq-events retry-due --quiet > ' + shlex.quote(str(directory / 'stdout')) + ' 2> ' + shlex.quote(str(directory / 'stderr')) + '; echo $? > ' + shlex.quote(str(directory / 'exit'))
    (directory / 'tabs/proof').write_text('* * * * * ' + command + '\n')
    # The daemon needs setgroups to switch to the Site user. A rootless user
    # namespace denies that syscall; use an isolated local container instead.
    # Its job runs as the invoking host uid, against this disposable Site only.
    image = 'wordpress@sha256:668db37ba48bc8d8ec4ca2f22163a1c74d17216c97bf509e327168963a687117'
    passwd = directory / 'passwd'
    passwd.write_text('root:x:0:0:root:/root:/bin/sh\nproof:x:%d:%d:proof:%s:/bin/sh\n' % (os.getuid(), os.getgid(), directory))
    (directory / 'daemon.log').touch()
    name = 'gq-content-proof-cron-' + str(os.getpid())
    daemon_args = ['docker', 'run', '--rm', '--name', name, '--user', '0:0', '--network', 'host',
                   '--mount', 'type=bind,src=' + str(cms.ROOT) + ',dst=' + str(cms.ROOT),
                   '--mount', 'type=bind,src=' + str(passwd) + ',dst=/etc/passwd,readonly',
                   '--entrypoint', '/bin/sh', image, '-c', 'mkdir /tmp/gq-cron && cp ' + shlex.quote(str(directory / 'tabs/proof')) + ' /tmp/gq-cron/proof && chown 0:0 /tmp/gq-cron/proof && exec /usr/sbin/crond -f -l 0 -L ' + shlex.quote(str(directory / 'daemon.log')) + ' -c /tmp/gq-cron']
    started = time.monotonic()
    daemon = subprocess.Popen(daemon_args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
    try:
        process = shlex.join(daemon_args)
        deadline = started + 100
        while not (directory / 'exit').exists() and time.monotonic() < deadline:
            if daemon.poll() is not None:
                raise RuntimeError('cron daemon exited: ' + daemon.stderr.read().decode())
            time.sleep(.2)
        check('actual minute daemon launched pinned WP-CLI in disposable Bedrock', (directory / 'exit').exists() and (directory / 'exit').read_text().strip() == '0' and 'cwd=' + str(cms.SITE) in (directory / 'process.txt').read_text() and 'uid=' + str(os.getuid()) + ' gid=' + str(os.getgid()) in (directory / 'process.txt').read_text())
        elapsed = time.monotonic() - started
        daemon_process = subprocess.run(['docker', 'top', name, '-eo', 'pid,ppid,args'], capture_output=True, text=True, check=True).stdout
    finally:
        subprocess.run(['docker', 'stop', '--time', '3', name], capture_output=True)
        daemon.wait(timeout=15)
        daemon.stderr.close()
        launcher.unlink(missing_ok=True)
        (directory / 'tabs/proof').unlink(missing_ok=True)
        observer.unlink(missing_ok=True)
        exporter.unlink(missing_ok=True)
    recovered = record()
    with urllib.request.urlopen(origin + '/proof/read?uri=/en/reconcile-story-7/') as response:
        missed_delivery = json.load(response)
    reconciliation = json.loads(wp('option', 'get', 'gq_reconciliation', '--format=json'))
    check('daemon also reconciles unrecorded change without visits or saves', missed_delivery['content']['entry']['content'] == '<p>Missed change repaired by actual cron</p>' and reconciliation['status'] == 'reconciled')
    after = public()
    check('daemon alone recovered same event without visits or another save', recovered['event'] == failed['event'] and recovered['delivery']['status'] == 'refreshed' and recovered['delivery']['attempts'] == failed['delivery']['attempts'] + 1 and after['content']['entry']['content'] == '<p>Delivered by actual cron daemon</p>')
    check('quiet scheduler contract holds', 'Success:' not in (directory / 'stdout').read_text())
    check('daemon stopped and isolated schedule/configuration removed', daemon.returncode is not None and not launcher.exists() and not (directory / 'tabs/proof').exists() and not observer.exists())
    evidence = {'implementation': 'BusyBox crond 1.37.0 (Alpine; built 2026-01-10); PHP 8.4.26; pinned WordPress CLI container', 'image': image, 'namespace': 'isolated container; job maps to invoking uid/gid; no host schedules changed', 'daemonCommand': daemon_args, 'processAtLaunch': process, 'dockerClientPid': daemon.pid, 'daemonProcesses': daemon_process, 'jobProcess': (directory / 'process.txt').read_text().strip(), 'schedule': '* * * * * cd <disposable Bedrock> && PATH=<pinned launcher> wp gq-events retry-due --quiet', 'elapsedSeconds': round(elapsed, 3), 'failed': failed, 'recovered': recovered, 'before': before, 'after': after, 'exit': (directory / 'exit').read_text().strip(), 'missedDelivery': missed_delivery, 'reconciliation': reconciliation, 'controlledClock': 'gq_events_now +120 seconds makes retry due; daemon still waits for real wall-clock minute', 'cleanup': True, 'boundary': 'actual local cron daemon, WordPress, installed Composer plugin, signed HTTP, installed npm package and workerd/D1; GraphQL-only snapshot boundary; no Ploi provisioning or PHP-FPM claim'}
    (work / 'daemon.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print('P2/P6 actual cron daemon → pinned WP-CLI → installed package/workerd delivery passed; elapsed %.3fs; container and schedule cleaned.' % elapsed, flush=True)


def prove(cms, environment, origin, fixture, control, work):
    try:
        return _prove(cms, environment, origin, fixture, control, work)
    finally:
        # Also clean failed setup/red runs, before any daemon was launched.
        for name in ['cron-proof.php', 'reconciliation-proof.php']:
            (cms.SITE / 'web/app/mu-plugins' / name).unlink(missing_ok=True)
        for name in ['bin/wp', 'tabs/proof']:
            (work / 'cron' / name).unlink(missing_ok=True)
        control.write_text('{}')
