// SPDX-License-Identifier: Apache-2.0
/**
 * P5-2：无法定位的旧来源关联（只读提示 + 删除/重新关联两个出口）。
 *
 * 旧行只存旧路径或失联身份：这里**不猜目标**、不改写旧行。用户先在列表里选中目标块，
 * 再点「重新关联」（建立新关联后由宿主删除这条失效旧行），或直接删除这条旧关联
 * （复用现有 DELETE /api/provenance/resumes/{id}/links/{link_id}）。
 */
import { Alert, Button, Popconfirm, Space, Tag, Typography } from "antd";
import { pt } from "../../../features/resume-provenance/i18n";
import { sourceKindKey } from "../../../features/resume-provenance/helpers";
import type { UnresolvedLinkOut } from "../../../features/resume-provenance/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  items: UnresolvedLinkOut[];
  /** 重新关联必须先有一个用户选中的目标块；没有时按钮禁用并给出说明。 */
  canRelink: boolean;
  onDelete: (item: UnresolvedLinkOut) => void;
  onRelink: (item: UnresolvedLinkOut) => void;
  disabled?: boolean;
}

/** 稳定原因码 → 文案 key；未知码按"原因未知"显示，不编造具体原因。 */
const REASON_KEYS: Record<string, string> = {
  target_missing: "provenance.unresolved.reason.targetMissing",
  object_id_invalid: "provenance.unresolved.reason.objectIdInvalid",
  no_locator: "provenance.unresolved.reason.noLocator",
};

function reasonText(reason: string): string {
  return pt(
    (REASON_KEYS[reason] ?? "provenance.unresolved.reason.unknown") as Parameters<typeof pt>[0],
  );
}

export default function UnresolvedLinksCard({
  items,
  canRelink,
  onDelete,
  onRelink,
  disabled = false,
}: Props) {
  useLocale();
  if (items.length === 0) return null;
  return (
    <div data-unresolved-links="1">
      <Alert
        type="warning"
        showIcon
        title={pt("provenance.unresolved.title", { count: items.length })}
        description={
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text type="secondary">{pt("provenance.unresolved.hint")}</Typography.Text>
            {canRelink ? null : (
              <Typography.Text type="secondary">
                {pt("provenance.unresolved.relinkHint")}
              </Typography.Text>
            )}
            {items.map((item) => (
              <div key={item.link_id} data-unresolved-link={item.link_id}>
                <Space size={6} wrap align="center">
                  <Typography.Text strong>{item.source_title || "-"}</Typography.Text>
                  <Tag>{pt(sourceKindKey(item.source_kind))}</Tag>
                  <Typography.Text type="secondary">{item.path || "-"}</Typography.Text>
                  <Typography.Text type="secondary">{reasonText(item.reason)}</Typography.Text>
                </Space>
                <Space size={8} wrap style={{ marginTop: 4 }}>
                  <Popconfirm
                    title={pt("provenance.unresolved.deleteConfirmTitle")}
                    description={pt("provenance.unresolved.deleteConfirmBody")}
                    okText={pt("provenance.unresolved.delete")}
                    cancelText={pt("provenance.link.cancel")}
                    onConfirm={() => onDelete(item)}
                  >
                    <Button size="small" type="text" danger disabled={disabled || undefined}>
                      {pt("provenance.unresolved.delete")}
                    </Button>
                  </Popconfirm>
                  <Button
                    size="small"
                    disabled={disabled || !canRelink || undefined}
                    onClick={() => onRelink(item)}
                  >
                    {pt("provenance.unresolved.relink")}
                  </Button>
                </Space>
              </div>
            ))}
          </Space>
        }
      />
    </div>
  );
}
