// SPDX-License-Identifier: Apache-2.0
/**
 * 版本比较视图（W13）：正文三态差异复用既有 `ResumeDiffView`，排版按顶层键报增/删/改。
 *
 * 不另写 diff 算法：契约要求"全仓库唯一的三态差异实现"，前端展示也复用同一套渲染。
 */
import { Button, Space, Tag, Typography } from "antd";
import ResumeDiffView from "../../ResumeDiffView";
import { t } from "../../../i18n";
import { summarizeCompare } from "../../../features/resume-versions/model";
import type { VersionCompareOut } from "../../../features/resume-versions/types";

interface Props {
  compare: VersionCompareOut;
  onClose: () => void;
}

export default function VersionComparePanel({ compare, onClose }: Props) {
  const digest = summarizeCompare(compare);
  const againstLabel =
    compare.against_id === 0
      ? t("versions.compare.againstCurrent")
      : t("versions.compare.againstVersion", { name: compare.against_name });
  return (
    <section
      style={{
        marginTop: 12,
        padding: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
        background: "var(--rf-surface-alt)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Typography.Text strong>{compare.base_name || t("versions.compare.title")}</Typography.Text>
        <Typography.Text type="secondary">{againstLabel}</Typography.Text>
        <span style={{ flex: "1 1 auto" }} />
        <Button size="small" onClick={onClose}>
          {t("versions.compare.close")}
        </Button>
      </div>
      {digest.identical ? (
        <Typography.Text type="secondary">{t("versions.compare.identical")}</Typography.Text>
      ) : (
        <Space size={8} wrap style={{ marginTop: 6 }}>
          <Tag>
            {t("versions.compare.contentStats", {
              added: digest.contentAdded,
              removed: digest.contentRemoved,
            })}
          </Tag>
          {digest.layoutEqual ? <Tag color="green">{t("versions.compare.layoutEqual")}</Tag> : null}
          {compare.layout.added.length > 0 ? (
            <Tag color="blue">
              {t("versions.compare.layoutAdded", { keys: compare.layout.added.join(", ") })}
            </Tag>
          ) : null}
          {compare.layout.removed.length > 0 ? (
            <Tag color="red">
              {t("versions.compare.layoutRemoved", { keys: compare.layout.removed.join(", ") })}
            </Tag>
          ) : null}
          {compare.layout.changed.length > 0 ? (
            <Tag color="orange">
              {t("versions.compare.layoutChanged", { keys: compare.layout.changed.join(", ") })}
            </Tag>
          ) : null}
        </Space>
      )}
      <Typography.Text strong style={{ display: "block", marginTop: 10 }}>
        {t("versions.compare.content")}
      </Typography.Text>
      <ResumeDiffView diff={compare.content} />
    </section>
  );
}
