#!/usr/bin/env python3
"""P2: a fresh real Composer-installed Bedrock/WordPress/WP-CLI consumer."""
import base64
import hashlib
import json
import os
import re
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.proofs/p2'
SITE = WORK / 'bedrock'
CACHE = WORK / 'downloads'


def run(args, cwd=ROOT, env=None, ok=True):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True)
    if ok and result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}):\n{result.stderr}\n{result.stdout}')
    return result


def download(name, url):
    path = CACHE / name
    if not path.exists():
        run(['curl', '-fsSL', '--retry', '3', '-o', str(path), url])
    return path


def wp(*args, env=None, ok=True):
    clean = {key: value for key, value in os.environ.items() if key not in [
        'GQ_CONTENT_SITE_ID', 'GETQUICK_FRONTEND_URL', 'PUBLICATION_EVENT_SECRET',
        'WP_ENV', 'WP_ENVIRONMENT_TYPE', 'DATABASE_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']}
    clean.update({'WP_ENV': 'development', 'WP_HOME': 'http://p2.test',
                  'WP_SITEURL': 'http://p2.test/wp', 'DB_NAME': 'p2',
                  'DB_USER': 'p2', 'DB_PASSWORD': 'p2', 'WP_CLI_ALLOW_ROOT': '1',
                  'WP_CLI_CACHE_DIR': str(WORK / 'wp-cli-cache')})
    clean.update(env or {})
    return run(['php', '-d', 'error_reporting=24575', '-d', 'memory_limit=512M',
                str(CACHE / 'wp-cli.phar'), f'--path={SITE}/web/wp', *args],
               cwd=SITE, env=clean, ok=ok)


def without_fields(query):
    """Remove only optional Design/blocks fields absent from P2's bare WordPress."""
    start = query.index('designTokens {')
    depth, end = 0, start
    for end in range(start, len(query)):
        depth += {'{': 1, '}': -1}.get(query[end], 0)
        if depth == 0 and query[end] == '}':
            break
    query = query[:start] + query[end + 1:]
    query = re.sub(r'blocks\([^)]*\)\s*@include\(if: \$withBlocks\)', '', query)
    query = re.sub(r'getquickBlocksJson\s*@include\(if: \$withBlocks\)', '', query)
    return query.replace(', $withBlocks: Boolean = true', '')


def check(name, condition):
    assert condition, name
    print('PASS ' + name, flush=True)


if __name__ == '__main__':
    for source in sorted((ROOT / 'cms').rglob('*.php')):
        run(['php', '-l', str(source)])
    print('PASS PHP syntax for entry, modules and proof fixtures', flush=True)
    run(['composer', 'validate', '--no-check-publish'], cwd=ROOT / 'cms')
    print('PASS Composer package metadata validation', flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    artifact = Path(run(['python3', 'scripts/cms-package.py']).stdout.strip())
    with zipfile.ZipFile(artifact) as archive:
        package = json.loads(archive.read('composer.json'))
        check('plugin-root archive with one public PHP entry',
              'composer.json' in archive.namelist() and
              [name for name in archive.namelist() if '/' not in name and name.endswith('.php')] == ['gq-content.php'])
    if SITE.exists():
        shutil.rmtree(SITE)
    run(['composer', 'create-project', 'roots/bedrock', str(SITE), '1.31.7',
         '--no-install', '--no-scripts', '--no-interaction'])
    manifest = json.loads((SITE / 'composer.json').read_text())
    manifest['require']['roots/bedrock-autoloader'] = '1.1.0'
    manifest['require']['getquick/gq-content'] = '0.4.0'
    manifest['require-dev'] = {}
    package['dist'] = {'type': 'zip', 'url': artifact.as_uri(),
                       'reference': hashlib.sha256(artifact.read_bytes()).hexdigest(),
                       'shasum': hashlib.sha1(artifact.read_bytes()).hexdigest()}
    manifest['repositories'].insert(0, {'type': 'package', 'package': package})
    (SITE / 'composer.json').write_text(json.dumps(manifest, indent=2))
    run(['composer', 'install', '--no-interaction', '--no-scripts', '--prefer-dist'], cwd=SITE)
    with zipfile.ZipFile(artifact) as archive:
        check('Composer installed the current ZIP bytes without stale cache', all(
            (SITE / 'web/app/mu-plugins/gq-content' / name).read_bytes() == archive.read(name)
            for name in archive.namelist()))
    download('wp-cli.phar', 'https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar')
    sqlite_zip = download('sqlite-3.1.0.zip', 'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.0.zip')
    plugins = SITE / 'web/app/plugins'
    with zipfile.ZipFile(sqlite_zip) as archive:
        archive.extractall(plugins)
    sqlite = plugins / 'sqlite-database-integration'
    (SITE / 'web/app/db.php').write_text((sqlite / 'db.copy').read_text()
        .replace('{SQLITE_IMPLEMENTATION_FOLDER_PATH}', str(sqlite))
        .replace('{SQLITE_PLUGIN}', 'sqlite-database-integration/load.php'))
    # Site-owned configuration before WordPress bootstrap, never a plugin loader.
    with (SITE / 'config/application.php').open('a') as config:
        config.write("\nrequire __DIR__ . '/proof.php';\n")
    (SITE / 'config/proof.php').write_text('<?php\n')
    wp('core', 'install', '--url=http://p2.test', '--title=P2', '--admin_user=proof',
       '--admin_password=disposable-local-proof', '--admin_email=proof@example.test', '--skip-email')
    check('real WordPress boots Composer-installed MU plugin',
          wp('eval', "echo is_file(WPMU_PLUGIN_DIR . '/gq-content/gq-content.php') && function_exists('GetQuick\\\\Site\\\\SettingsEvents\\\\changed') ? 'loaded' : 'missing';").stdout.strip() == 'loaded')
    check('bare version works without event configuration', wp('gq-events', 'version').stdout.strip() == '0.4.0')
    check('JSON version works without event configuration',
          json.loads(wp('gq-events', 'version', '--format=json').stdout) ==
          {'package': 'getquick/gq-content', 'version': '0.4.0'})
    diagnostics = json.loads(wp('eval-file', str(ROOT / 'cms/tests/diagnostics.php'),
                                env={'WP_ENV': 'production'}).stdout)
    check('production Site Health reports missing configuration safely',
          diagnostics['health']['status'] == 'critical' and
          diagnostics['fields']['configured']['value'] is False)
    check('all five modules load once in dependency order through Bedrock',
          wp('eval-file', str(ROOT / 'cms/tests/loading.php')).stdout.strip() == 'loaded-once-in-order')

    # An external HTTP receiver checks actual WordPress transport/signatures.
    # It acknowledges receipt only; it does not model the Frontend/store.
    received = []
    key = 'p2-local-disposable-signing-key-at-least-32'

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            timestamp = self.headers['GQ-Event-Timestamp']
            signature = 'v1=' + hmac.new(key.encode(), timestamp.encode() + b'.' + body, 'sha256').hexdigest()
            received.append({'path': self.path, 'event': json.loads(body),
                             'signed': hmac.compare_digest(signature, self.headers['GQ-Event-Signature'])})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"reconciled"}')

        def log_message(self, *_args):
            pass

    receiver = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
    thread = threading.Thread(target=receiver.serve_forever, daemon=True)
    thread.start()
    base = {'WP_ENV': 'production', 'GETQUICK_FRONTEND_URL': f'http://127.0.0.1:{receiver.server_port}',
            'PUBLICATION_EVENT_SECRET': key}

    def configure(php=''):
        (SITE / 'config/proof.php').write_text('<?php\n' + php + '\n')

    def info(env):
        return json.loads(wp('eval-file', str(ROOT / 'cms/tests/diagnostics.php'), env=env).stdout)

    try:
        # Defined constants win over a valid process value even if invalid.
        invalid = [('absent', '', {}), ('empty environment', '', {'GQ_CONTENT_SITE_ID': ''}),
                   ('blank environment', '', {'GQ_CONTENT_SITE_ID': '  \t '}),
                   *[(f'invalid constant {value}', f"define('GQ_CONTENT_SITE_ID', {value});",
                      {'GQ_CONTENT_SITE_ID': 'environment-must-not-win'})
                     for value in ["''", "'  '", '123', 'true', 'false', 'null', '[]']]]
        for name, php, environment in invalid:
            configure(php)
            env = base | environment
            before = len(received)
            diagnostics = info(env)
            check(name + ': unconfigured and critical in production',
                  diagnostics['fields']['configured']['value'] is False and
                  diagnostics['health']['status'] == 'critical' and
                  'GQ_CONTENT_SITE_ID' in diagnostics['health']['description'])
            wp('option', 'delete', 'gq_settings_event_identity', env=env, ok=False)
            post = wp('eval-file', str(ROOT / 'cms/tests/save.php'), env=env).stdout.strip()
            check(name + ': saves work without retaining malformed publication/settings events',
                  post.isdigit() and
                  wp('post', 'meta', 'get', post, '_gq_publication_event', env=env, ok=False).returncode != 0 and
                  wp('option', 'get', 'gq_settings_event_identity', env=env, ok=False).returncode != 0)
            for command in [('check',), ('retry', post), ('settings', 'retry', 'identity'),
                            ('reconcile',), ('retry-due', '--quiet')]:
                result = wp('gq-events', *command, env=env, ok=False)
                check(name + ': CLI ' + ' '.join(command) + ' safely refuses configuration',
                      result.returncode != 0 and 'GQ_CONTENT_SITE_ID' in result.stderr and
                      key not in result.stderr + result.stdout)
            check(name + ': no guessed or malformed event sent', len(received) == before)
        configure()
        post = wp('eval-file', str(ROOT / 'cms/tests/save.php')).stdout.strip()
        check('unconfigured development saves without sending or retaining events',
              wp('post', 'meta', 'get', post, '_gq_publication_event', ok=False).returncode != 0 and
              info({})['fields']['configured']['value'] is False)

        # The manifest accepts nonempty strings, including identities that are not slugs.
        for name, php, identity in [
            ('process environment', '', '  Manifest Site / Á:01  '),
            ('constant precedence', "define('GQ_CONTENT_SITE_ID', '  Constant Site / Á:02  ');", 'ignored-env')]:
            configure(php)
            expected = 'Manifest Site / Á:01' if not php else 'Constant Site / Á:02'
            env = base | {'GQ_CONTENT_SITE_ID': identity}
            diagnostics = info(env)
            check(name + ': Site Health debug package/version/configured',
                  {name: row['value'] for name, row in diagnostics['fields'].items()} ==
                  {'package': 'getquick/gq-content', 'version': '0.4.0', 'configured': True,
                   'forms': 'dormant (Gravity Forms inactive)'})
            start = len(received)
            wp('gq-events', 'check', env=env)
            post = wp('eval-file', str(ROOT / 'cms/tests/save.php'), env=env).stdout.strip()
            record = json.loads(wp('post', 'meta', 'get', post, '_gq_publication_event', '--format=json', env=env).stdout)
            settings = json.loads(wp('option', 'get', 'gq_settings_event_identity', '--format=json', env=env).stdout)
            check(name + ': publication/settings preserve identities and delivery record keys',
                  record['event']['site'] == expected and record['event']['action'] == 'publish' and
                  record['delivery']['status'] == 'refreshed' and record['delivery']['attempts'] == 1 and
                  settings['event']['site'] == expected and settings['event']['action'] == 'settings' and
                  settings['delivery']['status'] == 'refreshed')
            check(name + ': real HTTP envelopes are trimmed, signed and use existing endpoint',
                  len(received) == start + 3 and all(row['signed'] and row['path'] == '/gq/events' and
                  row['event']['site'] == expected for row in received[start:]))
            wp('gq-events', 'retry', post, env=env)
            wp('gq-events', 'settings', 'retry', 'identity', env=env)
            wp('gq-events', 'reconcile', env=env)
            quiet = wp('gq-events', 'retry-due', '--quiet', env=env)
            check(name + ': retry/reconcile commands and quiet cron contract remain usable', quiet.stdout == '' and
                  info(env)['health']['status'] == 'good')
            for command in [('status',), ('settings', 'status'), ('delays',)]:
                check(name + ': ' + ' '.join(command) + ' retains JSON rows',
                      isinstance(json.loads(wp('gq-events', *command, '--format=json', env=env).stdout), list))
        # GQ Design's Header & Footer reads synced patterns and templates: a
        # change to either is one shared "patterns" settings event.
        start = len(received)
        wp('eval', "wp_insert_post(['post_type' => 'wp_block', 'post_status' => 'publish', 'post_title' => 'Header', 'post_content' => '<!-- wp:paragraph --><p>Header</p><!-- /wp:paragraph -->']);", env=env)
        patterns = json.loads(wp('option', 'get', 'gq_settings_event_patterns', '--format=json', env=env).stdout)
        check('a synced pattern save sends one shared patterns settings event',
              patterns['event']['setting'] == 'patterns' and 'language' not in patterns['event'] and
              patterns['delivery']['status'] == 'refreshed' and
              [row['event'].get('setting') for row in received[start:]] == ['patterns'])
        # Each source hook must work independently, not merely as part of a
        # request where another source also changed. All use real core saves.
        for post_type in ['wp_block', 'wp_template', 'wp_template_part', 'wp_navigation']:
            start = len(received)
            post_id = wp('post', 'create', f'--post_type={post_type}', '--post_status=publish',
                         '--post_title=Chrome hook fixture', '--porcelain', env=env).stdout.strip()
            check(post_type + ': save notifies patterns',
                  [row['event'].get('setting') for row in received[start:]] == ['patterns'])
            for status in ['draft', 'publish', 'private', 'publish', 'trash', 'publish']:
                start = len(received)
                wp('post', 'update', post_id, f'--post_status={status}', env=env)
                check(post_type + ': status ' + status + ' notifies patterns',
                      [row['event'].get('setting') for row in received[start:]] == ['patterns'])
            if post_type == 'wp_block':
                for operation in [('update', 'unsynced'), ('delete',)]:
                    start = len(received)
                    wp('post', 'meta', operation[0], post_id, 'wp_pattern_sync_status', *operation[1:], env=env)
                    check('pattern sync eligibility ' + operation[0] + ' notifies patterns',
                          [row['event'].get('setting') for row in received[start:]] == ['patterns'])
            start = len(received)
            wp('post', 'delete', post_id, '--force', env=env)
            check(post_type + ': deletion notifies patterns',
                  [row['event'].get('setting') for row in received[start:]] == ['patterns'])
        start = len(received)
        wp('eval', "do_action('getquick_design_cache_invalidated', ['design:test'], ['post:123']); do_action('getquick_design_cache_invalidated', ['design:test'], ['attachment:123']);", env=env)
        check('Design dependency invalidations coalesce to one signed shared patterns event',
              len(received[start:]) == 1 and received[-1]['signed'] and
              received[-1]['event'].get('setting') == 'patterns' and
              'language' not in received[-1]['event'])
        # A classic menu a pattern shows by id (a menu-backed block's menuId),
        # at no theme location, refreshes the patterns; others send nothing.
        shown = wp('menu', 'create', 'Footer links', '--porcelain', env=env).stdout.strip()
        unshown = wp('menu', 'create', 'Unused links', '--porcelain', env=env).stdout.strip()
        start = len(received)
        nested = ('<!-- wp:group --><div class="wp-block-group"><!-- wp:getquick/header-navigation {"menuId":'
                  + shown + '} /--></div><!-- /wp:group -->')
        source = wp('post', 'create', '--post_type=wp_template_part', '--post_status=publish',
                    '--post_title=Menu footer', '--porcelain', f'--post_content={nested}', env=env).stdout.strip()
        check('a template part showing a menu by id notifies patterns',
              [row['event'].get('setting') for row in received[start:]] == ['patterns'])
        index = json.loads(wp('option', 'get', 'gq_settings_pattern_menus', '--format=json', env=env).stdout)
        check('the menu a pattern shows is indexed, not scanned for', index.get(source) == [int(shown)])
        start = len(received)
        wp('menu', 'item', 'add-custom', shown, 'Contact', 'https://example.test/contact/', env=env)
        check('a menu item saved in a menu a pattern shows notifies patterns once',
              [row['event'].get('setting') for row in received[start:]] == ['patterns'])
        start = len(received)
        wp('menu', 'item', 'add-custom', unshown, 'Elsewhere', 'https://example.test/', env=env)
        check('a menu shown nowhere notifies nothing', received[start:] == [])
        # A Site whose index predates this package's (or was lost) builds it once.
        wp('option', 'delete', 'gq_settings_pattern_menus', env=env)
        start = len(received)
        wp('menu', 'item', 'add-custom', shown, 'Jobs', 'https://example.test/jobs/', env=env)
        check('a missing index is rebuilt from existing patterns',
              [row['event'].get('setting') for row in received[start:]] == ['patterns'])
        wp('post', 'delete', source, '--force', env=env)
        start = len(received)
        wp('menu', 'item', 'add-custom', shown, 'Press', 'https://example.test/press/', env=env)
        check('a menu no pattern shows any longer notifies nothing', received[start:] == [] and
              source not in json.loads(wp('option', 'get', 'gq_settings_pattern_menus', '--format=json', env=env).stdout))
        wp('menu', 'delete', shown, unshown, env=env)
        start = len(received)
        wp('eval', "do_action('switch_theme');", env=env)
        check('theme changes coalesce design, menus and patterns independently',
              sorted(row['event'].get('setting') for row in received[start:]) == ['design', 'menus', 'patterns'])
        configure("function getquick_config_frontend_url() { return getenv('P2_HELPER_URL'); }")
        env = base | {'GQ_CONTENT_SITE_ID': 'endpoint-proof',
                      'P2_HELPER_URL': base['GETQUICK_FRONTEND_URL'] + '/helper',
                      'GETQUICK_FRONTEND_URL': 'http://127.0.0.1:1/must-not-win'}
        wp('gq-events', 'check', env=env)
        check('gq-config helper endpoint takes precedence', received[-1]['path'] == '/helper/gq/events')
        env['P2_HELPER_URL'] = ''
        env['GETQUICK_FRONTEND_URL'] = base['GETQUICK_FRONTEND_URL'] + '/fallback'
        wp('gq-events', 'check', env=env)
        check('empty helper falls back to GETQUICK_FRONTEND_URL', received[-1]['path'] == '/fallback/gq/events')
        for name, changes in [('missing endpoint', {'GETQUICK_FRONTEND_URL': ''}),
                              ('missing secret', {'PUBLICATION_EVENT_SECRET': ''}),
                              ('short secret', {'PUBLICATION_EVENT_SECRET': 'short'})]:
            configure()
            env = base | {'GQ_CONTENT_SITE_ID': 'valid-site'} | changes
            start = len(received)
            diagnostics = info(env)
            post = wp('eval-file', str(ROOT / 'cms/tests/save.php'), env=env).stdout.strip()
            record = json.loads(wp('post', 'meta', 'get', post, '_gq_publication_event', '--format=json', env=env).stdout)
            settings = json.loads(wp('option', 'get', 'gq_settings_event_identity', '--format=json', env=env).stdout)
            check(name + ': production retains valid failed records and reports unconfigured',
                  record['event']['site'] == 'valid-site' and
                  record['delivery']['status'] == 'failed' and record['delivery']['reason'] == 'not-configured' and
                  settings['delivery']['status'] == 'failed' and settings['delivery']['reason'] == 'not-configured' and
                  diagnostics['fields']['configured']['value'] is False and
                  diagnostics['health']['status'] == 'critical' and len(received) == start)
        configure("define('GQ_CONTENT_SITE_ID', false);")
        check('version remains available with an invalid defined identity',
              json.loads(wp('gq-events', 'version', '--format=json', env=base).stdout) ==
              {'package': 'getquick/gq-content', 'version': '0.4.0'})

        # Archives (ADR 0005): real WPGraphQL (the version Nomia runs) resolves
        # an assigned Page at its custom post type's archive URI.
        with zipfile.ZipFile(download('wp-graphql-2.24.2.zip',
                                      'https://downloads.wordpress.org/plugin/wp-graphql.2.24.2.zip')) as archive:
            archive.extractall(plugins)
        wp('plugin', 'activate', 'wp-graphql')
        shutil.copy(ROOT / 'cms/tests/archives-fixture.php', SITE / 'web/app/mu-plugins/proof-collections.php')
        configure()
        env = base | {'GQ_CONTENT_SITE_ID': 'archives-proof'}
        wp('rewrite', 'structure', '/%postname%/', env=env)

        def step(name):
            return json.loads(wp('eval-file', str(ROOT / 'cms/tests/archives.php'),
                                 env=env | {'ARCHIVES_STEP': name}).stdout)

        def sent(start, test):
            return [row for row in received[start:] if row['signed'] and test(row['event'])]

        start = len(received)
        ids = step('setup')
        check('a public custom post type\'s item is published as an event at its URI',
              sent(start, lambda event: event['action'] == 'publish' and
                   event['entry']['uri'] == '/biblioteca/lei/' and
                   event['entry']['id'] == base64.b64encode(f'post:{ids["item"]}'.encode()).decode()))
        before = step('before')
        check('without an archive Page, the type\'s own archive claims its URI',
              before['archive'] == 'ContentType' and before['item'] == 'Biblioteca' and
              before['archives']['biblioteca'] == {'uri': '/biblioteca/', 'page': None} and
              before['archives']['eventos'] == {'uri': '/eventos/', 'page': None})
        start = len(received)
        assigned = step('assign')
        check('the setting keeps public custom post types, one per existing Page',
              assigned['sanitized'] == {'biblioteca': ids['page']} and
              assigned['option'] == {'biblioteca': ids['page']})
        check('saving the archives sends an archives settings event',
              sent(start, lambda event: event['action'] == 'settings' and event['setting'] == 'archives'))
        after = step('after')
        check('the assigned Page takes over its type\'s archive URI, and the items keep theirs',
              after['archive'] == 'Page' and after['item'] == 'Biblioteca' and
              after['other'] == 'ContentType' and not after['archive_rule'] and after['item_rule'])
        check('getquickArchives says where each archive is: the Page, else the type\'s own',
              after['archives']['biblioteca'] == {'uri': '/biblioteca/', 'page': ids['page']} and
              after['archives']['eventos'] == {'uri': '/eventos/', 'page': None})
        check('Site Health finds every published page reachable at its address', after['health'] == 'good')
        collision = step('collide')
        check('Site Health names a page a custom post type\'s item rule hides',
              collision == {'pages': ['/biblioteca/legislacao/'], 'status': 'recommended'})
        run(['vp', 'pack'])
        queries = json.loads(run(['node', 'scripts/collection-queries.mjs']).stdout)
        queries['EntryByUri'] = without_fields(queries['EntryByUri'])
        ran = json.loads(wp('eval-file', str(ROOT / 'cms/tests/archives.php'),
                            env=env | {'ARCHIVES_STEP': 'queries', 'ARCHIVES_QUERIES': json.dumps(queries)}).stdout)
        item = ran['entry'].get('data', {}).get('node') or {}
        check('the runtime\'s item read is valid WPGraphQL, with its type\'s terms',
              'errors' not in ran['entry'] and item.get('__typename') == 'Biblioteca' and
              item.get('excerpt', '').strip() == '<p>Resumo</p>' and item.get('status') == 'publish' and
              {'slug': 'legislacao', 'name': 'Legislação', 'taxonomyName': 'category'} in item['terms']['nodes'])
        check('configured custom post types retain their existing read without inferred canonical blocks',
              'getquickBlocksJson' not in item and 'terms' in item)
        check('the same read finds the archive Page at the archive URI, as a page',
              'errors' not in ran['page'] and ran['page']['data']['node']['__typename'] == 'Page')
        schema = ran['archives'].get('data') or {}
        check('the runtime\'s archives read is valid WPGraphQL, with the shown types and taxonomies',
              'errors' not in ran['archives'] and
              {'postType': 'biblioteca', 'uri': '/biblioteca/'} in schema['getquickArchives'] and
              'biblioteca' in [node['name'] for node in schema['contentTypes']['nodes']] and
              {'name': 'category'} in schema['taxonomies']['nodes'])
        types = {node['name']: node for node in schema['contentTypes']['nodes']}
        check('the same read names each type\'s GraphQL type and the taxonomies connected to it',
              types['biblioteca']['graphqlSingleName'] == 'Biblioteca' and
              types['eventos']['graphqlSingleName'] == 'Evento' and
              {'name': 'category'} in types['biblioteca']['connectedTaxonomies']['nodes'] and
              not (types['eventos']['connectedTaxonomies'] or {}).get('nodes'))
        listed = (ran['routes'].get('data') or {}).get('contentNodes') or {}
        uris = {node['uri'] for node in listed.get('nodes', [])}
        check('the runtime\'s published routes listing is valid WPGraphQL, with the collections\' types',
              'errors' not in ran['routes'] and '/biblioteca/lei/' in uris and '/biblioteca/' in uris and
              all(node['id'] and node['modifiedGmt'] for node in listed['nodes']))
        start = len(received)
        step('trash')
        trashed = step('trashed')
        check('a trashed archive Page is no archive, and its trashing is an archives event',
              trashed['archives']['biblioteca'] == {'uri': None, 'page': None} and
              sent(start, lambda event: event['action'] == 'settings' and event['setting'] == 'archives'))
        deleted = step('delete')
        check('deleting an archive Page unassigns it', deleted['deleted'] and not deleted['option'])
        restored = step('deleted')
        check('an unassigned type has its own archive again',
              restored['archive'] == 'ContentType' and
              restored['archives']['biblioteca'] == {'uri': '/biblioteca/', 'page': None})
        screen = step('screen')
        check('GETQUICK → Archives (under Settings without gq-config) offers a Page for each type',
              screen['menu'] == ['options-general.php'] and screen['select'] and screen['sanitized'])

        # Headless Gravity Forms (gq-platform ADR 0009): dormant without
        # Gravity Forms; with P2's stand-in for it, every public entry's
        # referenced forms' public descriptors in real WPGraphQL.
        forms_env = env | {'GQ_CONTENT_SITE_ID': 'forms-proof'}

        def forms_step(name, extra=None):
            return json.loads(wp('eval-file', str(ROOT / 'cms/tests/forms.php'),
                                 env=forms_env | {'FORMS_STEP': name} | (extra or {})).stdout)

        dormant = forms_step('dormant')
        check('without Gravity Forms the forms module is dormant: no getquickForms field',
              dormant['active'] is False and not dormant['page'] and not dormant['node'] and
              dormant['status'] == {'gravityForms': {'active': False, 'version': None}, 'forms': [], 'ok': True})
        shutil.copy(ROOT / 'cms/tests/forms-fixture.php', SITE / 'web/app/mu-plugins/proof-gravityforms.php')
        try:
            forms_step('setup')
            run(['vp', 'pack'])
            # P2's bare WordPress lacks the Design/blocks fields, and with them $withBlocks.
            form_queries = {name: without_fields(query).replace('getquickForms @include(if: $withBlocks)', 'getquickForms')
                            .replace('HomePage($withBlocks: Boolean = true)', 'HomePage')
                            for name, query in
                            json.loads(run(['node', 'scripts/forms-queries.mjs']).stdout).items()}
            read = forms_step('read', {'FORMS_QUERIES': json.dumps(form_queries)})
            check('with Gravity Forms every content node has getquickForms',
                  read['active'] and read['page'] and read['post'] and read['node'])
            contact = (read['contactos'].get('forms') or [None])[0] or {}
            check('a page\'s referenced form (in nested blocks) is delivered as its public descriptor',
                  [form['id'] for form in read['contactos']['forms']] == [1] and contact['available'] and
                  contact['title'] == 'Contactos' and contact['description'] == 'Envie-nos uma mensagem.' and
                  contact['submitLabel'] == 'Enviar' and
                  [field['id'] for field in contact['fields']] == [1, 2, 3, 4, 5, 8] and
                  contact['fields'][0]['inputs'] == [
                      {'id': '1.3', 'name': 'input_1_3', 'label': 'Nome próprio', 'autocomplete': 'given-name'},
                      {'id': '1.6', 'name': 'input_1_6', 'label': 'Apelido', 'autocomplete': 'family-name'}] and
                  'defaultValue' not in contact['fields'][2] and contact['fields'][2]['maxLength'] == 120 and
                  contact['fields'][4]['consent'] == {'checkboxLabel': 'Aceito o tratamento dos meus dados.',
                                                      'description': 'Os dados servem apenas para responder.',
                                                      'revisionId': '3'} and
                  [input['name'] for input in contact['fields'][4]['inputs']] == ['input_5_1', 'input_5_2', 'input_5_3'] and
                  contact['fields'][5]['choices'] == [{'text': 'Geral', 'value': 'geral', 'selected': True},
                                                     {'text': 'Imprensa', 'value': 'Imprensa', 'selected': False}] and
                  contact['honeypot'] == {'name': 'input_9'} and
                  contact['confirmation'] == {'type': 'message', 'message': 'Obrigado, !'} and
                  contact['diagnostics'] == [])
            check('the descriptor carries no notification, entry, feed or admin data',
                  not re.search(r'notifications|secretariado|arquivo@|personalData|adminLabel|reply-to|'
                                r'limitEntries|requireLogin|honeypotAction|Interno|entries|feeds',
                                read['contactos']['json']))
            unsupported = read['candidatura']['forms'][0]
            check('unsupported fields and settings are diagnostics, and left out of the fields',
                  [(each['code'], each.get('fieldId')) for each in unsupported['diagnostics']] == [
                      ('unsupported-captcha', 1), ('unsupported-file-upload', 2), ('unsupported-payment', 3),
                      ('unsupported-multi-page', 4), ('unsupported-conditional-logic', 5),
                      ('unsupported-field', 6), ('unsupported-payment', 7), ('requires-login', None)] and
                  [field['id'] for field in unsupported['fields']] == [5] and
                  unsupported['confirmation'] == {'type': 'redirect', 'url': 'https://nomia.test/obrigado/'})
            check('a shortcode (by its own id) and a nested synced pattern\'s form are referenced; an inactive form is unavailable',
                  [form['id'] for form in read['candidatura']['forms']] == [2] and read['padrao']['forms'][0]['id'] == 3 and read['padrao']['forms'][0]['available'] is False and
                  read['padrao']['forms'][0]['diagnostics'][0]['code'] == 'unavailable')
            check('a password-protected entry delivers no descriptors; one without forms delivers none',
                  read['protegida'] is None and read['sem']['forms'] == [])
            runtime_reads = read['runtime']
            check('the runtime\'s forms reads (front page, page, collection node) are valid WPGraphQL',
                  all('errors' not in result for result in runtime_reads.values()) and
                  json.loads(runtime_reads['EntryByUri']['data']['pageBy']['getquickForms'])[0]['id'] == 1 and
                  json.loads(runtime_reads['NodeByUri']['data']['node']['getquickForms'])[0]['id'] == 1)

            ids = {name: wp('post', 'list', '--post_type=page', f'--name={name}', '--field=ID').stdout.strip()
                   for name in ['contactos', 'candidatura', 'padrao', 'protegida']}
            start = len(received)
            saved = forms_step('save')
            published = [row['event']['entry']['uri'] for row in received[start:]
                         if row['signed'] and row['event']['action'] == 'publish']
            check('saving a form publishes again exactly the public entries that reference it',
                  saved['queued'] == [int(ids['contactos'])] and published == ['/contactos/'])
            start = len(received)
            confirmations = forms_step('confirmations')
            check('saving a form\'s confirmations publishes its entries again; notifications don\'t',
                  confirmations['queued'] == [int(ids['candidatura'])] and
                  [row['event']['entry']['uri'] for row in received[start:] if row['signed']] == ['/candidatura/'])
            start = len(received)
            trashed = forms_step('trash')
            check('trashing a form publishes again the entries that show it through nested synced patterns',
                  trashed['queued'] == [int(ids['padrao'])] and
                  [row['event']['entry']['uri'] for row in received[start:] if row['signed']] == ['/padrao/'])
            report = forms_step('status')
            check('wp gq-forms status reports each referenced form, its diagnostics and where it is',
                  report['gravityForms'] == {'active': True, 'version': '3.2.0-proof'} and report['ok'] is False and
                  [(form['id'], form['referencedBy'], [d['code'] for d in form['diagnostics']][:1]) for form in report['forms']] ==
                  [(1, ['/contactos/'], []), (2, ['/candidatura/'], ['unsupported-captcha']), (3, ['/padrao/'], ['unavailable'])])
            cli = wp('gq-forms', 'status', '--format=json', env=forms_env, ok=False)
            check('the readiness command fails while a referenced form has diagnostics',
                  cli.returncode == 1 and json.loads(cli.stdout)['ok'] is False)
            check('Site Health names the forms module\'s state',
                  forms_step('debug') == {'label': 'Headless Gravity Forms', 'value': 'active'})
        finally:
            (SITE / 'web/app/mu-plugins/proof-gravityforms.php').unlink(missing_ok=True)
    finally:
        configure()
        receiver.shutdown()
        receiver.server_close()
        thread.join()

    print(run(['php', '--version']).stdout.splitlines()[0])
    print(run(['composer', '--version']).stdout.strip())
    print(wp('--version').stdout.strip())
    print('WordPress ' + wp('core', 'version').stdout.strip())
    locked = json.loads((SITE / 'composer.lock').read_text())
    print('Bedrock project 1.31.7; SQLite integration 3.1.0; WPGraphQL 2.24.2')
    for package in locked['packages']:
        print(package['name'] + ' ' + package['version'])
