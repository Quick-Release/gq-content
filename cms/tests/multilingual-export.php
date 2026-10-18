<?php
// Site-owned proof fixture exporter: real WordPress/Polylang state at the GraphQL boundary.
// No event functions, language functions or transport are replaced.
add_action('shutdown', static function (): void {
    $path = getenv('PAIR_FIXTURE');
    if (! $path || ! function_exists('pll_get_post_language')) {
        return;
    }
    $design = ['colors' => [], 'spacingSizes' => []];
    $styles = get_posts(['post_type' => 'wp_global_styles', 'post_status' => 'publish', 'numberposts' => 1]);
    if ($styles) {
        $saved = json_decode($styles[0]->post_content, true);
        $design['colors'] = $saved['settings']['color']['palette']['custom'] ?? [];
    }
    $fixture = ['entries' => [], 'homes' => [], 'chrome' => [], 'design' => $design];
    $front = (int) get_option('page_on_front');
    $menus = PLL()->model->options->get('nav_menus');
    foreach (['pt', 'en'] as $slug) {
        $id = pll_get_post($front, $slug);
        $post = $id ? get_post($id) : null;
        $settings = ['title' => pll_translate_string(get_option('blogname'), $slug), 'description' => pll_translate_string(get_option('blogdescription'), $slug)];
        $fixture['homes'][$slug] = [
            $slug === 'pt' ? 'generalSettings' : 'language' => $settings,
            'nodeByUri' => $post && $post->post_status === 'publish' ? ['__typename' => 'Page', 'id' => base64_encode('post:' . $id), 'isFrontPage' => true, 'title' => $post->post_title, 'content' => $post->post_content] : null,
            'designTokens' => $design,
        ];
        $items = wp_get_nav_menu_items($menus[get_option('stylesheet')]['primary'][$slug] ?? 0) ?: [];
        $image = static fn($option) => get_option($option) ? ['node' => ['sourceUrl' => 'https://media.test/' . get_option($option) . '.png', 'altText' => 'Proof']] : null;
        $fixture['chrome'][$slug] = [
            'generalSettings' => ['siteLogo' => $image('site_logo'), 'siteIcon' => $image('site_icon')],
            'menuItems' => ['nodes' => array_map(static fn($item) => ['id' => (string) $item->ID, 'parentId' => null, 'label' => $item->title, 'url' => $item->url, 'target' => null], $items)],
        ];
    }
    foreach (get_posts(['post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'lang' => '']) as $post) {
        $slug = pll_get_post_language($post->ID);
        if (! in_array($slug, ['pt', 'en'], true)) {
            continue;
        }
        if (pll_get_post($front, $slug) === $post->ID) {
            continue;
        }
        $uri = parse_url(get_permalink($post), PHP_URL_PATH);
        $translations = [];
        foreach (pll_get_post_translations($post->ID) as $other => $id) {
            if ($other !== $slug && get_post_status($id) === 'publish') {
                $translations[] = ['uri' => parse_url(get_permalink($id), PHP_URL_PATH), 'language' => ['slug' => $other]];
            }
        }
        $fixture['entries'][$uri] = ['id' => base64_encode('post:' . $post->ID), 'uri' => $uri, 'title' => $post->post_title, 'content' => $post->post_content, 'status' => 'publish', 'isRestricted' => false, 'featuredImage' => null, 'language' => ['slug' => $slug], 'translations' => $translations];
    }
    // Empty PHP maps must remain JSON objects at the boundary.
    $fixture['entries'] = (object) $fixture['entries'];
    file_put_contents($path, json_encode($fixture, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}, 900);
