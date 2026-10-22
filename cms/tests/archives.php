<?php
// Archives (ADR 0005) in real WordPress and WPGraphQL, one step per request:
// post types are registered with the mapping the request starts with.
use GetQuick\Content\Archives;

$node = static function (string $uri): ?string {
    $result = graphql([
        'query' => 'query ($uri: String!) { nodeByUri(uri: $uri) { __typename } }',
        'variables' => ['uri' => $uri],
    ]);

    return $result['data']['nodeByUri']['__typename'] ?? null;
};
$archives = static function (): array {
    $result = graphql(['query' => '{ getquickArchives { postType uri page { databaseId uri } } }']);
    $rows = [];
    foreach ($result['data']['getquickArchives'] ?? [] as $row) {
        $rows[$row['postType']] = ['uri' => $row['uri'], 'page' => $row['page']['databaseId'] ?? null];
    }

    return $result['errors'] ?? null ? ['errors' => $result['errors']] : $rows;
};
$page = static fn(): ?WP_Post => get_page_by_path('biblioteca', OBJECT, 'page');
$rules = static fn(): array => array_keys((array) get_option('rewrite_rules'));

$out = match (getenv('ARCHIVES_STEP')) {
    'setup' => (static function (): array {
        $page = wp_insert_post(['post_type' => 'page', 'post_name' => 'biblioteca', 'post_title' => 'Biblioteca', 'post_status' => 'publish'], true);
        $term = wp_insert_term('Legislação', 'category', ['slug' => 'legislacao']);
        $item = wp_insert_post(['post_type' => 'biblioteca', 'post_name' => 'lei', 'post_title' => 'Lei', 'post_excerpt' => 'Resumo', 'post_status' => 'publish', 'post_category' => [$term['term_id']]], true);
        $other = wp_insert_post(['post_type' => 'page', 'post_name' => 'outra', 'post_title' => 'Outra', 'post_status' => 'publish'], true);

        return ['page' => $page, 'item' => $item, 'other' => $other];
    })(),
    'before' => [
        'archive' => $node('/biblioteca/'),
        'item' => $node('/biblioteca/lei/'),
        'archives' => $archives(),
        'item_event' => \GetQuick\Site\PublicationEvents\event_for(get_page_by_path('lei', OBJECT, 'biblioteca'), null)['entry'] ?? null,
    ],
    'assign' => (static function () use ($page): array {
        $other = get_page_by_path('outra', OBJECT, 'page');
        $sanitized = Archives\sanitize([
            'biblioteca' => (string) $page()->ID,
            'eventos' => $page()->ID, // one type per Page
            'post' => $other->ID, // pages and posts have no archive Page
            'unknown' => $other->ID,
        ]);
        update_option(Archives\OPTION, ['biblioteca' => $page()->ID]);

        return ['sanitized' => $sanitized, 'option' => get_option(Archives\OPTION)];
    })(),
    'after' => [
        'archive' => $node('/biblioteca/'),
        'item' => $node('/biblioteca/lei/'),
        'other' => $node('/eventos/'),
        'archives' => $archives(),
        'page' => $page()->ID,
        'archive_rule' => in_array('biblioteca/?$', $rules(), true),
        'item_rule' => in_array('biblioteca/([^/]+)(?:/([0-9]+))?/?$', $rules(), true),
        'health' => (apply_filters('site_status_tests', [])['direct']['gq_archive_pages']['test'])()['status'],
    ],
    // A child of the archive Page, which the type's single-item rule claims.
    'collide' => (static function () use ($page): array {
        wp_insert_post(['post_type' => 'page', 'post_parent' => $page()->ID, 'post_name' => 'legislacao', 'post_title' => 'Legislação', 'post_status' => 'publish'], true);
        $health = (apply_filters('site_status_tests', [])['direct']['gq_archive_pages']['test'])();

        return ['pages' => Archives\colliding_pages(), 'status' => $health['status']];
    })(),
    // The runtime's own queries (scripts/collection-queries.mjs), as a visitor's read.
    'queries' => (static function (): array {
        $queries = json_decode((string) getenv('ARCHIVES_QUERIES'), true);
        $entry = graphql(['query' => $queries['EntryByUri'], 'variables' => ['uri' => '/biblioteca/lei/']]);
        $page = graphql(['query' => $queries['EntryByUri'], 'variables' => ['uri' => '/biblioteca/']]);
        $archives = graphql(['query' => $queries['ContentArchives']]);

        return ['entry' => $entry, 'page' => $page, 'archives' => $archives];
    })(),
    'trash' => ['trashed' => wp_trash_post($page()->ID) instanceof WP_Post],
    'trashed' => ['archives' => $archives(), 'archive' => $node('/biblioteca/')],
    'delete' => (static function (): array {
        $trashed = get_posts(['post_type' => 'page', 'post_status' => 'trash', 'name' => 'biblioteca__trashed', 'fields' => 'ids']);

        return ['deleted' => (bool) wp_delete_post((int) $trashed[0], true), 'option' => get_option(Archives\OPTION)];
    })(),
    'deleted' => ['archives' => $archives(), 'archive' => $node('/biblioteca/')],
    'screen' => (static function (): array {
        wp_set_current_user(1);
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        Archives\register();
        Archives\add_screen();
        global $submenu;
        ob_start();
        Archives\render();
        $html = (string) ob_get_clean();
        $registered = get_registered_settings()[Archives\OPTION]['sanitize_callback'] ?? null;

        return [
            'menu' => array_values(array_filter(array_keys($submenu ?? []), static fn($parent) => in_array(Archives\SCREEN, array_column($submenu[$parent], 2), true))),
            'select' => str_contains($html, "name='gq_archive_pages[biblioteca]'") && str_contains($html, "name='gq_archive_pages[eventos]'"),
            'sanitized' => is_callable($registered),
        ];
    })(),
};
echo wp_json_encode($out);
