<?php

/*
 * Headless Gravity Forms (gq-platform ADR 0009). Dormant unless Gravity Forms
 * is active: it then gives every page, post and item in WPGraphQL a
 * `getquickForms` field, the public descriptors (JSON) of the forms its
 * content references (`gravityforms/form` blocks, including inside synced
 * patterns, and `[gravityform]` shortcodes). A Frontend that opts in to forms
 * reads it with the entry's blocks and stores it with the publication, so
 * rendering a form needs no Gravity Forms credential.
 *
 * A descriptor holds what a visitor sees and what a submission is checked
 * against: fields, labels, choices, required flags, the consent's text and
 * revision, the honeypot input and the default confirmation. It never holds
 * notifications, entries, feeds or admin settings. A field or setting the
 * Frontend can't support (Gravity Forms' CAPTCHA, file uploads, payment
 * fields, page breaks, conditional logic, login-only forms) is reported in
 * the descriptor's `diagnostics`, which Site readiness fails on.
 *
 * Saving a form (its fields or its confirmations), activating, deactivating,
 * trashing, restoring or deleting it publishes every published entry that
 * references it again (publication-events.php), so the Frontend refreshes
 * its stored descriptor. `published()` answers cheaply whether published
 * content references a form, for a Site's CMS gate on anonymous submissions.
 * `wp gq-forms status` reports Gravity Forms, every
 * referenced form, its diagnostics and the entries that reference it.
 *
 * Nothing here reads, exposes or exports entries.
 */

declare(strict_types=1);

namespace GetQuick\Content\Forms;

use WP_Post;

/** The descriptor's wire version, as `@getquick/content/forms` reads it. */
const SCHEMA = 1;

const BLOCK = 'gravityforms/form';

/** Field types the Frontend renders and submits. */
const SUPPORTED = [
    'text', 'textarea', 'email', 'phone', 'number', 'website', 'select', 'radio',
    'checkbox', 'consent', 'name', 'hidden', 'html', 'section',
];

/** Name sub-inputs: Gravity Forms' input suffix => autocomplete token. */
const NAME_AUTOCOMPLETE = ['2' => 'honorific-prefix', '3' => 'given-name', '4' => 'additional-name', '6' => 'family-name', '8' => 'honorific-suffix'];

/** Whether Gravity Forms is active; without it, the module does nothing. */
function active(): bool
{
    return class_exists('GFAPI') && class_exists('GFFormsModel');
}

/**
 * The forms content references, in order: `gravityforms/form` blocks (also
 * nested, and in synced patterns) and `[gravityform id=…]` shortcodes.
 *
 * @param array<int, true> $patterns Synced patterns already followed.
 * @return list<int>
 */
function referenced(string $content, array $patterns = []): array
{
    $ids = [];
    $walk = static function (array $blocks) use (&$walk, &$ids, &$patterns): void {
        foreach ($blocks as $block) {
            $name = $block['blockName'] ?? null;
            $attributes = is_array($block['attrs'] ?? null) ? $block['attrs'] : [];
            if ($name === BLOCK && (int) ($attributes['formId'] ?? 0) > 0) {
                $ids[] = (int) $attributes['formId'];
            } elseif ($name === 'core/block' && (int) ($attributes['ref'] ?? 0) > 0) {
                $ref = (int) $attributes['ref'];
                $pattern = get_post($ref);
                if (! isset($patterns[$ref]) && $pattern instanceof WP_Post && $pattern->post_type === 'wp_block' && $pattern->post_status === 'publish') {
                    $patterns[$ref] = true;
                    array_push($ids, ...referenced($pattern->post_content, $patterns));
                }
            }
            $walk(is_array($block['innerBlocks'] ?? null) ? $block['innerBlocks'] : []);
        }
    };
    if (str_contains($content, '<!-- wp:')) {
        $walk(parse_blocks($content));
    }
    if (preg_match_all('/\[gravityforms?\b([^\]]*)\]/i', $content, $matches)) {
        foreach ($matches[1] as $attributes) {
            $parsed = shortcode_parse_atts($attributes);
            $ids[] = is_array($parsed) ? (int) ($parsed['id'] ?? 0) : 0;
        }
    }

    return array_values(array_unique(array_filter($ids, static fn(int $id): bool => $id > 0)));
}

/** Text without tags or Gravity Forms merge tags. */
function plain(mixed $value): string
{
    $text = is_string($value) ? $value : '';
    $text = preg_replace('/\{[^{}]*\}/', '', $text) ?? '';

    return trim(html_entity_decode(wp_strip_all_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}

/** A Gravity Forms input id's HTML name (`1.3` → `input_1_3`). */
function input_name(string $id): string
{
    return 'input_' . str_replace('.', '_', $id);
}

/** Gravity Forms' honeypot input name for the form, as it renders and checks it. */
function honeypot_name(array $form): string
{
    try {
        if (class_exists('GFForms') && method_exists('GFForms', 'get_service_container')) {
            $handler = \GFForms::get_service_container()->get(\Gravity_Forms\Gravity_Forms\Honeypot\GF_Honeypot_Service_Provider::GF_HONEYPOT_HANDLER);
            if (is_object($handler) && method_exists($handler, 'get_input_name')) {
                return (string) $handler->get_input_name($form);
            }
        }
    } catch (\Throwable) {
        // Older Gravity Forms: its rule below.
    }
    $max = 0;
    foreach ($form['fields'] ?? [] as $field) {
        $max = max($max, (int) ($field->id ?? 0));
    }

    return (string) apply_filters('gform_honeypot_input_name', 'input_' . ($max + 1), $form);
}

/** The diagnostic for an unsupported field type, or null for a supported one. */
function unsupported(string $type, string $input_type): ?array
{
    // Pricing fields often use a supported input type (a product drop-down, an option's radios).
    $pricing = in_array($type, ['product', 'option', 'quantity', 'shipping', 'total', 'calculation', 'donation', 'singleproduct', 'singleshipping'], true)
        || preg_match('/creditcard|paypal|stripe|square|payment/', $type) === 1
        || (class_exists('GFCommon') && method_exists('GFCommon', 'is_pricing_field') && \GFCommon::is_pricing_field($type));
    if (! $pricing && in_array($input_type, SUPPORTED, true)) {
        return null;
    }
    [$code, $message] = match (true) {
        $type === 'captcha' || $input_type === 'captcha' || str_contains($type, 'turnstile') || str_contains($type, 'recaptcha') => ['unsupported-captcha', 'Gravity Forms\' CAPTCHA can\'t be shown on the Frontend; remove it and use the Site\'s spam controls.'],
        in_array($input_type, ['fileupload', 'post_image', 'signature'], true) => ['unsupported-file-upload', 'File uploads aren\'t supported.'],
        $pricing => ['unsupported-payment', 'Payment and pricing fields aren\'t supported.'],
        $type === 'page' => ['unsupported-multi-page', 'Multi-page forms aren\'t supported.'],
        default => ['unsupported-field', sprintf('The %s field type isn\'t supported.', $type)],
    };

    return ['code' => $code, 'type' => $type, 'message' => $message];
}

/** The public description of one supported field. */
function field_of(object $field, int $form_id): array
{
    $id = (int) $field->id;
    $input_type = method_exists($field, 'get_input_type') ? (string) $field->get_input_type() : (string) $field->type;
    $described = [
        'id' => $id,
        'type' => $input_type,
        'label' => plain($field->label ?? ''),
        'description' => plain($field->description ?? ''),
        'required' => ! empty($field->isRequired),
        'visibility' => ($field->visibility ?? 'visible') === 'hidden' ? 'hidden' : 'visible',
    ];
    if (is_string($field->placeholder ?? null) && $field->placeholder !== '') {
        $described['placeholder'] = plain($field->placeholder);
    }
    if ((int) ($field->maxLength ?? 0) > 0) {
        $described['maxLength'] = (int) $field->maxLength;
    }
    $default = is_string($field->defaultValue ?? null) ? $field->defaultValue : '';
    if ($default !== '' && ! str_contains($default, '{')) {
        $described['defaultValue'] = $default;
    }
    $classes = array_filter(array_map('sanitize_html_class', preg_split('/\s+/', (string) ($field->cssClass ?? '')) ?: []));
    if ($classes !== []) {
        $described['cssClass'] = implode(' ', $classes);
    }
    $choices = [];
    foreach (is_array($field->choices ?? null) ? $field->choices : [] as $choice) {
        $text = plain($choice['text'] ?? '');
        $value = isset($choice['value']) && (string) $choice['value'] !== '' ? (string) $choice['value'] : $text;
        $choices[] = ['text' => $text, 'value' => $value, 'selected' => ! empty($choice['isSelected'])];
    }
    if (in_array($input_type, ['select', 'radio', 'checkbox'], true)) {
        $described['choices'] = $choices;
    }

    $inputs = [];
    if ($input_type === 'checkbox') {
        foreach (is_array($field->inputs ?? null) ? array_values($field->inputs) : [] as $index => $input) {
            $inputs[] = ['id' => (string) $input['id'], 'name' => input_name((string) $input['id']), 'label' => plain($input['label'] ?? ''), 'value' => $choices[$index]['value'] ?? ''];
        }
    } elseif ($input_type === 'name' && is_array($field->inputs ?? null)) {
        foreach ($field->inputs as $input) {
            if (! empty($input['isHidden'])) {
                continue;
            }
            $suffix = substr((string) $input['id'], strpos((string) $input['id'], '.') + 1);
            $label = plain(($input['customLabel'] ?? '') ?: ($input['label'] ?? ''));
            $inputs[] = array_filter([
                'id' => (string) $input['id'],
                'name' => input_name((string) $input['id']),
                'label' => $label,
                'placeholder' => plain($input['placeholder'] ?? ''),
                'autocomplete' => NAME_AUTOCOMPLETE[$suffix] ?? '',
            ], static fn($value) => $value !== '');
            $inputs[array_key_last($inputs)]['label'] ??= '';
        }
    } elseif ($input_type === 'consent') {
        foreach (['1', '2', '3'] as $suffix) {
            $inputs[] = ['id' => "$id.$suffix", 'name' => "input_{$id}_{$suffix}", 'label' => ''];
        }
        $revision = method_exists('GFFormsModel', 'get_latest_form_revisions_id') ? \GFFormsModel::get_latest_form_revisions_id($form_id) : '';
        $described['consent'] = [
            'checkboxLabel' => trim((string) ($field->checkboxLabel ?? '')),
            'description' => plain($field->description ?? ''),
            'revisionId' => (string) ($revision ?? ''),
        ];
        $described['description'] = '';
    } elseif ($input_type === 'email' && ! empty($field->emailConfirmEnabled) && is_array($field->inputs ?? null)) {
        foreach ($field->inputs as $input) {
            $inputs[] = ['id' => (string) $input['id'], 'name' => input_name((string) $input['id']), 'label' => plain(($input['customLabel'] ?? '') ?: ($input['label'] ?? ''))];
        }
    } elseif (! in_array($input_type, ['html', 'section'], true)) {
        $inputs[] = ['id' => (string) $id, 'name' => "input_$id", 'label' => $described['label']];
    }
    $described['inputs'] = $inputs;
    if ($input_type === 'html') {
        $described['content'] = wp_kses_post(preg_replace('/\{[^{}]*\}/', '', (string) ($field->content ?? '')) ?? '');
    }
    if ($input_type === 'number') {
        $range = array_filter([
            'min' => is_numeric($field->rangeMin ?? null) ? (float) $field->rangeMin : null,
            'max' => is_numeric($field->rangeMax ?? null) ? (float) $field->rangeMax : null,
        ], static fn($value) => $value !== null);
        if ($range !== []) {
            $described['range'] = $range;
        }
    }

    return $described;
}

/** The form's default confirmation: a message as text, or where it redirects. */
function confirmation_of(array $form): array
{
    $confirmations = is_array($form['confirmations'] ?? null) ? $form['confirmations'] : [];
    $default = null;
    foreach ($confirmations as $confirmation) {
        if (! empty($confirmation['isDefault'])) {
            $default = $confirmation;
            break;
        }
    }
    $default ??= $confirmations === [] ? null : reset($confirmations);
    $type = $default['type'] ?? 'message';
    if ($type === 'page' && (int) ($default['pageId'] ?? 0) > 0) {
        $url = get_permalink((int) $default['pageId']);
        if (is_string($url) && $url !== '') {
            return ['type' => 'redirect', 'url' => $url];
        }
    }
    $url = $type === 'redirect' && is_string($default['url'] ?? null) ? esc_url_raw($default['url'], ['http', 'https']) : '';
    if ($url !== '' && wp_parse_url($url, PHP_URL_HOST)) {
        return ['type' => 'redirect', 'url' => $url];
    }

    return ['type' => 'message', 'message' => plain($default['message'] ?? '')];
}

/** A form's public descriptor (never notifications, entries, feeds or admin settings). */
function descriptor(int $form_id): array
{
    $form = active() ? \GFAPI::get_form($form_id) : false;
    $unavailable = [
        'schema' => SCHEMA,
        'id' => $form_id,
        'available' => false,
        'title' => '',
        'description' => '',
        'submitLabel' => '',
        'fields' => [],
        'honeypot' => null,
        'confirmation' => ['type' => 'message', 'message' => ''],
        'diagnostics' => [['code' => 'unavailable', 'message' => sprintf('Form %d is missing, inactive or in the trash.', $form_id)]],
    ];
    if (! is_array($form) || empty($form['is_active']) || ! empty($form['is_trash'])) {
        return $unavailable;
    }

    $fields = [];
    $diagnostics = [];
    foreach ($form['fields'] ?? [] as $field) {
        if (! is_object($field) || ($field->visibility ?? 'visible') === 'administrative') {
            continue;
        }
        $type = (string) $field->type;
        $input_type = method_exists($field, 'get_input_type') ? (string) $field->get_input_type() : $type;
        $problem = unsupported($type, $input_type);
        if ($problem === null && $input_type === 'radio' && ! empty($field->enableOtherChoice)) {
            $problem = ['code' => 'unsupported-field', 'type' => $type, 'message' => 'Radio buttons with an "Other" choice aren\'t supported.'];
        }
        if ($problem !== null) {
            $diagnostics[] = ['code' => $problem['code'], 'fieldId' => (int) $field->id, 'type' => $problem['type'], 'message' => $problem['message']];
            continue;
        }
        if (! empty($field->conditionalLogic)) {
            $diagnostics[] = ['code' => 'unsupported-conditional-logic', 'fieldId' => (int) $field->id, 'type' => $type, 'message' => 'Conditional logic isn\'t supported.'];
        }
        $fields[] = field_of($field, $form_id);
    }
    if (! empty($form['button']['conditionalLogic'])) {
        $diagnostics[] = ['code' => 'unsupported-conditional-logic', 'message' => 'Conditional logic on the submit button isn\'t supported.'];
    }
    if (! empty($form['requireLogin'])) {
        $diagnostics[] = ['code' => 'requires-login', 'message' => 'Forms that require a login can\'t be submitted from the Frontend.'];
    }

    return [
        'schema' => SCHEMA,
        'id' => $form_id,
        'available' => true,
        'title' => plain($form['title'] ?? ''),
        'description' => plain($form['description'] ?? ''),
        'submitLabel' => plain($form['button']['text'] ?? ''),
        'fields' => $fields,
        'honeypot' => ! empty($form['enableHoneypot']) ? ['name' => honeypot_name($form)] : null,
        'confirmation' => confirmation_of($form),
        'diagnostics' => $diagnostics,
    ];
}

/** The descriptors of the forms a public entry references; null for an entry that isn't public. */
function descriptors_for(WP_Post $post): ?array
{
    if ($post->post_status !== 'publish' || $post->post_password !== '') {
        return null;
    }

    return array_map(__NAMESPACE__ . '\\descriptor', referenced($post->post_content));
}

add_action('graphql_register_types', static function (): void {
    if (! active()) {
        return;
    }
    register_graphql_field('ContentNode', 'getquickForms', [
        'type' => 'String',
        'description' => 'The public descriptors (JSON) of the Gravity Forms forms this entry references: fields, labels, choices, consent text and confirmation; never notifications, entries, feeds or settings. Null when the entry isn\'t public.',
        'resolve' => static function ($node): ?string {
            $post = get_post((int) ($node->databaseId ?? 0));
            $descriptors = $post instanceof WP_Post ? descriptors_for($post) : null;

            return $descriptors === null ? null : (string) wp_json_encode($descriptors);
        },
    ]);
});

/**
 * Published entries whose content references the form, directly or through a
 * synced pattern, by id.
 *
 * @return array<int, WP_Post>
 */
function referencing(?int $form_id = null): array
{
    global $wpdb;
    $types = \GetQuick\Site\PublicationEvents\post_types();
    $patterns = [];
    $mention = '%' . $wpdb->esc_like('gravityform') . '%';
    // Every published synced pattern showing the form, also through nested patterns.
    $rows = $wpdb->get_results("SELECT ID, post_content FROM {$wpdb->posts} WHERE post_type = 'wp_block' AND post_status = 'publish'");
    foreach ($rows as $row) {
        $ids = referenced((string) $row->post_content, [(int) $row->ID => true]);
        if ($ids !== [] && ($form_id === null || in_array($form_id, $ids, true))) {
            $patterns[] = (int) $row->ID;
        }
    }
    $like = ['post_content LIKE %s'];
    $values = [$mention];
    foreach ($patterns as $pattern) {
        $like[] = 'post_content LIKE %s';
        $values[] = '%' . $wpdb->esc_like('"ref":' . $pattern) . '%';
    }
    $in = implode(', ', array_fill(0, count($types), '%s'));
    $ids = $wpdb->get_col($wpdb->prepare(
        "SELECT ID FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_password = '' AND post_type IN ($in) AND (" . implode(' OR ', $like) . ') ORDER BY ID',
        ...$types,
        ...$values,
    ));
    $posts = [];
    foreach ($ids as $id) {
        $post = get_post((int) $id);
        if ($post instanceof WP_Post && ($form_id === null ? referenced($post->post_content) !== [] : in_array($form_id, referenced($post->post_content), true))) {
            $posts[(int) $id] = $post;
        }
    }

    return $posts;
}

/** Publishes every entry that references the form again, so the Frontend refreshes its descriptor. */
function republish(int $form_id): void
{
    if ($form_id <= 0 || ! function_exists('GetQuick\\Site\\PublicationEvents\\enqueue')) {
        return;
    }
    foreach (referencing($form_id) as $post_id => $post) {
        $event = \GetQuick\Site\PublicationEvents\event_for($post, $post);
        if ($event !== null) {
            \GetQuick\Site\PublicationEvents\enqueue($post_id, $event);
        }
    }
}

add_action('gform_after_save_form', static function ($form): void {
    republish((int) (is_array($form) ? ($form['id'] ?? 0) : 0));
}, 20);
// Confirmations are saved apart from the form's fields.
add_action('gform_post_update_form_meta', static function ($meta, $form_id = 0, $meta_name = ''): void {
    if ($meta_name === 'confirmations') {
        republish((int) $form_id);
    }
}, 20, 3);
foreach (['gform_post_form_activated', 'gform_post_form_deactivated', 'gform_post_form_trashed', 'gform_post_form_restored', 'gform_after_delete_form'] as $hook) {
    add_action($hook, static function ($form_id): void {
        republish((int) $form_id);
    }, 20);
}

/** The forms published content references, stored with what it was read under. */
const PUBLISHED_OPTION = 'gq_forms_published';

/** Changes whenever content that can reference a form changes. */
const GENERATION_OPTION = 'gq_forms_generation';

/** Seconds a stored set is trusted, for content changed without saving (SQL, imports). */
const PUBLISHED_TTL = HOUR_IN_SECONDS;

/**
 * Whether a published, public entry references the form, directly or through a
 * synced pattern. Cheap enough for every anonymous request (a Site's REST gate
 * opens Gravity Forms' submissions path only for these forms): it reads one
 * stored set, without a query. The request that saves content reads the set
 * again before it ends; a set stored under another generation, other post
 * types or more than an hour ago is read again too.
 */
function published(int $form_id): bool
{
    if ($form_id <= 0 || ! active()) {
        return false;
    }
    $stored = get_option(PUBLISHED_OPTION);
    $forms = published_current($stored) ? $stored['forms'] : store_published();

    return in_array($form_id, $forms, true);
}

/** Whether a stored set still describes the content. */
function published_current(mixed $stored): bool
{
    return is_array($stored) && is_array($stored['forms'] ?? null)
        && ($stored['generation'] ?? null) === get_option(GENERATION_OPTION)
        && ($stored['types'] ?? null) === \GetQuick\Site\PublicationEvents\post_types()
        && (int) ($stored['at'] ?? 0) > time() - PUBLISHED_TTL;
}

/**
 * Reads the forms published content references and stores them under the
 * generation the read began at, so a read that races with a save isn't
 * trusted. A read before post types are registered, or one a query failed,
 * is answered but not stored.
 *
 * @return list<int>
 */
function store_published(): array
{
    global $wpdb;
    $generation = get_option(GENERATION_OPTION);
    if (! is_string($generation)) {
        // Autoloaded from now on, so reading it needs no query.
        $generation = wp_generate_uuid4();
        add_option(GENERATION_OPTION, $generation, '', true);
    }
    $types = \GetQuick\Site\PublicationEvents\post_types();
    $error = $wpdb->last_error;
    $forms = [];
    foreach (referencing() as $post) {
        array_push($forms, ...referenced($post->post_content));
    }
    $forms = array_unique($forms);
    sort($forms);
    if (did_action('init') && $wpdb->last_error === $error) {
        update_option(PUBLISHED_OPTION, ['generation' => $generation, 'types' => $types, 'at' => time(), 'forms' => $forms], true);
    }

    return $forms;
}

/** Marks the stored set out of date and reads it again before the request ends. */
function content_changed(?WP_Post $post): void
{
    if (! $post instanceof WP_Post || ($post->post_type !== 'wp_block' && ! in_array($post->post_type, \GetQuick\Site\PublicationEvents\post_types(), true))) {
        return;
    }
    update_option(GENERATION_OPTION, wp_generate_uuid4(), true);
    if (! has_action('shutdown', __NAMESPACE__ . '\\refresh_published')) {
        add_action('shutdown', __NAMESPACE__ . '\\refresh_published');
    }
}

/** Reads the set again once per saving request, so visitors' requests don't. */
function refresh_published(): void
{
    if (active()) {
        store_published();
    }
}

// Saving covers publishing, unpublishing, trashing, restoring and password
// changes; revisions and autosaves are of another post type.
add_action('save_post', static function ($post_id, $post = null): void {
    content_changed($post instanceof WP_Post ? $post : null);
}, 20, 2);
add_action('deleted_post', static function ($post_id, $post = null): void {
    content_changed($post instanceof WP_Post ? $post : null);
}, 20, 2);

/** Gravity Forms, every referenced form and its diagnostics, for readiness. */
function status(): array
{
    if (! active()) {
        return ['gravityForms' => ['active' => false, 'version' => null], 'forms' => [], 'ok' => true];
    }
    $forms = [];
    foreach (referencing() as $post) {
        foreach (referenced($post->post_content) as $form_id) {
            $forms[$form_id] ??= ['descriptor' => descriptor($form_id), 'referencedBy' => []];
            $forms[$form_id]['referencedBy'][] = \GetQuick\Site\PublicationEvents\uri_of($post);
        }
    }
    ksort($forms);
    $rows = [];
    foreach ($forms as $form_id => ['descriptor' => $descriptor, 'referencedBy' => $uris]) {
        $rows[] = [
            'id' => $form_id,
            'title' => $descriptor['title'],
            'available' => $descriptor['available'],
            'honeypot' => $descriptor['honeypot'] !== null,
            'diagnostics' => $descriptor['diagnostics'],
            'referencedBy' => array_values(array_unique($uris)),
        ];
    }

    return [
        'gravityForms' => ['active' => true, 'version' => class_exists('GFForms') ? (string) (\GFForms::$version ?? '') : null],
        'forms' => $rows,
        'ok' => array_reduce($rows, static fn(bool $ok, array $row): bool => $ok && $row['diagnostics'] === [], true),
    ];
}

add_filter('debug_information', static function (array $information): array {
    if (isset($information['gq_content'])) {
        $information['gq_content']['fields']['forms'] = [
            'label' => 'Headless Gravity Forms',
            'value' => active() ? 'active' : 'dormant (Gravity Forms inactive)',
        ];
    }

    return $information;
}, 20);

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Headless Gravity Forms: the forms published content references.
     */
    \WP_CLI::add_command('gq-forms', new class {
        /**
         * Reports Gravity Forms, each form published content references, its
         * readiness diagnostics and the entries that reference it. Fails
         * (exit 1) when any referenced form has a diagnostic.
         *
         * ## OPTIONS
         *
         * [--format=<format>]
         * : text or json.
         * ---
         * default: text
         * ---
         */
        public function status(array $args, array $assoc): void
        {
            $report = status();
            if (($assoc['format'] ?? 'text') === 'json') {
                \WP_CLI::line((string) wp_json_encode($report));
            } else {
                \WP_CLI::line($report['gravityForms']['active'] ? 'Gravity Forms ' . $report['gravityForms']['version'] : 'Gravity Forms is not active: forms are dormant.');
                foreach ($report['forms'] as $form) {
                    \WP_CLI::line(sprintf('Form %d (%s): %s; on %s', $form['id'], $form['title'], $form['diagnostics'] === [] ? 'ready' : implode(', ', array_column($form['diagnostics'], 'code')), implode(', ', $form['referencedBy'])));
                }
            }
            if (! $report['ok']) {
                \WP_CLI::halt(1);
            }
        }
    });
}
