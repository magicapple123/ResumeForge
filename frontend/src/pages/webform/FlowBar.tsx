// SPDX-License-Identifier: Apache-2.0
/**
 * 流程条：当前步 + **这一步的动作**。
 *
 * ## 为什么不用 antd `Steps`
 *
 * 四个中文步骤名要横排进 400px 左栏，实测每步只剩 ~70px，渲染成「自动浏 / 览」
 * 「核对映 / 射」「填 / 充」——每步断成两行，比不给进度还难读。改成
 * 「2 / 4 · 打开网申页」一行文字 + 四段进度条：文字负责说清第几步，进度条只承担
 * "还剩多少"的视觉暗示，不再争夺横向空间。窄到 320px 也只折成两行文字，不会断字。
 *
 * 未就绪时按钮禁用，**原因与按钮同排**——只把按钮灰掉、不写原因，用户只会以为功能坏了。
 *
 * 纯 props 组件；props 在击键路径上稳定，`memo` 让打字时整块跳过重渲。
 */
import { FileSearchOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import { memo } from "react";
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
}: {
  step: number;
  running: boolean;
  busy: WebFormBusyState;
  snapshot: WebFormSnapshot | null;
  onRead: () => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后进度与摘要不重渲染。
  useLocale();
  const total = STEP_TITLE_KEYS.length;
  // step 由页面派生（0..3），越界时夹住，别让 `progressValue` 出现 "5 / 4"。
  const current = Math.min(Math.max(step, 0), total - 1);
  return (
    <div className="webform-flow-bar">
      <div className="webform-flow-head">
        <span className="webform-flow-title">{t("webFormPage.flow.progressTitle")}</span>
        <span className="webform-flow-value">
          {t("webFormPage.flow.progressValue", {
            current: current + 1,
            total,
            title: t(STEP_TITLE_KEYS[current]),
          })}
        </span>
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
          disabled={!running}
          loading={busy === "read"}
          onClick={onRead}
        >
          {t("webFormPage.readSnapshot.read")}
        </Button>
        <Typography.Text type="secondary" className="webform-flow-reason">
          {running ? t("webFormPage.readSnapshot.hint") : t("webFormPage.flow.reason.browserOff")}
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
