<?php
// Public installed-plugin seams: WP hooks, CLI and Site Health. No WP stubs.
$tests = apply_filters('site_status_tests', []);
if (! isset($tests['direct']['gq_public_delivery'])) {
    throw new RuntimeException('Existing health test identity must remain registered');
}
$health = ($tests['direct']['gq_public_delivery']['test'])();
$debug = apply_filters('debug_information', []);
$fields = $debug['gq_content']['fields'] ?? [];
echo wp_json_encode(['health' => $health, 'fields' => $fields]);
