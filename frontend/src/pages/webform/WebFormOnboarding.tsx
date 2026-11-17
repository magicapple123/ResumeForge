// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态版面：三步横排动作卡 + 两栏「怎么填 / 最近填写」。
 *
 * ## 为什么改成动作卡
 *
 * 上一版是右栏里一条竖排的三步说明，只能"读"，不能"做"：用户看完还得回到工具条找
 * 那颗同名按钮。现在每张卡自带按钮（编号 + 状态 + 标题 + 一句说明 + 按钮），当前步
 * 整块点亮、按钮可用，其余两步的按钮 disabled——同屏只有一个"下一步"。
 *
 * ## 为什么第 2 步一启动浏览器就算完成
 *
 * 「在浏览器里打开目标网页」发生在受控浏览器内部，前端**观测不到**。把它当成未完成，
 * 第 3 步（读取）就会永久禁用——而用户完全可能已经在那儿登录并打开了表单。所以
 * 判据降到"浏览器已启动"，真正的完成度仍由第 3 步的 `hasSnapshot` 决定。
 *
 * ## 为什么卡片按钮不是 primary
 *
 * 同屏只能有一颗主按钮，它在工具条上（无网址时「开启专用浏览器」、有网址时「打开目标页」）。
 * 卡片用边框与底色表达"当前步"，不再复制一颗同名主按钮。
 *
 * 纯 props：所有 handler 由页面侧 useCallback 稳定。
 */
import { Button } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormBusyState } from "./constants";

export function WebFormOnboarding({
  running,
  hasSnapshot,
  targetUrl,
  busy,
  onStart,
  onOpenUrl,
  onRead,
  fillPanel,
  recentPanel,
}: {
  /** 专用浏览器是否在运行（第 1、2 步完成）。 */
  running: boolean;
  /** 是否已经读取过表单（第 3 步完成）。 */
  hasSnapshot: boolean;
  /** 地址栏里的目标网址：决定第 2 步的按钮能不能点。 */
  targetUrl: string;
  busy: WebFormBusyState;
  onStart: () => void;
  onOpenUrl: () => void;
  onRead: () => void;
  /** 左栏「怎么填」：页面的 `FillModePanel`，由页面注入以免在这里复制一套开关。 */
  fillPanel: ReactNode;
  /** 右栏「最近填写」：`WebFormRecentRecords`。 */
  recentPanel: ReactNode;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后引导文案不重渲染。
  useLocale();
  const hasUrl = targetUrl.trim().length > 0;
  /** 浏览器没起 → 当前步是"开启"；起了 → 当前步是"读取"（页面已在浏览器里打开）。 */
  const currentIndex = running ? 2 : 0;
  const steps = [
    {
      title: t("webFormPage.onboarding.step1"),
      hint: t("webFormPage.onboarding.step1Hint"),
      done: running,
      action: t("webFormPage.browserCard.start"),
      onClick: onStart,
      loading: busy === "start" && !hasUrl,
      blocked: false,
    },
    {
      title: t("webFormPage.onboarding.step2"),
      hint: t("webFormPage.onboarding.step2Hint"),
      done: running,
      action: t("webFormPage.urlBar.open"),
      onClick: onOpenUrl,
      loading: busy === "start" && hasUrl,
      blocked: !hasUrl,
    },
    {
      title: t("webFormPage.onboarding.step3"),
      hint: t("webFormPage.onboarding.step3Hint"),
      done: hasSnapshot,
      action: t("webFormPage.readSnapshot.read"),
      onClick: onRead,
      loading: busy === "read",
      blocked: !running,
    },
  ];

  return (
    <section
      className="webform-onboarding"
      aria-label={t("webFormPage.onboarding.title")}
      data-testid="webform-onboarding"
    >
      <div className="webform-onboarding-head">
        <h3 className="webform-onboarding-title">{t("webFormPage.onboarding.title")}</h3>
        <p className="webform-onboarding-lead">{t("webFormPage.onboarding.lead")}</p>
      </div>

      <ol className="webform-onboarding-steps">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const className = [
            "webform-onboarding-step",
            isCurrent ? "is-current" : "",
            step.done ? "is-done" : "",
          ]
            .filter(Boolean)
            .join(" ");
          // 当前步优先于"已完成"：重读同一页时第 3 步既是当前步，也早就完成过。
          const stateText = isCurrent
            ? t("webFormPage.onboarding.state.now")
            : step.done
              ? t("webFormPage.onboarding.state.done")
              : t("webFormPage.onboarding.state.todo");
          return (
            <li key={step.title} className={className}>
              <span className="webform-onboarding-step-head">
                {/* 序号是视觉冗余：`ol` 本来就按顺序播报，这里再念一次会变成 "1 第 1 步"。 */}
                <span className="webform-onboarding-num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="webform-onboarding-state">{stateText}</span>
              </span>
              <span className="webform-onboarding-step-title">{step.title}</span>
              <span className="webform-onboarding-step-hint">{step.hint}</span>
              <Button
                className="webform-onboarding-step-action"
                loading={isCurrent && step.loading}
                disabled={busy !== null || !isCurrent || step.blocked}
                onClick={step.onClick}
              >
                {step.action}
              </Button>
            </li>
          );
        })}
      </ol>

      <div className="webform-onboarding-columns">
        {fillPanel}
        {recentPanel}
      </div>
    </section>
  );
}
