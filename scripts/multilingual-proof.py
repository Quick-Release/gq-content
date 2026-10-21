#!/usr/bin/env python3
"""#7 P2/P6: real Polylang settings -> installed package -> stored public reads."""
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
WORK = ROOT / '.proofs/multilingual'
WORK.mkdir(parents=True, exist_ok=True)
consumer = WORK / 'consumer'
if consumer.exists():
    shutil.rmtree(consumer)
consumer.mkdir()
prepare_npm(ROOT, WORK)
(consumer / 'package.json').write_text(json.dumps({'private': True, 'type': 'module', 'packageManager': 'pnpm@12.11.2', 'dependencies': {'@getquick/content': 'file:' + str(WORK / 'getquick-content-0.1.0.tgz')}}))
subprocess.run(['vp', 'install', '--ignore-scripts'], cwd=consumer, check=True)
shutil.copy(ROOT / 'scripts/pair-receiver.mjs', consumer)
shutil.copy(ROOT / 'frontend/tests/support/sqlite-d1.ts', consumer)
fixture = WORK / 'graphql.json'
fixture.write_text(json.dumps({'entries': {}}))
secret = 'pair-local-disposable-signing-key-0123456789'
token = 'pair-local-disposable-refresh-key-0123456789'
env = os.environ | {'PAIR_DATABASE': str(WORK / 'store.sqlite'), 'PAIR_FIXTURE': str(fixture), 'PAIR_SECRET': secret, 'PAIR_TOKEN': token, 'PAIR_MULTILINGUAL': '1'}
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
    environment = {'WP_ENV': 'production', 'GQ_CONTENT_SITE_ID': '  Pair Site / Á:06  ', 'PUBLICATION_EVENT_SECRET': secret, 'GETQUICK_FRONTEND_URL': origin, 'PAIR_FIXTURE': str(fixture)}

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

    # P2 is installed through Composer/Bedrock by this task's dependency.
    archive = cms.download('polylang-3.8.11.zip', 'https://downloads.wordpress.org/plugin/polylang.3.8.11.zip')
    import zipfile
    with zipfile.ZipFile(archive) as package:
        package.extractall(cms.SITE / 'web/app/plugins')
    # Configure actual Polylang using its model; no language API test doubles.
    cms.wp('plugin', 'activate', 'polylang')
    cms.wp('eval', "foreach (['pt'=>'pt_PT_ao90', 'en'=>'en_US'] as $slug=>$locale) { if (!PLL()->model->languages->get($slug)) { $r=PLL()->model->languages->add(['slug'=>$slug,'locale'=>$locale,'term_group'=>$slug==='pt'?0:1]); if(is_wp_error($r)) WP_CLI::error($r->get_error_message()); } } PLL()->model->languages->update_default('pt'); foreach(['force_lang'=>1,'hide_default'=>true,'rewrite'=>true] as $k=>$v) PLL()->model->options->set($k,$v); PLL()->model->options->save();")
    cms.wp('rewrite', 'structure', '/%postname%/')
    def page(title, slug, language):
        post = cms.wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=' + title, '--post_name=' + slug, '--post_content=<p>' + title + '</p>', '--porcelain').stdout.strip()
        cms.wp('eval', "pll_set_post_language(" + post + ", '" + language + "');")
        return post
    pt = page('Início', 'inicio', 'pt')
    en = page('Home', 'home', 'en')
    sobre = page('Sobre', 'sobre', 'pt')
    about = page('About', 'about', 'en')
    cms.wp('eval', f"pll_save_post_translations(['pt'=>{pt},'en'=>{en}]); pll_save_post_translations(['pt'=>{sobre},'en'=>{about}]); update_option('show_on_front','page'); update_option('page_on_front',{pt});")
    pt_menu = cms.wp('menu', 'create', 'Main PT', '--porcelain').stdout.strip()
    en_menu = cms.wp('menu', 'create', 'Main EN', '--porcelain').stdout.strip()
    cms.wp('menu', 'item', 'add-custom', pt_menu, 'Sobre nós', '/sobre/')
    cms.wp('menu', 'item', 'add-custom', en_menu, 'About us', '/en/about/')
    cms.wp('eval', f"$m=PLL()->model->options->get('nav_menus'); $m[get_option('stylesheet')]['primary']=['pt'=>{pt_menu},'en'=>{en_menu}]; PLL()->model->options->set('nav_menus',$m); PLL()->model->options->save();")
    cms.wp('option', 'update', 'blogdescription', 'Coisas')
    proof_config.write_text((ROOT / 'cms/tests/multilingual-export.php').read_text())
    wp('eval', 'echo "fixture-ready";')
    initial = json.loads(fixture.read_text())
    check('real Polylang normalizes language routes and resolves translated homes', set(initial['entries']) >= {'/sobre/', '/en/about/'} and initial['homes']['en']['nodeByUri']['title'] == 'Home')
    check('whole refresh prepares both language rows through installed handler', request('/gq/refresh', {}, True)['ready'])
    def home(language):
        result = request('/proof/home?language=' + language)
        check('canonical alternate objects retained for ' + language, result['canonical'])
        return result['delivery']
    def public(uri):
        return request('/proof/read?uri=' + uri)['delivery']
    def status(subject):
        return json.loads(wp('option', 'get', 'gq_settings_event_' + subject, '--format=json'))
    def state():
        return request('/proof/state')
    def changed(name, command, subject, language=None):
        before = state()
        wp(*command)
        after = state()
        saved = status(subject)
        expected = {'site', 'id', 'action', 'occurredAt', 'setting'} | ({'language'} if language else set())
        check(name + ': signed settings event and durable source record/wire shape', set(saved) == {'event', 'delivery'} and set(saved['event']) == expected and saved['event']['action'] == 'settings' and saved['event'].get('language') == language and saved['delivery']['status'] == 'refreshed' and saved['delivery']['attempts'] == 1)
        ops = after['operations'][len(before['operations']):]
        check(name + ': no entry republish/read or route listing', all(op['name'] not in ['EntryByUri', 'PublishedRoutes'] for op in ops))
        return saved, ops
    before_unassigned = len(state()['events'])
    replacement = wp('menu', 'create', 'Replacement EN', '--porcelain')
    wp('menu', 'item', 'add-custom', replacement, 'About us', '/en/about/')
    check('editing a menu shown nowhere emits no settings event', len(state()['events']) == before_unassigned)
    _, ops = changed('English menu reassignment', ['eval', f"$m=PLL()->model->options->get('nav_menus'); $m[get_option('stylesheet')]['primary']['en']={replacement}; PLL()->model->options->set('nav_menus',$m); PLL()->model->options->save();"], 'menus:en', 'en')
    check('real Polylang menu reassignment reads only English chrome', ops == [{'name':'SiteChrome','variables':{'location':'PRIMARY','template':'page','language':'EN'}}])
    en_menu = replacement
    # Actual menu edit in a language-assigned location invokes installed CMS hooks.
    saved, ops = changed('English menu edit', ['menu', 'item', 'add-custom', en_menu, 'Team', '/en/team/'], 'menus:en', 'en')
    check('English menu changes only English chrome', ops == [{'name': 'SiteChrome', 'variables': {'location': 'PRIMARY', 'template': 'page', 'language': 'EN'}}] and [x['label'] for x in public('/en/about/')['content']['chrome']['menuItems']] == ['About us', 'Team'] and [x['label'] for x in public('/sobre/')['content']['chrome']['menuItems']] == ['Sobre nós'])
    # Retry is through the CLI and uses the same durable identity; handler duplicate survives outage.
    request('/proof/offline')
    before = state()['reads']
    output = wp('gq-events', 'settings', 'retry', 'menus:en')
    retry = status('menus:en')
    check('settings CLI retry retains output and identity without CMS read', 'Refreshed the menus:en on the Frontend.' in output and retry['event'] == saved['event'] and retry['delivery']['attempts'] == 2 and state()['reads'] == before)
    request('/proof/online')
    # Polylang writes its real string-translation term meta via PLL_MO.
    _, ops = changed('English translated tagline', ['eval', "$mo=new PLL_MO(); $lang=PLL()->model->languages->get('en'); $mo->import_from_db($lang); $mo->add_entry($mo->make_entry(get_option('blogdescription'),'Better things')); $mo->export_to_db($lang);"], 'identity:en', 'en')
    check('translated identity reaches only English home', ops == [{'name': 'HomePage', 'variables': {'uri': '/en/', 'language': 'EN'}}] and home('en')['content']['home']['settings']['description'] == 'Better things' and home('pt')['content']['home']['settings']['description'] == 'Coisas')
    _, ops = changed('Shared logo', ['option', 'update', 'site_logo', '701'], 'logo')
    check('shared logo reaches both languages and stored entries', len(ops) == 2 and all(op['name'] == 'SiteChrome' for op in ops) and all(public(uri)['content']['chrome']['siteLogo']['sourceUrl'] == 'https://media.test/701.png' for uri in ['/sobre/', '/en/about/']))
    request('/proof/offline')
    wp('option', 'update', 'site_logo', '702')
    failed = status('logo')
    check('failed real setting retains its identity, failure record and last-known-good public logo', failed['delivery']['status'] == 'failed' and failed['delivery']['attempts'] == 1 and public('/en/about/')['content']['chrome']['siteLogo']['sourceUrl'] == 'https://media.test/701.png')
    request('/proof/online')
    wp('gq-events', 'settings', 'retry', 'logo')
    check('real failed setting retry completes the same identity', status('logo')['event'] == failed['event'] and status('logo')['delivery']['attempts'] == 2 and public('/en/about/')['content']['chrome']['siteLogo']['sourceUrl'] == 'https://media.test/702.png')
    changed('Shared identity', ['option', 'update', 'blogname', 'Shared Site'], 'identity')
    check('shared identity updates both homes without entry republishing', home('pt')['content']['home']['settings']['title'] == 'Shared Site' and home('en')['content']['home']['settings']['title'] == 'Shared Site')
    changed('Shared site icon', ['option', 'update', 'site_icon', '703'], 'identity')
    check('actual site icon reaches both language chrome rows', all(public(uri)['content']['chrome']['siteIcon']['sourceUrl'] == 'https://media.test/703.png' for uri in ['/sobre/', '/en/about/']))
    styles = wp('post', 'create', '--post_type=wp_global_styles', '--post_status=publish', '--post_title=Proof styles', '--post_content={"version":3,"isGlobalStylesUserThemeJSON":true,"settings":{"color":{"palette":{"custom":[{"slug":"brand","color":"#0a0"}]}}}}', '--porcelain')
    check('actual global-styles save sends shared design event', status('design')['delivery']['status'] == 'refreshed' and 'language' not in status('design')['event'])
    previous_design = status('design')
    rest = wp('eval', "wp_set_current_user(1); $r=new WP_REST_Request('POST','/wp/v2/global-styles/" + styles + "'); $r->set_body_params(['settings'=>['color'=>['palette'=>['custom'=>[['slug'=>'brand','color'=>'#0b0']]]]]]); echo rest_do_request($r)->get_status();")
    check('actual global-styles REST save delivers a fresh design event', rest == '200' and status('design')['event']['id'] != previous_design['event']['id'] and status('design')['delivery']['status'] == 'refreshed')
    request('/proof/offline')
    check('shared presets persist on both homes and entries during outage', all(public(uri)['content']['entry']['colors'] == [{'slug': 'brand', 'color': '#0b0'}] for uri in ['/sobre/', '/en/about/']) and all(home(lang)['content']['home']['colors'] == [{'slug': 'brand', 'color': '#0b0'}] for lang in ['pt', 'en']))
    request('/proof/online')
    # Real per-language home publication/withdrawal with actual Polylang permalink identity.
    wp('post', 'update', en, '--post_content=<h1>Welcome back</h1>')
    en_record = record(en)
    check('real English home save preserves language and home route identity', en_record['event']['entry']['language'] == 'en' and en_record['event']['entry']['uri'] == '/en/' and en_record['delivery']['status'] == 'refreshed' and home('en')['content']['home']['page']['content'] == '<h1>Welcome back</h1>')
    wp('post', 'update', en, '--post_status=draft')
    check('real English withdrawal hides only its home', home('en')['kind'] == 'missing' and home('pt')['kind'] == 'found')
    changed('Identity after withdrawal', ['option', 'update', 'blogname', 'Still shared'], 'identity')
    check('settings refresh cannot lift actual withdrawn English home', home('en')['kind'] == 'missing')
    wp('post', 'update', en, '--post_status=publish')
    check('later actual publication restores English home', home('en')['kind'] == 'found')
    wp('post', 'update', about, '--post_status=draft')
    check('withdrawn translation becomes a home alternate without cross-language fallback', public('/en/about/')['kind'] == 'missing' and public('/sobre/')['content']['alternates'] == [{'language': {'locale': 'en_US', 'slug': 'en', 'code': 'EN', 'lang': 'en-US', 'isDefault': False, 'home': '/en/'}, 'route': '/en/', 'translation': False}])
    request('/proof/offline')
    missing = public('/en/sobre/')
    check('unavailable English content never falls back to Portuguese', missing['kind'] == 'unavailable' and public('/sobre/')['kind'] == 'found')
    request('/proof/online')
    # A real Polylang language reassignment followed by the editor save moves the same node.
    wp('eval', f"pll_set_post_language({sobre}, 'en');")
    wp('post', 'update', sobre, '--post_content=<p>Now English</p>')
    reassigned = record(sobre)
    check('actual language reassignment retains node identity with new route and language', reassigned['event']['entry'] == {'id': base64.b64encode(('post:' + sobre).encode()).decode(), 'uri': '/en/sobre/', 'language': 'en'} and reassigned['delivery']['status'] == 'refreshed')
    check('language reassignment moves old route and serves new route with English chrome', public('/sobre/') == {'kind':'moved','uri':'/en/sobre/'} and public('/en/sobre/')['content']['entry']['content'] == '<p>Now English</p>' and public('/en/sobre/')['content']['chrome']['menuItems'][0]['label'] == 'About us')
    rows = json.loads(wp('gq-events', 'settings', 'status', '--format=json'))
    check('settings CLI lists shared and both language subjects with source output fields', {row['setting'] for row in rows} == {'menus', 'logo', 'identity', 'design', 'patterns', 'menus:pt', 'identity:pt', 'menus:en', 'identity:en'} and all(set(row) == {'setting','event','status','reason','attempts','message'} for row in rows))
    (WORK / 'proof-artifacts.json').write_text(json.dumps({'polylang': '3.8.11', 'state': state(), 'settingsCli': rows, 'fixture': json.loads(fixture.read_text()), 'homeEvent': en_record, 'failedSetting': failed, 'retryOutput': output, 'languageChange': reassigned}, ensure_ascii=False, indent=2))
    print('P2/P6 #7 multilingual installed pair passed: real WordPress/Polylang API and HTTP transport; GraphQL boundary fixtures; durable installed-consumer SQLite reads.', flush=True)
finally:
    proof_config.unlink(missing_ok=True)
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    log.close()
