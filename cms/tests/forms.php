<?php
// Headless Gravity Forms (ADR 0009) in real WordPress and WPGraphQL, one step
// per request. Gravity Forms is the P2 stand-in (forms-fixture.php), installed
// as an MU plugin from the `setup` step on.
use GetQuick\Content\Forms;

// Whether a type has getquickForms (public requests can't introspect the schema).
$has = static function (string $connection): bool {
    $result = graphql(['query' => "{ $connection(first: 1) { nodes { getquickForms } } }"]);
    foreach ($result['errors'] ?? [] as $error) {
        if (str_starts_with($error['message'], 'Cannot query field "getquickForms"')) {
            return false;
        }
    }

    return isset($result['data'][$connection]) && ! isset($result['errors']);
};
$forms = static function (string $uri): array {
    $result = graphql([
        'query' => 'query ($uri: String!) { nodeByUri(uri: $uri) { ... on ContentNode { getquickForms } } }',
        'variables' => ['uri' => $uri],
    ]);
    if ($result['errors'] ?? null) {
        return ['errors' => array_column($result['errors'], 'message')];
    }
    $json = $result['data']['nodeByUri']['getquickForms'] ?? null;

    return ['json' => $json, 'forms' => $json === null ? null : json_decode($json, true)];
};

$contact = [
    'id' => 1,
    'title' => 'Contactos',
    'description' => '<p>Envie-nos uma mensagem.</p>',
    'is_active' => '1',
    'is_trash' => '0',
    'enableHoneypot' => true,
    'honeypotAction' => 'spam',
    'button' => ['type' => 'text', 'text' => 'Enviar'],
    'fields' => [
        ['id' => 1, 'type' => 'name', 'label' => 'Nome', 'isRequired' => true, 'nameFormat' => 'advanced', 'inputs' => [
            ['id' => '1.2', 'label' => 'Prefix', 'isHidden' => true],
            ['id' => '1.3', 'label' => 'First', 'customLabel' => 'Nome próprio'],
            ['id' => '1.4', 'label' => 'Middle', 'isHidden' => true],
            ['id' => '1.6', 'label' => 'Last', 'customLabel' => 'Apelido'],
            ['id' => '1.8', 'label' => 'Suffix', 'isHidden' => true],
        ]],
        ['id' => 2, 'type' => 'email', 'label' => 'Email', 'isRequired' => true, 'adminLabel' => 'reply-to'],
        ['id' => 3, 'type' => 'text', 'label' => 'Assunto', 'maxLength' => 120, 'defaultValue' => '{embed_url}'],
        ['id' => 4, 'type' => 'textarea', 'label' => 'Mensagem', 'isRequired' => true],
        ['id' => 5, 'type' => 'consent', 'label' => 'Privacidade', 'isRequired' => true, 'checkboxLabel' => 'Aceito o tratamento dos meus dados.', 'description' => 'Os dados servem apenas para responder.'],
        ['id' => 7, 'type' => 'text', 'label' => 'Interno', 'visibility' => 'administrative'],
        ['id' => 8, 'type' => 'select', 'label' => 'Tema', 'choices' => [['text' => 'Geral', 'value' => 'geral', 'isSelected' => true], ['text' => 'Imprensa', 'value' => '']]],
    ],
    'confirmations' => [
        'c1' => ['id' => 'c1', 'isDefault' => true, 'type' => 'message', 'message' => '<p>Obrigado, {Nome (First):1.3}!</p>'],
    ],
    'notifications' => [
        'n1' => ['id' => 'n1', 'to' => 'secretariado@nomia.test', 'bcc' => 'arquivo@nomia.test', 'subject' => 'Novo contacto', 'message' => '{all_fields}'],
    ],
    'personalData' => ['retention' => ['policy' => 'retain']],
    'limitEntries' => false,
    'requireLogin' => false,
];
$unsupported = [
    'id' => 2,
    'title' => 'Candidatura',
    'is_active' => '1',
    'is_trash' => '0',
    'requireLogin' => true,
    'button' => ['text' => 'Candidatar'],
    'fields' => [
        ['id' => 1, 'type' => 'captcha', 'label' => 'CAPTCHA'],
        ['id' => 2, 'type' => 'fileupload', 'label' => 'CV'],
        ['id' => 3, 'type' => 'product', 'inputType' => 'singleproduct', 'label' => 'Quota'],
        ['id' => 4, 'type' => 'page', 'label' => 'Página 2'],
        ['id' => 5, 'type' => 'text', 'label' => 'Condicional', 'conditionalLogic' => ['actionType' => 'show', 'rules' => [['fieldId' => 1]]]],
        ['id' => 6, 'type' => 'address', 'label' => 'Morada'],
        ['id' => 7, 'type' => 'option', 'inputType' => 'select', 'label' => 'Extra', 'choices' => [['text' => 'A', 'value' => 'a|5']]],
    ],
    'confirmations' => [['isDefault' => true, 'type' => 'redirect', 'url' => 'https://nomia.test/obrigado/']],
];
$inactive = ['id' => 3, 'title' => 'Antigo', 'is_active' => '0', 'is_trash' => '0', 'fields' => []];

$out = match (getenv('FORMS_STEP')) {
    'dormant' => [
        'active' => Forms\active(),
        'page' => $has('pages'),
        'node' => $has('contentNodes'),
        'status' => Forms\status(),
        'published' => Forms\published(1),
    ],
    'setup' => (static function () use ($contact, $unsupported, $inactive): array {
        update_option('proof_gf_forms', [1 => $contact, 2 => $unsupported, 3 => $inactive]);
        $inner = wp_insert_post(['post_type' => 'wp_block', 'post_title' => 'Formulário', 'post_status' => 'publish', 'post_content' => '<!-- wp:gravityforms/form {"formId":"3"} /-->'], true);
        // A synced pattern inside another: the page shows form 3 two levels down.
        $pattern = wp_insert_post(['post_type' => 'wp_block', 'post_title' => 'Secção', 'post_status' => 'publish', 'post_content' => '<!-- wp:block {"ref":' . $inner . '} /-->'], true);
        $ids = [
            'contactos' => wp_insert_post(['post_type' => 'page', 'post_name' => 'contactos', 'post_title' => 'Contactos', 'post_status' => 'publish', 'post_content' => '<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column"><!-- wp:gravityforms/form {"formId":"1","title":false} /--></div><!-- /wp:column --></div><!-- /wp:columns -->'], true),
            'candidatura' => wp_insert_post(['post_type' => 'page', 'post_name' => 'candidatura', 'post_title' => 'Candidatura', 'post_status' => 'publish', 'post_content' => '<!-- wp:shortcode -->[gravityform id="2" title="false" field_values="source=ad&id=7"]<!-- /wp:shortcode -->'], true),
            'padrao' => wp_insert_post(['post_type' => 'page', 'post_name' => 'padrao', 'post_title' => 'Padrão', 'post_status' => 'publish', 'post_content' => '<!-- wp:block {"ref":' . $pattern . '} /-->'], true),
            'protegida' => wp_insert_post(['post_type' => 'page', 'post_name' => 'protegida', 'post_title' => 'Protegida', 'post_status' => 'publish', 'post_password' => 'segredo', 'post_content' => '<!-- wp:gravityforms/form {"formId":"1"} /-->'], true),
            'sem' => wp_insert_post(['post_type' => 'page', 'post_name' => 'sem', 'post_title' => 'Sem', 'post_status' => 'publish', 'post_content' => '<!-- wp:paragraph --><p>Nada</p><!-- /wp:paragraph -->'], true),
        ];

        return $ids + ['pattern' => $pattern];
    })(),
    'read' => (static function () use ($has, $forms): array {
        $queries = json_decode((string) getenv('FORMS_QUERIES'), true);
        $runtime = [];
        foreach ($queries as $name => $query) {
            $variables = $name === 'HomePage' ? [] : ['uri' => '/contactos/'];
            $runtime[$name] = graphql(['query' => $query, 'variables' => $variables]);
        }

        return [
            'active' => Forms\active(),
            'page' => $has('pages'),
            'post' => $has('posts'),
            'node' => $has('contentNodes'),
            'contactos' => $forms('/contactos/'),
            'candidatura' => $forms('/candidatura/'),
            'padrao' => $forms('/padrao/'),
            'protegida' => Forms\descriptors_for(get_page_by_path('protegida')),
            'sem' => $forms('/sem/'),
            'runtime' => $runtime,
        ];
    })(),
    'save' => (static function () use ($contact): array {
        $contact['fields'][3]['label'] = 'A sua mensagem';
        $forms = get_option('proof_gf_forms');
        $forms[1] = $contact;
        update_option('proof_gf_forms', $forms);
        do_action('gform_after_save_form', $contact, false, []);

        return ['queued' => array_keys(\GetQuick\Site\PublicationEvents\queue())];
    })(),
    'confirmations' => (static function (): array {
        do_action('gform_post_update_form_meta', [], 2, 'confirmations');
        do_action('gform_post_update_form_meta', [], 2, 'notifications');

        return ['queued' => array_keys(\GetQuick\Site\PublicationEvents\queue())];
    })(),
    'trash' => (static function (): array {
        do_action('gform_post_form_trashed', 3);

        return ['queued' => array_keys(\GetQuick\Site\PublicationEvents\queue())];
    })(),
    'status' => Forms\status(),
    'published' => (static function (): array {
        global $wpdb;
        $ids = static fn(): array => array_values(array_filter([1, 2, 3, 4], static fn(int $id): bool => Forms\published($id)));
        $read = ['initial' => $ids()];
        // Answered from the stored set: no query once it is read.
        $queries = $wpdb->num_queries;
        Forms\published(1);
        Forms\published(4);
        $read['queries'] = $wpdb->num_queries - $queries;
        $contactos = get_page_by_path('contactos');
        wp_update_post(['ID' => $contactos->ID, 'post_status' => 'draft']);
        $read['unpublished'] = $ids();
        wp_update_post(['ID' => $contactos->ID, 'post_status' => 'publish']);
        $read['republished'] = $ids();
        // Form 3 is shown only through a synced pattern two levels down.
        $inner = get_posts(['post_type' => 'wp_block', 'title' => 'Formulário', 'post_status' => 'publish', 'numberposts' => 1])[0];
        wp_update_post(['ID' => $inner->ID, 'post_content' => '<!-- wp:paragraph --><p>Sem formulário</p><!-- /wp:paragraph -->']);
        $read['pattern'] = $ids();
        wp_update_post(['ID' => $inner->ID, 'post_content' => '<!-- wp:gravityforms/form {"formId":"3"} /-->']);
        // A set read while content changed is stored under its old generation and read again.
        update_option(Forms\PUBLISHED_OPTION, ['generation' => 'stale', 'forms' => [4]], true);
        $read['stale'] = $ids();
        $read['invalid'] = [Forms\published(0), Forms\published(-1)];

        return $read;
    })(),
    'debug' => apply_filters('debug_information', [])['gq_content']['fields']['forms'] ?? null,
};
echo wp_json_encode($out);
