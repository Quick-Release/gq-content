<?php
// Consumer of the documented scheduler filter; no runtime function calls/mocks.
add_filter('gq_events_deliveries', static function (array $rows): array {
    $recorded = get_option('gq_proof_extension', []);
    for ($i = 0; $i < 3; $i++) {
        $event = ['site' => trim(getenv('GQ_CONTENT_SITE_ID')), 'id' => 'extension-check-' . $i,
            'action' => 'check', 'occurredAt' => 1700000000000 + $i];
        $row = ['subject' => 'proof:' . $i, 'label' => 'Extension check',
            'event' => $event, 'delivery' => $recorded[$i]['delivery'] ?? ['status' => 'pending', 'attempts' => 0, 'queuedAt' => 1],
            'deliver' => static function (array $received) use ($event, $i): array {
                if ($received !== $event) throw new RuntimeException('Callback event changed');
                file_put_contents(GQ_PROOF_MARKER, 'started');
                sleep(23);
                $body = wp_json_encode($received);
                $timestamp = (string) time();
                $response = wp_remote_post(getenv('GETQUICK_FRONTEND_URL') . '/gq/events', [
                    'headers' => ['Content-Type' => 'application/json', 'GQ-Event-Timestamp' => $timestamp,
                        'GQ-Event-Signature' => 'v1=' . hash_hmac('sha256', $timestamp . '.' . $body, getenv('PUBLICATION_EVENT_SECRET'))],
                    'body' => $body, 'timeout' => 15,
                ]);
                $outcome = ['status' => !is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200 ? 'refreshed' : 'failed',
                    'attempts' => 1, 'attemptedAt' => time(), 'callbackOwned' => true];
                // The callback owns recording. The scheduler must not invent a store.
                $all = get_option('gq_proof_extension', []);
                $all[$i] = ['event' => $received, 'delivery' => $outcome];
                update_option('gq_proof_extension', $all, false);
                return $outcome;
            }];
        if ($i === 0) $row['post'] = 123;
        $rows[] = $row;
    }
    return $rows;
});
