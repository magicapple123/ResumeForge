// SPDX-License-Identifier: Apache-2.0
/**
 * 记录行的「更新进度」（#14C）：把这条投递写进求职进度。
 *
 * 一键动作，不给表单：阶段（`applied/screening/interview…`）在求职进度里改更合适，
 * 这里只负责"让它出现在漏斗里"。后端按 `job_id + 未删除` 查重，已有则更新阶段并回
 * `created=false`——所以连点不会多出漏斗记录，成功文案也要分这两种情况。
 */
import { FlagOutlined } from "@ant-design/icons";
import { App, Button, Tooltip } from "antd";
import { useState } from "react";
import { trackApplyRecord } from "../../api/applyExtras";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyRecord } from "../../types";

export default function ApplyRecordTrackButton({ record }: { record: ApplyRecord }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后按钮停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await trackApplyRecord(record.id);
      message.success(
        t(result.created ? "applyRecords.toast.tracked" : "applyRecords.toast.trackUpdated"),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyRecords.error.trackFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip title={t("applyRecords.track.hint")}>
      <Button
        size="small"
        icon={<FlagOutlined />}
        loading={busy}
        // 岗位已删除的记录没有 job_id，后端也建不出求职进度条目（无法关联岗位）。
        disabled={record.job_id == null || undefined}
        onClick={() => void run()}
      >
        {t("applyRecords.action.track")}
      </Button>
    </Tooltip>
  );
}
