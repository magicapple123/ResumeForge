// SPDX-License-Identifier: Apache-2.0
/**
 * 检查更新失败的中文归因：**只选 key + 提取原文**，文案本体在 i18n 里
 * （`update.error.why.*`，中英各一套）。
 *
 * 为什么是纯函数：归因是"读一段英文技术消息、判断它属于哪一种失败"，与 React 无关，
 * 可以逐条断言（`updateErrorText.test.ts`）；把中文写进本文件会让英文界面漏出一句中文，
 * `cjkRatchet` 也会把新增中文算进存量。
 *
 * 判定只看 `errorDetail` 的原文，**不猜**：
 * - 403 必须靠 `x-ratelimit-remaining: 0` 区分「匿名额度用完」（等一会儿就好）与
 *   「网络里有人拦了 api.github.com」（等多久都没用），判据与后端
 *   `services/update_check_degrade.build_api_error` 完全一致；
 * - 归类不出来的原文**原样显示**，绝不补一句「网络异常」——那句话看起来像原因，
 *   实际上把唯一的证据（状态码 / 主机名）盖掉了。
 *
 * 归因文案一律保留英文原文括注（`update.error.why.detail`）：用户反馈问题时可以直接
 * 复制那一行，不用去翻 `desktop-main.log`。
 */
import type { MessageKey, MessageParams } from "../../i18n";

/** 九类可归因的失败（403 按额度是否用完拆成两类）。 */
export type UpdateFailureReason =
  | "quota"
  | "rate"
  | "blocked"
  | "notFound"
  | "timeout"
  | "dns"
  | "refused"
  | "cert"
  | "json"
  | "semver";

/** 归因文案的 key（渲染处才 `t()`：模块作用域不许求值）。 */
export const FAILURE_REASON_KEYS: Record<UpdateFailureReason, MessageKey> = {
  quota: "update.error.why.quota",
  rate: "update.error.why.rate",
  blocked: "update.error.why.blocked",
  notFound: "update.error.why.notFound",
  timeout: "update.error.why.timeout",
  dns: "update.error.why.dns",
  refused: "update.error.why.refused",
  cert: "update.error.why.cert",
  json: "update.error.why.json",
  semver: "update.error.why.semver",
};

/** 原文括注的模板（`{detail}` 是主进程带出的技术原文）。 */
export const FAILURE_DETAIL_KEY: MessageKey = "update.error.why.detail";

interface FailureRule {
  /**
   * 归因类型。字段名叫 `kind` 而不是 `reason` 是**必须**的：`src/i18n/guards/productCopyAst`
   * 把 `reason` / `description` 这类属性名一律当成"界面文案的输出位"，`{ reason: "quota" }`
   * 会被 `cjkRatchet` 的 AST 棘轮算成一条新增产品文案（`unregistered product copy`）。
   * 这里放的是协议值，不是给用户看的字，别改回 `reason`。
   */
  kind: UpdateFailureReason;
  test: RegExp;
}

/**
 * 顺序即优先级：`403` 的三类必须排在通用规则之前，`semver` 要排在 `json` 之前
 * （`JSON` 那条是宽匹配）。
 */
const RULES: readonly FailureRule[] = [
  // 403 + 额度为 0 = 匿名额度用完。`[^;]*` 只在"主路径那一段"里找，跨不到备用探测
  // 那一段（两条都失败时原文是 `...403 (...); fallback probe failed: ...`）。
  { kind: "quota", test: /\b403\b[^;]*x-ratelimit-remaining:\s*0\b/i },
  { kind: "rate", test: /\b429\b/ },
  { kind: "blocked", test: /\b403\b/ },
  { kind: "notFound", test: /\b404\b/ },
  { kind: "semver", test: /not an exact stable semver/i },
  { kind: "timeout", test: /\bETIMEDOUT\b|\btimed?\s*out\b|\bAbortError\b|\btimeout\b/i },
  { kind: "dns", test: /\bENOTFOUND\b|\bEAI_AGAIN\b|\bgetaddrinfo\b/i },
  { kind: "refused", test: /\bECONNREFUSED\b|\bECONNRESET\b|\bECONNABORTED\b|\bEPIPE\b/i },
  { kind: "cert", test: /\bCERT_[A-Z_]+\b|\bself[- ]signed\b|\bcertificate\b/i },
  { kind: "json", test: /\bUnexpected token\b|\bnot valid JSON\b|\bJSON\b/i },
];

/** 一次归因的结果：`reason` 为 `null` 表示无法归类，此时只显示原文。 */
export interface UpdateFailureAttribution {
  reason: UpdateFailureReason | null;
  detail: string;
}

/**
 * 把主进程带来的原文归到九类之一。
 *
 * @param errorDetail 主进程 `errorDetail`（可能为空串，也可能被截断到 300 字）
 */
export function attributeUpdateFailure(errorDetail: string): UpdateFailureAttribution {
  const detail = (errorDetail ?? "").trim();
  if (!detail) return { reason: null, detail: "" };
  const rule = RULES.find((candidate) => candidate.test.test(detail));
  return { reason: rule ? rule.kind : null, detail };
}

/** `translate` 的形状与 i18n 的 `t` 一致，测试里可以换成记录 key 的替身。 */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * 归因 + 原文括注，拼成弹窗里那一行描述。
 *
 * - 没有原文 → 空串（调用方据此**不渲染**空描述）；
 * - 无法归类 → 原文本身（不编原因）；
 * - 可归类 → `t(为什么) + t("（原文：{detail}）")`。原文留在字符串里是硬要求：
 *   它是用户反馈问题时唯一能贴出来的证据。
 */
export function describeUpdateFailure(errorDetail: string, translate: Translate): string {
  const { reason, detail } = attributeUpdateFailure(errorDetail);
  if (!detail) return "";
  if (!reason) return detail;
  return `${translate(FAILURE_REASON_KEYS[reason])} ${translate(FAILURE_DETAIL_KEY, { detail })}`;
}
