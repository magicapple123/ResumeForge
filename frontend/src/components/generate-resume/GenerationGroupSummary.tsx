// SPDX-License-Identifier: Apache-2.0
/**
 * 生成弹窗的**只读组摘要**（F4 §5.7 / R-27）：显示「本次使用：<组名>（N 个大字段）」。
 *
 * 三条约束：
 * - **没有选组器**：生成永远用当前组；要换组请去资料页（「去切换组」）。
 * - 只读摘要来自 `GET /api/profile/current/projection` 的 scope（与新建/填充共享缓存），
 *   前端不自己拼参与分区清单、也不读编辑 DTO。
 * - 读取失败**不阻断生成**：只显示「当前组信息读取失败 + 重试」，生成按钮仍可用。
 */
import { Button, Space, Tooltip, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useCurrentProjection } from "../../features/profile-library/useCurrentProjection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function GenerationGroupSummary() {
  useLocale();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useCurrentProjection(true);

  if (loading && !data) {
    return (
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        {t("resume.manual.loading")}
      </Typography.Text>
    );
  }
  if (error && !data) {
    return (
      <Space size={8} style={{ marginBottom: 12 }} wrap>
        <Typography.Text type="secondary">{t("resume.generate.group-failed")}</Typography.Text>
        <Button size="small" onClick={reload}>
          {t("resume.generate.group-retry")}
        </Button>
      </Space>
    );
  }
  if (!data) return null;

  const scope = data.scope;
  if (!scope) {
    return (
      <Space size={8} style={{ marginBottom: 12 }} wrap>
        <Typography.Text type="secondary">{t("resume.generate.group-failed")}</Typography.Text>
        <Button size="small" onClick={reload}>
          {t("resume.generate.group-retry")}
        </Button>
      </Space>
    );
  }
  const layout = Array.isArray(data.source_layout) ? data.source_layout : [];
  const sectionNames = new Map(
    layout.map((section) => [section.section_key, section.section_name]),
  );
  const participating = Array.isArray(scope.participating_keys) ? scope.participating_keys : [];
  const fieldNames = participating
    .map((key) => sectionNames.get(key))
    .filter((name): name is string => Boolean(name))
    .join(" · ");
  return (
    <Space size={8} style={{ display: "flex", marginBottom: 12 }} wrap>
      <Typography.Text type="secondary">{t("resume.generate.group-title")}</Typography.Text>
      <Tooltip title={fieldNames}>
        <Typography.Text strong>
          {t("resume.generate.groupSummary", {
            group: scope.group_name,
            count: participating.length,
          })}
        </Typography.Text>
      </Tooltip>
      <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate("/profile")}>
        {t("resume.generate.switch-group")}
      </Button>
    </Space>
  );
}
