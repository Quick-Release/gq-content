<?php

/*
 * GETQUICK → Archives: a Page for each public custom post type's archive, as
 * WordPress's `page_for_posts` is the posts'. Editors lay that Page out with
 * blocks, and the Frontend lists the type's items on it from its publication
 * store (ADR 0005).
 *
 * A type with a Page assigned no longer has an archive of its own, so its
 * archive's URI (`/biblioteca/`) is no longer claimed by it: WordPress, and
 * WPGraphQL's `nodeByUri`, resolve the Page there. Its items keep their own
 * rewrite rules, so `/biblioteca/<slug>/` still resolves.
 *
 * The mapping is the option `gq_archive_pages` (post type => page id), saved
 * on the Archives screen through the Settings API. Saving it sends an
 * `archives` settings event (settings-events.php), as does saving, trashing or
 * deleting an assigned Page (a deleted one is unassigned). WPGraphQL's
 * `getquickArchives` says where each public custom post type's archive is:
 * its Page's URI, when it is published and public, or else its own archive's.
 */

declare(strict_types=1);

namespace GetQuick\Content\Archives;

use WP_Post;

/** The Page assigned to each post type's archive. */
const OPTION = 'gq_archive_pages';

/** The Archives screen, and its settings group. */
const SCREEN = 'gq-archives';

/** The GETQUICK menu (gq-config's); without it, the screen is under Settings. */
const GETQUICK_MENU = 'getquick-options';

/** The public custom post types, which can have an archive Page, by name. */
function post_types(): array
{
    return get_post_types(['public' => true, '_builtin' => false], 'objects');
}

/** The Page assigned to each post type's archive, by post type. */
function assigned(): array
{
    $value = get_option(OPTION, []);
    $pages = [];
    foreach (is_array($value) ? $value : [] as $post_type => $page_id) {
        if (is_string($post_type) && (int) $page_id > 0) {
            $pages[$post_type] = (int) $page_id;
        }
    }

    return $pages;
}

/** Whether a Page is public: published and without a password. */
function public_page(WP_Post $page): bool
{
    return $page->post_type === 'page' && $page->post_status === 'publish' && $page->post_password === '';
}

/** A link's path, as WPGraphQL gives a URI. */
function path(string $link): string
{
    $path = (string) wp_parse_url($link, PHP_URL_PATH);

    return $path === '' ? '/' : $path;
}

/**
 * Where each public custom post type's archive is: its assigned Page (`page`,
 * its id) at the Page's URI, while it is public; else, without one, the
 * type's own archive, if it has one. `uri` is null when there is neither.
 */
function archives(): array
{
    $assigned = assigned();
    $archives = [];
    foreach (post_types() as $name => $type) {
        $page = isset($assigned[$name]) ? get_post($assigned[$name]) : null;
        $page = $page instanceof WP_Post && public_page($page) ? $page : null;
        $own = isset($assigned[$name]) ? false : get_post_type_archive_link($name);
        $archives[] = [
            'postType' => $name,
            'uri' => $page !== null ? path((string) get_permalink($page)) : (is_string($own) ? path($own) : null),
            'page' => $page?->ID,
        ];
    }

    return $archives;
}

/**
 * The mapping as saved: each public custom post type to an existing Page, at
 * most one type per Page; "none" (0) and anything else is left out.
 */
function sanitize(mixed $value): array
{
    $types = post_types();
    $pages = [];
    foreach (is_array($value) ? $value : [] as $post_type => $page_id) {
        $page = (int) $page_id > 0 ? get_post((int) $page_id) : null;
        if (
            is_string($post_type)
            && isset($types[$post_type])
            && $page instanceof WP_Post
            && $page->post_type === 'page'
            && ! in_array($page->ID, $pages, true)
        ) {
            $pages[$post_type] = $page->ID;
        }
    }

    return $pages;
}

// A type with a Page leaves its archive's URI to it; its items keep theirs.
add_filter('register_post_type_args', static function (array $args, string $post_type): array {
    if (isset(assigned()[$post_type]) && ! empty($args['has_archive'])) {
        $args['has_archive'] = false;
    }

    return $args;
}, 20, 2);

/**
 * The post types are registered with the mapping they were read with, so the
 * rewrite rules are regenerated on the next request, which registers them
 * with the new one.
 */
function mapping_changed(): void
{
    delete_option('rewrite_rules');
}

add_action('update_option_' . OPTION, __NAMESPACE__ . '\\mapping_changed', 10, 0);
add_action('add_option_' . OPTION, __NAMESPACE__ . '\\mapping_changed', 10, 0);
add_action('delete_option_' . OPTION, __NAMESPACE__ . '\\mapping_changed', 10, 0);

/** An assigned Page saved (its URI or status may have changed): where its archive is did. */
add_action('wp_after_insert_post', static function (int $post_id, WP_Post $post): void {
    if (
        $post->post_type === 'page'
        && in_array($post_id, assigned(), true)
        && function_exists('GetQuick\\Site\\SettingsEvents\\changed')
    ) {
        \GetQuick\Site\SettingsEvents\changed('archives');
    }
}, 10, 2);

/** An assigned Page deleted: its type is unassigned, and has its own archive again. */
add_action('deleted_post', static function (int $post_id): void {
    $assigned = assigned();
    if (in_array($post_id, $assigned, true)) {
        update_option(OPTION, array_filter($assigned, static fn(int $page_id): bool => $page_id !== $post_id));
    }
}, 10, 1);

/** The mapping is saved through the Settings API, sanitized. */
function register(): void
{
    register_setting(SCREEN, OPTION, [
        'type' => 'object',
        'default' => [],
        'sanitize_callback' => __NAMESPACE__ . '\\sanitize',
        'show_in_rest' => false,
    ]);
}

/** The Archives screen, in the GETQUICK menu, or under Settings without it. */
function add_screen(): void
{
    global $admin_page_hooks;
    $title = __('Archives', 'gq-content');
    add_submenu_page(
        isset($admin_page_hooks[GETQUICK_MENU]) ? GETQUICK_MENU : 'options-general.php',
        $title,
        $title,
        'manage_options',
        SCREEN,
        __NAMESPACE__ . '\\render',
    );
}

add_action('admin_init', __NAMESPACE__ . '\\register');
add_action('admin_menu', __NAMESPACE__ . '\\add_screen', 20);

/** The Archives screen: a Page for each public custom post type, or its own archive. */
function render(): void
{
    if (! current_user_can('manage_options')) {
        return;
    }
    $assigned = assigned();
    echo '<div class="wrap"><h1>' . esc_html__('Archives', 'gq-content') . '</h1>';
    echo '<p>' . esc_html__(
        'Choose a page to be the archive of each content type. The page takes over the archive\'s address; lay it out with blocks, and the public website lists the type\'s items on it. The items keep their own addresses.',
        'gq-content',
    ) . '</p>';
    echo '<form method="post" action="options.php">';
    settings_fields(SCREEN);
    echo '<table class="form-table" role="presentation"><tbody>';
    $types = post_types();
    foreach ($types as $name => $type) {
        $id = 'gq-archive-' . sanitize_html_class($name);
        echo '<tr><th scope="row"><label for="' . esc_attr($id) . '">' . esc_html((string) $type->labels->name) . '</label></th><td>';
        echo wp_dropdown_pages([
            'name' => OPTION . '[' . $name . ']',
            'id' => $id,
            'echo' => 0,
            'selected' => $assigned[$name] ?? 0,
            'show_option_none' => __('— Its own archive —', 'gq-content'),
            'option_none_value' => '0',
            'post_status' => ['publish', 'draft', 'pending', 'private', 'future'],
        ]);
        echo '<p class="description"><code>' . esc_html($name) . '</code></p></td></tr>';
    }
    if ($types === []) {
        echo '<tr><td>' . esc_html__('This site has no public content types besides pages and posts.', 'gq-content') . '</td></tr>';
    }
    echo '</tbody></table>';
    submit_button();
    echo '</form></div>';
}

add_action('graphql_register_types', static function (): void {
    register_graphql_object_type('GetquickArchive', [
        'description' => 'Where a public custom post type\'s archive is (GETQUICK → Archives).',
        'fields' => [
            'postType' => [
                'type' => ['non_null' => 'String'],
                'description' => 'The post type\'s name.',
            ],
            'uri' => [
                'type' => 'String',
                'description' => 'The archive\'s URI: its assigned Page\'s, while the Page is public, else its own archive\'s; null when it has neither.',
            ],
            'page' => [
                'type' => 'Page',
                'description' => 'The Page assigned to be its archive, while it is public.',
                'resolve' => static fn(array $archive, array $args, \WPGraphQL\AppContext $context) => $archive['page'] === null
                    ? null
                    : \WPGraphQL\Data\DataSource::resolve_post_object((int) $archive['page'], $context),
            ],
        ],
    ]);
    register_graphql_field('RootQuery', 'getquickArchives', [
        'type' => ['list_of' => ['non_null' => 'GetquickArchive']],
        'description' => 'Where each public custom post type\'s archive is (GETQUICK → Archives).',
        'resolve' => static fn(): array => archives(),
    ]);
});

/**
 * Published Pages whose URI WordPress resolves to something else: a child of
 * an archive Page (`/biblioteca/legislacao/`) that a custom post type's
 * single-item rule (`biblioteca/<slug>/`) claims, say. The archive setting
 * only frees the archive's own URI; moving a type's items out of its Pages'
 * way is the Site's (its post type's rewrite slug). Their URIs, sorted.
 */
function colliding_pages(): array
{
    $colliding = [];
    $pages = get_posts([
        'post_type' => 'page',
        'post_status' => 'publish',
        'has_password' => false,
        'posts_per_page' => -1,
        'suppress_filters' => true,
    ]);
    foreach ($pages as $page) {
        $link = (string) get_permalink($page);
        if ($link !== '' && url_to_postid($link) !== $page->ID) {
            $colliding[] = path($link);
        }
    }
    sort($colliding);

    return $colliding;
}

add_filter('site_status_tests', static function (array $tests): array {
    $tests['direct']['gq_archive_pages'] = [
        'label' => 'Pages reachable at their addresses',
        'test' => static function (): array {
            $colliding = colliding_pages();
            $result = [
                'label' => 'Every published page is reachable at its address',
                'status' => 'good',
                'badge' => ['label' => 'GETQUICK', 'color' => 'blue'],
                'description' => '<p>WordPress resolves each published page\'s address to the page itself.</p>',
                'actions' => '',
                'test' => 'gq_archive_pages',
            ];
            if ($colliding === []) {
                return $result;
            }

            return [
                'label' => 'Some published pages are hidden by other content at their address',
                'status' => 'recommended',
                'description' => '<p>WordPress resolves these addresses to something other than their page, so the public website can\'t publish them: ' . esc_html(implode(', ', $colliding)) . '. A content type\'s archive is freed by assigning the page in GETQUICK → Archives; its items\' addresses are the content type\'s to move.</p>',
            ] + $result;
        },
    ];

    return $tests;
});
