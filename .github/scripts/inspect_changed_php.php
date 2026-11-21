<?php
// Copyright 2026 Adobe. All rights reserved.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

// Tokenizes text only. Never include, evaluate or execute the submitted PHP.
if (!extension_loaded('tokenizer')) {
    fwrite(STDERR, "Tokenizer unavailable\n");
    exit(1);
}
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
function risks(string $source): array
{
    $tokens = array_values(array_filter(token_get_all($source), static function ($t) {
        return !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true);
    }));
    $text = static fn($t) => is_array($t) ? $t[1] : $t;
    $nameTokenIds = [T_STRING, T_NAMESPACE];
    foreach (['T_NAME_FULLY_QUALIFIED', 'T_NAME_QUALIFIED', 'T_NAME_RELATIVE'] as $constant) {
        if (defined($constant)) {
            $nameTokenIds[] = constant($constant);
        }
    }
    $normalized = [];
    for ($i = 0; $i < count($tokens); $i++) {
        $token = $tokens[$i];
        if ((is_array($token) && in_array($token[0], $nameTokenIds, true)) || $text($token) === '\\') {
            $name = $text($token);
            $end = $i;
            if ($name === '\\' && isset($tokens[$end + 1]) &&
                is_array($tokens[$end + 1]) && $tokens[$end + 1][0] === T_STRING) {
                $name .= $text($tokens[++$end]);
            }
            while (isset($tokens[$end + 2]) && $text($tokens[$end + 1]) === '\\' &&
                is_array($tokens[$end + 2]) && $tokens[$end + 2][0] === T_STRING) {
                $name .= '\\' . $text($tokens[$end + 2]);
                $end += 2;
            }
            if (strpos($name, '\\') !== false && $name !== '\\') {
                $normalized[] = [T_STRING, $name];
                $i = $end;
                continue;
            }
        }
        $normalized[] = $token;
    }
    $tokens = $normalized;
    $found = [];
    $dangerous = ['eval', 'exec', 'shell_exec', 'system', 'unserialize', 'passthru',
        'popen', 'proc_open', 'call_user_func', 'call_user_func_array'];
    for ($i = 0; $i < count($tokens); $i++) {
        $t = $tokens[$i];
        $name = strtolower(ltrim($text($t), '\\'));
        $previous = $i ? strtolower($text($tokens[$i - 1])) : '';
        $next = isset($tokens[$i + 1]) ? $text($tokens[$i + 1]) : '';
        $kind = null;
        if ($t === '`') {
            $kind = 'backtick-execution';
        } elseif (is_array($t) && in_array($t[0], [T_INCLUDE, T_INCLUDE_ONCE,
            T_REQUIRE, T_REQUIRE_ONCE], true)) {
            $kind = 'include-or-require-review';
        } elseif (is_array($t) && in_array($t[0], [T_STRING, T_EVAL, T_VARIABLE], true)
            && $next === '(' && !in_array($previous, ['->', '?->', '::', 'function', 'new'], true)) {
            if (in_array($name, $dangerous, true)) {
                $kind = $name;
            } elseif ($t[0] === T_VARIABLE || strpos($name, '\\') !== false) {
                $kind = 'indirect-call-review';
            } elseif ($name === 'file_get_contents') {
                $argument = $tokens[$i + 2] ?? '';
                // Only one plain local literal with no concatenation is classed as local.
                $literal = is_array($argument) && $argument[0] === T_CONSTANT_ENCAPSED_STRING;
                $value = $literal ? substr($argument[1], 1, -1) : '';
                $end = isset($tokens[$i + 3]) ? $text($tokens[$i + 3]) : '';
                if (!$literal || !in_array($end, [',', ')'], true) || strpos($value, '\\') !== false
                    || strpos($value, ':') !== false || strpos($value, '/') === 0
                    || preg_match('~(?:^|/)\.\.(?:/|$)~', $value) === 1) {
                    $kind = 'file_get_contents-external-or-uncertain';
                }
            }
        } elseif (is_array($t) && in_array($name, ['reflectionfunction', 'reflectionmethod'], true)) {
            $kind = 'reflection-review';
        }
        if ($kind !== null) {
            $expression = [];
            $depth = 0;
            for ($j = $i; $j < count($tokens); $j++) {
                $part = $text($tokens[$j]);
                $expression[] = $part;
                if ($part === '(') $depth++;
                if ($part === ')' && --$depth <= 0) break;
                if ($part === ';' || ($j > $i && $part === '`')) break;
            }
            $fingerprint = hash('sha256', json_encode([$kind, $expression], JSON_THROW_ON_ERROR));
            $found[] = ['kind' => $kind, 'fingerprint' => $fingerprint];
        }
    }
    return $found;
}
$before = risks($input['before']);
$remaining = array_count_values(array_column($before, 'fingerprint'));
$introduced = [];
foreach (risks($input['after']) as $risk) {
    if (($remaining[$risk['fingerprint']] ?? 0) > 0) {
        $remaining[$risk['fingerprint']]--;
    } else {
        $introduced[] = $risk;
    }
}
echo json_encode(['introduced' => $introduced, 'baselineCount' => count($before)], JSON_THROW_ON_ERROR);
