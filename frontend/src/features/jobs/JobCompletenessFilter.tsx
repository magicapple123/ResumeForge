// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「数据完整度」筛选项（CR-36）。
 *
 * 只是把 `incomplete_only` 这个布尔传给列表查询——「缺公司 + 缺薪资 + 无来源链接」的
 * 判定在 `job_queries.filtered_query` 里只有一份实现，前端不重复判断字段。
 */
import { Checkbox, Space, Tag, Tooltip } from "antd";
import { FilterOutlined } from "@ant-design/icons";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function JobCompletenessFilter({
  checked,
  onChange,
  total,
  loading = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 当前筛选口径下的可疑行总数（未勾选时不显示）。 */
  total: number;
  loading?: boolean;
}) {
  useLocale();
  return (
    <Space size={8} wrap style={{ marginBottom: 8 }} data-testid="job-completeness-filter">
      <Tooltip title={t("jobsPage.completeness.hint")}>
        <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)}>
          <Space size={4}>
            <FilterOutlined />
            {t("jobsPage.completeness.label")}
          </Space>
        </Checkbox>
      </Tooltip>
      {checked && (
        <Tag color={total > 0 ? "orange" : "default"} data-testid="job-completeness-count">
          {loading
            ? t("jobsPage.completeness.counting")
            : t("jobsPage.completeness.count", { count: total })}
        </Tag>
      )}
    </Space>
  );
}

export default JobCompletenessFilter;
