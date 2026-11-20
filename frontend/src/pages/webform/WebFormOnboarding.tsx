// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态版面（I-24）：一条流程轨道 + 两栏「填写方式 : 最近填写」= 1.6 : 1。
 *
 * ## 为什么不再是三张步骤卡
 *
 * 三步是**强顺序**（不起浏览器就读不到表单），该由进度条表达；卡片适合"并列选项"。
 * 三张卡里各只有一行信息，却把"一行能说完的三步"撑成三栏 110px 高的留白，还让主按钮
 * 在工具条和第一步卡里各出现一次——眼睛没有唯一落点。
 *
 * 现在步骤只有一套表达：`FlowBar` 的宽档（四个节点 + 连接线），onboarding 与预览态
 * 之间切换时步数不跳变（都是 4 步）。**主 CTA 只出现在轨道右端**，工具条在本态只留
 * 状态与地址（`Workbar` 的 `onboarding`）。
 *
 * 纯 props：所有 handler 由页面侧 useCallback 稳定。
 */
import { Button, Tooltip, Typography } from "antd";
import { ChromeOutlined, FileSearchOutlined, GlobalOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormBusyState } from "./constants";
import { FlowBar } from "./FlowBar";

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
  sampleLocked = false,
}: {
  /** 专用浏览器是否在运行（第 1 步完成）。 */
  running: boolean;
  /** 是否已经读取过表单（第 4 步的完成度，只用于轨道状态）。 */
  hasSnapshot: boolean;
  /** 地址栏里的目标网址：决定轨道主按钮是「打开目标页」还是「开启专用浏览器」。 */
  targetUrl: string;
  busy: WebFormBusyState;
  onStart: () => void;
  onOpenUrl: () => void;
  onRead: () => void;
  /** 左栏「怎么填」：页面的 `FillModePanel`，由页面注入以免在这里复制一套开关。 */
  fillPanel: ReactNode;
  /** 右栏「最近填写」：`WebFormRecentRecords`。 */
  recentPanel: ReactNode;
  /** 当前数据集是「体验示例」：轨道上的主 CTA（起浏览器 / 读表单）一并灰掉。 */
  sampleLocked?: boolean;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后引导文案不重渲染。
  useLocale();
  const hasUrl = targetUrl.trim().length > 0;
  // 与预览态同一份派生规则：没起浏览器 = 第 1 步；起了 = 第 2 步（页面已在浏览器里）；
  // 读过快照就不再是 onboarding（由页面切走），所以这里最多到第 2 步。
  const step = hasSnapshot ? 3 : running ? 1 : 0;
  const disabled = busy !== null;

  // 轨道右端：**唯一**的主 CTA。中间态也在这里，不再出现"某个状态没有按钮"。
  const primary = !running
    ? hasUrl
      ? {
          key: "open",
          label: t("webFormPage.urlBar.open"),
          icon: <GlobalOutlined />,
          onClick: onOpenUrl,
          loading: busy === "start",
        }
      : {
          key: "start",
          label: t("webFormPage.browserCard.start"),
          icon: <ChromeOutlined />,
          onClick: onStart,
          loading: busy === "start",
        }
    : {
        key: "read",
        label: t("webFormPage.readSnapshot.read"),
        icon: <FileSearchOutlined />,
        onClick: onRead,
        loading: busy === "read",
      };

  const action = (
    <>
      {/* 浏览器已经在跑、地址也填了：允许"换一个目标页"而不失去主按钮（次要动作）。 */}
      {running && hasUrl ? (
        <Button
          icon={<GlobalOutlined />}
          disabled={disabled}
          loading={busy === "start"}
          onClick={onOpenUrl}
        >
          {t("webFormPage.urlBar.open")}
        </Button>
      ) : null}
      {/* 起浏览器之前读不到表单，按钮灰着并把原因写在旁边——只灰不解释等于功能坏了。 */}
      <Tooltip
        title={
          sampleLocked
            ? t("webFormPage.sampleLocked.hint")
            : running
              ? ""
              : t("webFormPage.flow.reason.browserOff")
        }
      >
        <Button
          type="primary"
          icon={primary.icon}
          loading={primary.loading}
          disabled={disabled || sampleLocked}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>
      </Tooltip>
      {sampleLocked ? (
        <Typography.Text type="warning" className="webform-flow-reason">
          {t("webFormPage.sampleLocked.hint")}
        </Typography.Text>
      ) : null}
    </>
  );

  return (
    <section
      className="webform-onboarding"
      aria-label={t("webFormPage.onboarding.title")}
      data-testid="webform-onboarding"
    >
      <FlowBar
        variant="wide"
        step={step}
        running={running}
        busy={busy}
        snapshot={null}
        onRead={onRead}
        action={action}
      />

      <div className="webform-onboarding-columns">
        {fillPanel}
        {recentPanel}
      </div>
    </section>
  );
}
