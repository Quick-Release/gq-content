<?php
// Site-owned fixture: two public custom post types with archives, as Nomia's
// nomia-cpt registers them (an archive at the type's slug, items under it).
add_action('init', static function (): void {
    foreach (['biblioteca' => ['Biblioteca', 'Bibliotecas'], 'eventos' => ['Evento', 'Eventos']] as $type => [$single, $plural]) {
        register_post_type($type, [
            'label' => $plural,
            'public' => true,
            'has_archive' => $type,
            'rewrite' => ['slug' => $type, 'with_front' => false],
            'supports' => ['title', 'editor', 'excerpt'],
            'taxonomies' => $type === 'biblioteca' ? ['category'] : [],
            'show_in_graphql' => true,
            'graphql_single_name' => $single,
            'graphql_plural_name' => $plural,
        ]);
    }
});
