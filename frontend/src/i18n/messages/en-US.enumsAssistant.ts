// SPDX-License-Identifier: Apache-2.0
/**
 * Enum display names: the assistant domain (`types/assistant.ts` protocol values).
 *
 * `default` / `off` / `low` / `medium` / `high` stand for the reasoning-effort protocol
 * values `""` / `none` / `low` / `medium` / `high`. The protocol values themselves are
 * never translated and never enter a language pack; this file only holds the human-facing
 * side. The mapping table lives in `i18n/enum/assistant.ts` and is resolved with `t()`
 * at render time.
 *
 * Values mirror `REASONING_EFFORT_OPTIONS[].label` one-for-one, so the Chinese rendering
 * stays byte-identical while English stops showing Chinese.
 *
 * Colours, icons and the option order are protocol-layer attributes and stay in
 * `types/assistant.ts`.
 */
const enumsAssistant = {
  /** No value is sent, so the provider default applies. */
  "enumsAssistant.reasoningEffort.default": "Default",
  /** Reasoning is explicitly turned off. */
  "enumsAssistant.reasoningEffort.off": "Off",
  "enumsAssistant.reasoningEffort.low": "Low",
  "enumsAssistant.reasoningEffort.medium": "Medium",
  "enumsAssistant.reasoningEffort.high": "High",
} as const;

export default enumsAssistant;
