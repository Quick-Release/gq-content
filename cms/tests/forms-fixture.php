<?php
/*
 * P2's stand-in for Gravity Forms (a licensed plugin the proof can't
 * install): the classes and hooks gq-content's forms module uses, with the
 * shapes Gravity Forms 3.2.0 gives them. Forms live in the option
 * `proof_gf_forms`, including what a real form carries and the descriptor
 * must never expose (notifications, feeds settings, entries limits).
 */

class GFForms
{
    public static $version = '3.2.0-proof';
}

#[\AllowDynamicProperties]
class ProofGFField
{
    public function __construct(array $properties)
    {
        foreach ($properties as $name => $value) {
            $this->$name = $value;
        }
    }

    public function get_input_type(): string
    {
        return (string) ($this->inputType ?? '') ?: (string) $this->type;
    }
}

class GFFormsModel
{
    public static function get_latest_form_revisions_id($form_id)
    {
        return (string) get_option("proof_gf_revision_$form_id", '3');
    }
}

class GFAPI
{
    public static function get_form($form_id)
    {
        $forms = get_option('proof_gf_forms', []);
        $form = $forms[(int) $form_id] ?? null;
        if (! is_array($form)) {
            return false;
        }
        $form['fields'] = array_map(static fn(array $field) => new ProofGFField($field), $form['fields'] ?? []);

        return $form;
    }
}
