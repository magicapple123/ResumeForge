// SPDX-License-Identifier: Apache-2.0
/**
 * 右栏空态：还没读取表单时，用「三步开始填写」占住结果区。
 *
 * ## 为什么需要它
 *
 * 在这之前，没有预览也没有填充结果时 `ResultPanel` 整块返回 `null`，右栏只剩一行折叠的
 * 「填写记录」。1440 宽的屏幕上，页面三分之二是白的，看起来像没做完；而左栏同时挤着
 * 四步流程 + 四行开关 + 四段说明——一边过载、一边空着。
 *
 * 空态**不放主按钮**：工具条上已经有一颗同名的「开启专用浏览器」，同屏两个一模一样的
 * 主入口只会让人犹豫该点哪个。它只做两件事——把流程讲清楚、指出下一步在哪儿。
 *
 * 只读 props，无状态：步骤完成度由 `running` 与 `hasSnapshot` 派生。
 */
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function WebFormOnboarding({
  running,
  hasSnapshot,
}: {
  /** 专用浏览器是否在运行（第 1 步完成）。 */
  running: boolean;
  /** 是否已经读取过表单（第 2、3 步完成）。 */
  hasSnapshot: boolean;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后引导文案不重渲染。
  useLocale();
  const steps = [
    {
      title: t("webFormPage.onboarding.step1"),
      hint: t("webFormPage.onboarding.step1Hint"),
      done: running,
    },
    {
      title: t("webFormPage.onboarding.step2"),
      hint: t("webFormPage.onboarding.step2Hint"),
      done: hasSnapshot,
    },
    {
      title: t("webFormPage.onboarding.step3"),
      hint: t("webFormPage.onboarding.step3Hint"),
      done: hasSnapshot,
    },
  ];
  /** 第一个没完成的步骤 = 当前步；全完成（极少见）时为 -1，不标任何一步。 */
  const currentIndex = steps.findIndex((step) => !step.done);
  const next = !running
    ? t("webFormPage.onboarding.next.start")
    : !hasSnapshot
      ? t("webFormPage.onboarding.next.read")
      : t("webFormPage.onboarding.next.fill");

  return (
    <section
      className="webform-onboarding"
      aria-label={t("webFormPage.onboarding.title")}
      data-testid="webform-onboarding"
    >
      {running ? null : (
        <span className="webform-onboarding-badge">{t("webFormPage.onboarding.badge")}</span>
      )}
      <h3 className="webform-onboarding-title">{t("webFormPage.onboarding.title")}</h3>
      <p className="webform-onboarding-lead">{t("webFormPage.onboarding.lead")}</p>
      <ol className="webform-onboarding-steps">
        {steps.map((step, index) => {
          const className = [
            "webform-onboarding-step",
            step.done ? "is-done" : "",
            index === currentIndex ? "is-current" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const stateText = step.done
            ? t("webFormPage.onboarding.state.done")
            : index === currentIndex
              ? t("webFormPage.onboarding.state.now")
              : t("webFormPage.onboarding.state.todo");
          return (
            <li key={step.title} className={className}>
              {/* 序号是视觉冗余：`ol` 本来就按顺序播报，这里再念一次会变成 "1 第 1 步"。 */}
              <span className="webform-onboarding-num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="webform-onboarding-body">
                <span className="webform-onboarding-step-title">{step.title}</span>
                <span className="webform-onboarding-step-hint">{step.hint}</span>
              </span>
              <span className="webform-onboarding-state">{stateText}</span>
            </li>
          );
        })}
      </ol>
      <p className="webform-onboarding-next">{next}</p>
    </section>
  );
}
