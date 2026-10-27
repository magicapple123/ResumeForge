// SPDX-License-Identifier: Apache-2.0
/**
 * 智能逐项填表卡：与「读取当前表单 → 批量填」并存，不是替代。
 * （自 WebFormPage 拆出：:838-909 整块逐字随迁，纯 props——它不做预先快照，
 * 点到哪个框才现场匹配，所以不存在"页面一联动序号就失效"。）
 */
import { Button, Card, Space, Tag, Tooltip, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormLive } from "../../types";
import { LIVE_STATUS_META } from "./constants";
import type { WebFormBusyState } from "./constants";

/**
 * **memo**：props（live/liveEnabled/running/busy/rememberPending/alternatives + 稳定回调）
 * 在击键路径上都不变，打字时整块跳过重渲。
 */
export const LiveModeCard = memo(function LiveModeCard({
  live,
  liveEnabled,
  running,
  busy,
  rememberPending,
  alternatives,
  onToggle,
  onRequestMemoryDialog,
}: {
  live: WebFormLive | null;
  liveEnabled: boolean;
  running: boolean;
  busy: WebFormBusyState;
  rememberPending: WebFormLive["remember_pending"];
  alternatives: WebFormLive["alternatives"];
  onToggle: () => void;
  onRequestMemoryDialog: () => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Card
      size="small"
      className="live-mode-card"
      title={t("liveModeCard.title")}
      extra={
        <Button
          // 中文两字按钮默认会被 antd 插成「开 启」，与 aria-label 的连续文案不一致，
          // 触发 axe label-content-name-mismatch（WCAG 2.5.3）。关掉自动空格。
          autoInsertSpace={false}
          aria-label={
            liveEnabled ? t("liveModeCard.toggle.ariaOff") : t("liveModeCard.toggle.ariaOn")
          }
          type={liveEnabled ? "default" : "primary"}
          loading={busy === "live"}
          // `live.running` 为真时后端一定已经开着浏览器（会话起不来会报 409），
          // 所以它可以单独解除禁用：浏览器状态轮询慢半拍时按钮不会白灰着。
          disabled={!running && !live?.running}
          onClick={onToggle}
        >
          {liveEnabled ? t("liveModeCard.toggle.off") : t("liveModeCard.toggle.on")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t("liveModeCard.intro.lead")}
        <Typography.Text strong>{t("liveModeCard.intro.focusHint")}</Typography.Text>
        {t("liveModeCard.intro.writeHint")}
        <Typography.Text strong>{t("liveModeCard.intro.profilePickerHint")}</Typography.Text>
        {t("liveModeCard.intro.profileListHint")}
        <Typography.Text strong>{t("liveModeCard.intro.pickHint")}</Typography.Text>
        {t("liveModeCard.intro.tail")}
      </Typography.Paragraph>
      {live?.running ? (
        <Space size="middle" wrap>
          <Tag
            color={liveEnabled ? (LIVE_STATUS_META[live.status]?.color ?? "processing") : "default"}
          >
            {liveEnabled
              ? (LIVE_STATUS_META[live.status]?.label ?? t("liveModeCard.status.waiting"))
              : t("liveModeCard.tag.off")}
          </Tag>
          {liveEnabled && live.field_label ? (
            <Typography.Text>
              {live.field_label}
              {live.value ? ` → ${live.value}` : ""}
            </Typography.Text>
          ) : null}
          {liveEnabled && live.source === "ai" ? (
            <Tag color="blue">{t("liveModeCard.tag.ai")}</Tag>
          ) : null}
          {liveEnabled && alternatives.length ? (
            <Tooltip
              title={alternatives
                .map((item) =>
                  t("liveModeCard.alternatives.tooltipEntry", {
                    label: item.label,
                    value: item.value,
                  }),
                )
                .join("\n")}
            >
              <Typography.Text type="secondary">
                {t("liveModeCard.alternatives.count", { count: alternatives.length })}
              </Typography.Text>
            </Tooltip>
          ) : null}
          {liveEnabled && live.note ? (
            <Typography.Text type="secondary">{live.note}</Typography.Text>
          ) : null}
          {liveEnabled && rememberPending ? (
            <>
              <Tag color="warning">{t("liveModeCard.remember.tag")}</Tag>
              <Button size="small" onClick={onRequestMemoryDialog}>
                {t("liveModeCard.remember.choose")}
              </Button>
            </>
          ) : null}
          <Typography.Text type="secondary">
            {liveEnabled
              ? t("liveModeCard.progress.filled", { count: live.filled })
              : t("liveModeCard.progress.keepRunning")}
          </Typography.Text>
        </Space>
      ) : live?.stop_reason === "browser_closed" ? (
        // 浏览器被关掉后本次填写自动结束：这是正常流程，不是故障——沿用结束态的展示
        // 路径给一条中性说明，不弹错误样式。
        <Typography.Text type="secondary">{t("liveModeCard.ended.browserClosed")}</Typography.Text>
      ) : (
        <Typography.Text type="secondary">{t("liveModeCard.status.off")}</Typography.Text>
      )}
    </Card>
  );
});
