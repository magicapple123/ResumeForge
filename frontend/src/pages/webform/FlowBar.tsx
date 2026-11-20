// SPDX-License-Identifier: Apache-2.0
/**
 * 流程条：当前步 + **这一步的动作**。
 *
 * ## 两档形态，一套步骤（I-24）
 *
 * - `wide`（onboarding，整页宽）：四个节点横排 + 连接线，主 CTA 在**轨道右端**；
 * - `compact`（预览/结果态左栏 ~400px）：`2 / 4 · 标题` 一行文字 + 四段进度条。
 *
 * 两档共用 `STEP_TITLE_KEYS`：步数永远是 4，onboarding 与预览态之间切换不会跳变。
 * 窄档那种写法保留至今的原因见下。
 *
 * ## 为什么不用 antd `Steps`
 *
 * 四个中文步骤名要横排进 400px 左栏，实测每步只剩 ~70px，渲染成「自动浏 / 览」
 * 「核对映 / 射」「填 / 充」——每步断成两行，比不给进度还难读。改成
 * 「2 / 4 · 打开网申页」一行文字 + 四段进度条：文字负责说清第几步，进度条只承担
 * "还剩多少"的视觉暗示，不再争夺横向空间。窄到 320px 也只折成两行文字，不会断字。
 *
 * 宽档同理不做"每步一个小方块"：宽度不够时整条退回窄档形态（同一份文字，不是第二套步骤）。
 *
 * 未就绪时按钮禁用，**原因与按钮同排**——只把按钮灰掉、不写原因，用户只会以为功能坏了。
 *
 * 纯 props 组件；props 在击键路径上稳定，`memo` 让打字时整块跳过重渲。
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { memo } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormSnapshot } from "../../types";
import type { WebFormBusyState } from "./constants";

/** 四个步骤的文案键，顺序即流程顺序。 */
const STEP_TITLE_KEYS = [
  "webFormPage.readSnapshot.step.startBrowser",
  "webFormPage.readSnapshot.step.openPage",
  "webFormPage.readSnapshot.step.reviewMapping",
  "webFormPage.readSnapshot.step.fill",
] as const;

/**
 * **memo**：step/running/busy/snapshot 与稳定的 onRead 都在击键路径之外，
 * 打字时整块跳过重渲。
 */
export const FlowBar = memo(function FlowBar({
  step,
  running,
  busy,
  snapshot,
  onRead,
  variant = "compact",
  action,
  sampleLocked = false,
}: {
  step: number;
  running: boolean;
  busy: WebFormBusyState;
  snapshot: WebFormSnapshot | null;
  onRead: () => void;
  /** `wide` = onboarding 整页宽轨道；`compact` = 左栏那一条。 */
  variant?: "compact" | "wide";
  /** 宽档的轨道右端动作：唯一主 CTA 由页面按当前状态给，本组件不判断该点哪个。 */
  action?: ReactNode;
  /** 当前数据集是「体验示例」：读取当前表单这一步不成立（示例数据不参与真实填表）。 */
  sampleLocked?: boolean;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后进度与摘要不重渲染。
  useLocale();
  const total = STEP_TITLE_KEYS.length;
  // step 由页面派生（0..3），越界时夹住，别让 `progressValue` 出现 "5 / 4"。
  const current = Math.min(Math.max(step, 0), total - 1);
  const progressText = t("webFormPage.flow.progressValue", {
    current: current + 1,
    total,
    title: t(STEP_TITLE_KEYS[current]),
  });
  if (variant === "wide") {
    return (
      <div className="webform-flow-bar is-wide" data-testid="webform-flow-wide">
        {/* 窄档（容器 < 1080）显示这一行，宽档显示节点。都是同一份文字：
            用 display:none 切换，屏幕阅读器读到的也只会是一份。 */}
        <span className="webform-flow-compact-text">{progressText}</span>
        <ol className="webform-flow-nodes" aria-label={t("webFormPage.flow.progressTitle")}>
          {STEP_TITLE_KEYS.map((key, index) => {
            const state = index < current ? "done" : index === current ? "current" : "todo";
            return (
              <li
                key={key}
                className={`webform-flow-node is-${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="webform-flow-node-num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="webform-flow-node-title">{t(key)}</span>
                {index < total - 1 ? (
                  <span
                    className={`webform-flow-link${index < current ? " is-done" : ""}`}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        {action ? <div className="webform-flow-slot">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className="webform-flow-bar">
      <div className="webform-flow-head">
        <span className="webform-flow-title">{t("webFormPage.flow.progressTitle")}</span>
        <span className="webform-flow-value">{progressText}</span>
      </div>
      {/* 进度条只是视觉冗余：第几步、叫什么，上面那行文字已经说全了。
          给读屏器再念一遍四个步骤名没有意义，所以整条 aria-hidden。 */}
      <div className="webform-flow-track" aria-hidden="true">
        {STEP_TITLE_KEYS.map((key, index) => (
          <span key={key} className={`webform-flow-seg${index <= current ? " is-done" : ""}`} />
        ))}
      </div>
      <div className="webform-flow-action">
        <Button
          type="primary"
          icon={<FileSearchOutlined />}
          disabled={!running || sampleLocked}
          loading={busy === "read"}
          onClick={onRead}
        >
          {t("webFormPage.readSnapshot.read")}
        </Button>
        <Typography.Text type="secondary" className="webform-flow-reason">
          {sampleLocked
            ? t("webFormPage.sampleLocked.hint")
            : running
              ? t("webFormPage.readSnapshot.hint")
              : t("webFormPage.flow.reason.browserOff")}
        </Typography.Text>
      </div>
      {snapshot ? (
        <Typography.Text type="secondary" className="webform-flow-summary">
          {t("webFormPage.readSnapshot.summary", {
            title: snapshot.page.title || t("webFormPage.readSnapshot.untitled"),
            url: snapshot.page.url,
            count: snapshot.page.control_count,
          })}
        </Typography.Text>
      ) : null}
    </div>
  );
});
