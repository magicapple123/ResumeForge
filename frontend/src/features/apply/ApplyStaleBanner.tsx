// SPDX-License-Identifier: Apache-2.0
/**
 * 「7 天以上没有回音」的静默提醒（#14C）。
 *
 * 投递记录只到成功/失败/跳过，投出去之后的事（面没面、有没有回音）在求职进度里。
 * 这条提醒把"投了但没动静"的记录挑出来，一键写进求职进度（已有记录则复用），
 * 用户不需要自己去那边一条条重建。
 *
 * 数量为 0、接口失败或还没回来时**整条不渲染**：提醒的价值在于"值得看一眼"，不该常驻。
 */
import { App, Alert, Button, Space, Typography } from "antd";
import { useState } from "react";
import { listStaleRecords, trackApplyRecord } from "../../api/applyExtras";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyStaleList } from "../../types";

/** 「没有回音」的判定窗口（天），与后端 `/records/stale?days=7` 的默认值一致。 */
export const STALE_DAYS = 7;

export default function ApplyStaleBanner() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后提示停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { data, error, reload } = useApi<ApplyStaleList>(() => listStaleRecords(STALE_DAYS), []);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error || !data || data.count === 0) return null;

  /** 批量写进求职进度：逐条 POST、allSettled 聚合——一条失败不拖垮整批。 */
  const markAll = async () => {
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        data.items.map((item) => trackApplyRecord(item.record_id)),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) {
        message.warning(t("applyRecords.stale.partial", { ok: data.count - failed, failed }));
      } else {
        message.success(t("applyRecords.stale.done", { count: data.count }));
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert
      type="info"
      showIcon
      className="apply-stale-banner"
      title={t("applyRecords.stale.title", { count: data.count })}
      description={
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          <Typography.Text type="secondary">{t("applyRecords.stale.body")}</Typography.Text>
          {expanded && (
            <ul className="apply-stale-list">
              {data.items.map((item) => (
                <li key={item.record_id}>
                  {t("applyRecords.stale.line", {
                    title: item.job_title || t("applyRecords.deletedJob"),
                    company: item.company,
                    days: item.days,
                  })}
                  {item.applied_at && (
                    <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>
                      {formatDateTime(item.applied_at)}
                    </Typography.Text>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Space wrap>
            <Button size="small" onClick={() => setExpanded((value) => !value)}>
              {expanded
                ? t("applyRecords.stale.hide")
                : t("applyRecords.stale.view", { count: data.count })}
            </Button>
            <Button size="small" type="primary" loading={busy} onClick={() => void markAll()}>
              {t("applyRecords.stale.markAll")}
            </Button>
          </Space>
        </Space>
      }
    />
  );
}
