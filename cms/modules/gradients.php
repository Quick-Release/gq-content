<?php

/*
 * The gradient presets, for the Frontend's design presets. GQ Design's
 * `designTokens` delivers the palette, spacing and fonts but no gradients, so
 * the `has-<slug>-gradient-background` classes and cover overlays that read
 * `var(--wp--preset--gradient--<slug>)` had nothing behind them.
 *
 * WPGraphQL's `getquickGradients` lists them as WordPress's merged global
 * settings hold them (theme.json `settings.color.gradients`, with saved
 * Global Styles on top): default, theme, then custom, a later origin's slug
 * replacing an earlier one's, as in the generated preset CSS. A change to them
 * reaches the Frontend with the design presets' settings event.
 */

declare(strict_types=1);

namespace GetQuick\Content\Gradients;

/**
 * Every gradient preset, a later origin's replacing an earlier one's by slug.
 *
 * @return list<array{slug: string, gradient: string}>
 */
function gradients(): array
{
    $settings = wp_get_global_settings(['color', 'gradients']);
    $gradients = [];
    foreach (['default', 'theme', 'custom'] as $origin) {
        foreach (is_array($settings[$origin] ?? null) ? $settings[$origin] : [] as $entry) {
            if (! is_array($entry) || ! is_string($entry['slug'] ?? null) || ! is_string($entry['gradient'] ?? null)) {
                continue;
            }
            $gradients[$entry['slug']] = ['slug' => $entry['slug'], 'gradient' => $entry['gradient']];
        }
    }

    return array_values($gradients);
}

add_action('graphql_register_types', static function (): void {
    register_graphql_object_type('GetquickGradient', [
        'description' => 'A gradient preset (theme.json settings.color.gradients).',
        'fields' => [
            'slug' => [
                'type' => ['non_null' => 'String'],
                'description' => 'Its slug: WordPress defines it as --wp--preset--gradient--<slug>.',
            ],
            'gradient' => [
                'type' => ['non_null' => 'String'],
                'description' => 'The CSS gradient, such as linear-gradient(90deg, #fff 0%, #000 100%).',
            ],
        ],
    ]);
    register_graphql_field('RootQuery', 'getquickGradients', [
        'type' => ['non_null' => ['list_of' => ['non_null' => 'GetquickGradient']]],
        'description' => 'Every gradient preset: the merged global settings\' default, theme and custom gradients, a later origin\'s slug replacing an earlier one\'s.',
        'resolve' => static fn(): array => gradients(),
    ]);
});
