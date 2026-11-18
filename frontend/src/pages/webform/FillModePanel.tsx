// SPDX-License-Identifier: Apache-2.0
/**
 * 「怎么填」：四行开关，一行一件事。
 *
 * 四行依次是取数范围 / 放宽模式 / 未识别字段智能辅助 / 智能逐项填表——
 * 它们此前分散在四张互不相邻的卡里（其中两张还会随"渐进展开"整块消失），
 * 现在固定成四行，**没有一行会被藏起来**：无模型时 AI 行仍然在，只是禁用并写明原因
 * （开关能用却毫无效果是最糟的形态，用户会以为功能坏了）。
 *
 * 本组件不持有状态：四行的开关语义分别由各自的子组件与页面 handler 负责。
 */
import HintDetail from "../../components/common/HintDetail";
import { LockOutlined } from "@ant-design/icons";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import type { WebFormLive, WebFormScope } from "../../types";
import type { WebFormBusyState } from "./constants";
import { AiAssistCard } from "./AiAssistCard";
import { LiveModeCard } from "./LiveModeCard";
import { RelaxedModeCard } from "./RelaxedModeCard";
import { ScopeSwitchCard } from "./ScopeSwitchCard";

export function FillModePanel({
  scope,
  scopeDisabled,
  onScopeChange,
  aiOn,
  aiAvailable,
  onAiEnabledChange,
  live,
  liveEnabled,
  running,
  busy,
  rememberPending,
  alternatives,
  onLiveToggle,
  onRequestMemoryDialog,
}: {
  scope: WebFormScope;
  scopeDisabled: boolean;
  onScopeChange: (scope: WebFormScope) => void;
  aiOn: boolean;
  aiAvailable: boolean | null;
  onAiEnabledChange: (enabled: boolean) => void;
  live: WebFormLive | null;
  liveEnabled: boolean;
  running: boolean;
  busy: WebFormBusyState;
  rememberPending: WebFormLive["remember_pending"];
  alternatives: WebFormLive["alternatives"];
  onLiveToggle: () => void;
  onRequestMemoryDialog: () => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后标题与说明不重渲染。
  useLocale();
  const aiLiveRunning = live?.running;
  return (
    <section className="webform-fill-mode-panel" aria-label={t("webFormPage.fillMode.title")}>
      <h3 className="webform-panel-title">{t("webFormPage.fillMode.title")}</h3>
      <p className="webform-panel-hint">{t("webFormPage.fillMode.hint")}</p>
      <ScopeSwitchCard scope={scope} disabled={scopeDisabled} onChange={onScopeChange} />
      {/* 放宽模式不参与任何折叠：它的风险边界（四类始终不代填）必须在默认态就能看到。 */}
      <RelaxedModeCard />
      <AiAssistCard
        aiOn={aiOn}
        aiAvailable={aiAvailable}
        liveRunning={aiLiveRunning}
        onAiEnabledChange={onAiEnabledChange}
      />
      <LiveModeCard
        live={live}
        liveEnabled={liveEnabled}
        running={running}
        busy={busy}
        rememberPending={rememberPending}
        alternatives={alternatives}
        onToggle={onLiveToggle}
        onRequestMemoryDialog={onRequestMemoryDialog}
      />
      {/* 四类「始终不代填」压成一行常驻文字（#37 的边界不能藏），完整风险说明与
          "选错请核对"的提醒收进 ⓘ——那是开启前该读一次、之后不必占两行的内容。
          锁图标是"这是产品边界、不是补充说明"的第二重线索（I-24）。 */}
      <div className="webform-mode-boundary">
        <LockOutlined className="webform-mode-boundary-icon" aria-hidden="true" />
        <span className="webform-mode-boundary-text">{t("webFormPage.fillMode.boundary")}</span>
        <HintDetail
          detail={t("webFormPage.relaxed.risk")}
          label={t("webFormPage.relaxed.hintAria")}
        />
      </div>
    </section>
  );
}
