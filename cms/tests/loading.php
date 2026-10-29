<?php
$plugin = WPMU_PLUGIN_DIR . '/gq-content/';
$loaded = array_values(array_map('basename', array_filter(get_included_files(),
    static fn(string $path): bool => str_starts_with($path, $plugin))));
$expected = ['gq-content.php', 'publication-events.php', 'settings-events.php', 'delivery-retries.php', 'archives.php', 'forms.php'];
if ($loaded !== $expected) {
    throw new RuntimeException('Entry point must load exactly five modules in dependency order');
}
require_once $plugin . 'gq-content.php';
foreach (glob($plugin . 'modules/*.php') as $module) {
    require_once $module;
}
$debug = apply_filters('debug_information', []);
if ($debug['gq_content']['fields']['version']['value'] !== '0.4.2') {
    throw new RuntimeException('Entry remains available after repeated require_once');
}
echo 'loaded-once-in-order';
