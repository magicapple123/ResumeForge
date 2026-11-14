// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的筛选条：关键词 + 关联岗位 + 清除 + 计数。
 *
 * 计数分两种文案：有关键词/岗位时是「筛出 N 条」，否则是「共 N 条」——用户要能分清
 * 「库里只有这么多」和「被筛掉了」。
 * `total > shown` 时补一句「只显示前 N 条」：接口有分页上限，不说明会让人以为数据丢了。
 */
import { Button, Flex, Typography } from "antd";
import type { ExternalResumeFilters } from "../../features/external-resume/useExternalResumes";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import JobFilterSelect from "./JobFilterSelect";
import ResumeSearchInput from "./ResumeSearchInput";

interface Props {
  filters: ExternalResumeFilters;
  onChange: (filters: ExternalResumeFilters) => void;
  total: number;
  shown: number;
  loading: boolean;
}

export default function ExternalResumeFiltersBar({
  filters,
  onChange,
  total,
  shown,
  loading,
}: Props) {
  useLocale();
  const filtered = Boolean(filters.keyword?.trim() || filters.jobId != null);
  return (
    <Flex vertical gap={8}>
      <Flex gap={12} align="center" wrap>
        <ResumeSearchInput
          keyword={filters.keyword ?? ""}
          width={240}
          placeholder={t("resumesPage.external.searchPlaceholder")}
          onCommit={(keyword) => onChange({ ...filters, keyword })}
        />
        <JobFilterSelect
          value={filters.jobId}
          width={200}
          onChange={(jobId) => onChange({ ...filters, jobId })}
        />
        {filtered ? (
          <Button onClick={() => onChange({})}>{t("resumesPage.external.clearFilters")}</Button>
        ) : null}
        <Typography.Text type="secondary" style={{ marginInlineStart: "auto" }}>
          {t(filtered ? "resumesPage.external.filteredTotal" : "resumesPage.external.total", {
            count: total,
          })}
        </Typography.Text>
      </Flex>
      {!loading && total > shown ? (
        <Typography.Text type="secondary">
          {t("resumesPage.external.limited", { count: shown })}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}
