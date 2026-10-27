// SPDX-License-Identifier: Apache-2.0
/**
 * Model configuration dialog, advanced section: leave-empty hint, the Top P / penalty /
 * seed / stop-sequence labels and help, thinking parameter style, and the two protocol notes.
 */
const advancedParams = {
  "advancedParams.alert.emptyNotSent":
    "Blank parameters are not sent to the model service, so the provider applies its defaults. Not every provider supports these parameters; check the provider docs before filling them in.",
  "advancedParams.placeholder.leaveEmpty": "Blank = not sent",
  "advancedParams.tooltip.topP":
    "Nucleus sampling: only the candidates whose cumulative probability reaches this value are used. It stacks with temperature, so usually tune just one of them.",
  "advancedParams.field.frequencyPenalty": "Frequency penalty",
  "advancedParams.tooltip.frequencyPenalty":
    "-2 to 2. Positive values discourage repeated words, negative values encourage repetition.",
  "advancedParams.field.presencePenalty": "Presence penalty",
  "advancedParams.tooltip.presencePenalty":
    "-2 to 2. Positive values encourage new topics, negative values keep the model closer to the topic.",
  "advancedParams.field.seed": "Random seed",
  "advancedParams.tooltip.seed":
    "With a fixed seed the same request is more likely to reproduce the same output; whether it takes effect depends on the provider.",
  "advancedParams.tooltip.topK":
    "Only the K most likely candidates are used. Supported by Anthropic and some open models; the official OpenAI API ignores it.",
  "advancedParams.field.repetitionPenalty": "Repetition penalty",
  "advancedParams.tooltip.repetitionPenalty":
    "Above 1 it discourages repeated words. Similar in effect to the frequency penalty but computed differently, so usually use only one of them.",
  "advancedParams.field.thinkingBudget": "Thinking budget",
  "advancedParams.tooltip.thinkingBudget":
    "Extended-thinking token budget under Claude's native protocol. 0 turns thinking off explicitly; blank means the field is not sent. It only applies when the protocol is Anthropic native. Once set, the thinking mode switch above takes precedence; this is a legacy option for precise budget control.",
  "advancedParams.field.thinkingStyle": "Thinking parameter style",
  "advancedParams.tooltip.thinkingStyle":
    "Which shape the request body uses when thinking is on. auto means infer it from the API protocol and provider (pick this in most cases); switch manually only behind a relay or self-hosted gateway, or when the thinking-support check says the parameter is rejected.",
  "advancedParams.field.stop": "Stop sequences",
  "advancedParams.tooltip.stop":
    "The model stops when it generates one of these (up to 4). Press Enter to confirm each; blank = not sent.",
  "advancedParams.placeholder.stop": "Type and press Enter, up to 4",
  "advancedParams.alert.protocolNote":
    "The thinking budget, Top K and similar parameters only matter once the protocol is Anthropic native; OpenAI-compatible endpoints ignore them. The thinking budget and the thinking mode switch are two generations of the same setting: a budget wins when set, otherwise the switch and effort decide.",
} as const;

export default advancedParams;
