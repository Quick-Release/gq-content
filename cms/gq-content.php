<?php
/**
 * Plugin Name: GETQUICK Content
 * Description: Publication events, settings events, delivery retries and diagnostics.
 * Version: 0.1.0
 * Author: GETQUICK
 * License: GPL-2.0-or-later
 * Requires PHP: 8.4.1
 */

declare(strict_types=1);

namespace GetQuick\Content;

if (! defined('ABSPATH')) {
    exit;
}

const PACKAGE = 'getquick/gq-content';
const VERSION = '0.1.0';

require_once __DIR__ . '/modules/publication-events.php';
require_once __DIR__ . '/modules/settings-events.php';
require_once __DIR__ . '/modules/delivery-retries.php';

add_filter('debug_information', static function (array $information): array {
    $information['gq_content'] = [
        'label' => 'GETQUICK Content',
        'fields' => [
            'package' => ['label' => 'Package', 'value' => PACKAGE],
            'version' => ['label' => 'Version', 'value' => VERSION],
            'configured' => [
                'label' => 'Configured',
                'value' => \GetQuick\Site\PublicationEvents\configuration_failure() === null,
            ],
        ],
    ];

    return $information;
});
