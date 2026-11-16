// SPDX-License-Identifier: Apache-2.0
/** Append-only exceptions for values whose spelling is independent of locale. */
export const EQUALITY_EXEMPT_KEYS = {
  // A language selector displays the language's native self-name in every locale.
  "resume.language.en-US": "The native language name is English",
  // This is a separator between user-provided values, not a sentence.
  "jobs.candidate.import.preview-meta": "Company and filename interpolation format",
  // Existing consumers use this value as CSS, not as rendered text.
  "outline.canvas.highlight.style": "Canvas highlight CSS declaration",
  // A DOI example is an identifier with an invariant syntax.
  "research.publications.doiPlaceholder": "DOI example identifier",
  // This is a conventional bibliography volume and page-range example.
  "research.publications.volumePagesPlaceholder": "Bibliography volume and pages syntax",
  // A sample URL must remain a valid URL in both languages.
  "typography.inline.linkPlaceholder": "Example URL",
  // The column-gap suffix is a unit ("mm"), not a sentence: both languages keep it.
  "structure.layout.gapMillimeters": "Unit suffix mm, identical in both languages",
  // These are technical examples (a URL and a Cookie header), not prose.
  "trackProbe.pageUrlExample": "Example URL, must remain a valid URL in both languages",
  "trackProbe.cookieExample": "Example Cookie header syntax, identical in both languages",
  // These placeholders concatenate labels that have already been translated.
  "versions.variants.exportOption": "Translated variant label interpolation format",
  // The middle dot is a separator before a user-provided job title.
  "versions.variants.exportOption.job": "Job title interpolation separator",
  // Model usage uses the technical accounting unit, rather than English prose.
  "provenance.usage.tokens": "Model accounting unit token",
  // These are official export format names separated by slashes.
  "trial.export.all": "Official export format names",
  // Chinese recruiting says "Offer" too; the label is the same word in both languages.
  "trackerForm.status.offer": "Recruiting loanword spelled identically in both languages",
  // Provider brand names are spelled the same in every locale.
  "appConfig.preset.minimax": "Provider brand name, identical in both languages",
  "appConfig.preset.openai": "Provider brand name, identical in both languages",
  "appConfig.preset.xai": "Provider brand name spelled identically",
  "appConfig.preset.mistral": "Provider brand name spelled identically",
  // The speech protocol is named after the provider, so the label is the brand in both languages.
  "voiceInput.settings.protocol.deepseek": "Provider brand name, identical in both languages",
  // The API key label is the same technical term in Chinese UI (original copy used "API Key").
  "userGuide.setupProfile.step1.point9.lead":
    "Technical term used verbatim in the original Chinese copy",
  // Memory history renders "before → after": two user values around an arrow, not prose.
  "assistantMemory.history.changed": "Value interpolation around an arrow separator",
  // 记忆行的元信息 = 来源标签 + 更新时间，两个都已翻译，中间只有一个分隔符（与上面
  // `interviewReview.header.meta` 同一情形）：这句本身不含散文。
  "assistantMemory.meta.line": "Separator between two already-translated values",
  // The interviewer's given name is spelled "Jane" in every locale (a name, not prose).
  "interviewPage.interviewerName": "Person name, identical in both languages",
  // 复盘查看态的头部副信息：只有「时间 · 目标」两个已翻译的插值 + 一个分隔符，没有散文。
  "interviewReview.header.meta": "Separator between two already-translated values",
  // Search provider brand name, spelled the same in every locale.
  "searchCard.source.deepseek": "Provider brand name, identical in both languages",
  "searchCard.source.tavily": "Provider brand name, identical in both languages",
  "searchCard.source.jina": "Provider brand name, identical in both languages",
  // 版本徽章是记号（v1 / v2…）而不是散文：字母是记号的一部分，中文侧也不能写成"第 1 版"，
  // 否则版本条与文档、测试里对同一个功能的叫法就对不上。
  "writing.version.label": "Version token v1/v2, identical in both languages",
  // TTS / ASR 服务商品牌名：中文界面里同样写作"DeepSeek"，不属于可翻译散文。
  "ttsProvider.deepseek": "Provider brand name, identical in both languages",
  "voiceInput.settings.provider.deepseek": "Provider brand name, identical in both languages",
} as const satisfies Readonly<Record<string, string>>;

export function isEqualityExempt(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(EQUALITY_EXEMPT_KEYS, key);
}
