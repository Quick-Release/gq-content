<?php
$post_id = wp_insert_post([
    'post_type' => 'page',
    'post_status' => 'publish',
    'post_title' => 'Configuration proof',
    'post_content' => 'Saved even without event configuration',
], true);
if (is_wp_error($post_id)) {
    throw new RuntimeException('Configuration must not break saves');
}
update_option('blogdescription', wp_generate_uuid4());
echo $post_id;
