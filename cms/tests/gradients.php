<?php
// getquickGradients in real WordPress and WPGraphQL: the merged default,
// theme and custom gradient presets, a later origin's slug replacing an earlier one's.
add_filter('wp_theme_json_data_theme', static fn(WP_Theme_JSON_Data $theme): WP_Theme_JSON_Data => $theme->update_with([
    'version' => 3,
    'settings' => ['color' => ['gradients' => [
        ['slug' => 'title-band', 'name' => 'Title band', 'gradient' => 'linear-gradient(90deg, #cde5e3 0%, rgba(255,255,255,0) 100%)'],
        ['slug' => 'cool-to-warm-spectrum', 'name' => 'Theme spectrum', 'gradient' => 'linear-gradient(90deg, #000 0%, #fff 100%)'],
    ]]],
]));
wp_clean_theme_json_cache();
$result = graphql(['query' => '{ getquickGradients { slug gradient } }']);
$gradients = array_column($result['data']['getquickGradients'] ?? [], 'gradient', 'slug');
echo wp_json_encode([
    'errors' => $result['errors'] ?? null,
    'theme' => $gradients['title-band'] ?? null,
    'override' => $gradients['cool-to-warm-spectrum'] ?? null,
    'default' => isset($gradients['vivid-cyan-blue-to-vivid-purple']),
    'unique' => count($gradients) === count($result['data']['getquickGradients'] ?? []),
]);
