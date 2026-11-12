// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库筛选条（#29A/#29D/#29G）：关键词、分类、标签、公司、只看未分类、语义检索开关
 * 与「导出 Markdown」（#29 导出）。
 *
 * 语义检索打开时：分类/标签/未分类不再参与（后端 /search 只认 q 与 company），
 * 所以这里把它们禁用而不是让用户以为筛选生效了；公司筛选两边都支持，保持可用。
 */
import { DownloadOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Select, Space, Tooltip } from "antd";
import type { KnowledgeFilters } from "./useKnowledgeFilters";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { knowledgeCategoryLabel } from "../../i18n/enum/knowledge";

interface Props {
  filters: KnowledgeFilters;
  onChange: (patch: Partial<KnowledgeFilters>) => void;
  semantic: boolean;
  onSemanticChange: (value: boolean) => void;
  categories: string[];
  tags: string[];
  companies: string[];
  exporting: boolean;
  onExport: () => void;
}

export default function KnowledgeFilterBar({
  filters,
  onChange,
  semantic,
  onSemanticChange,
  categories,
  tags,
  companies,
  exporting,
  onExport,
}: Props) {
  useLocale();
  const categoryOptions = [
    { value: "", label: t("knowledgePage.filter.category.all") },
    ...categories.map((item) => ({ value: item, label: knowledgeCategoryLabel(item) })),
  ];
  const tagOptions = [
    { value: "", label: t("knowledgePage.filter.tag.all") },
    ...tags.map((item) => ({ value: item, label: item })),
  ];
  const companyOptions = [
    { value: "", label: t("knowledgePage.filter.company.all") },
    ...companies.map((item) => ({ value: item, label: item })),
  ];

  return (
    <Space wrap size={[8, 8]} className="rf-filter-bar">
      <Input.Search
        // 外部 URL 变化（如从面试页跳进来带 company+无 keyword）时重挂，避免残留旧输入。
        key={filters.keyword}
        allowClear
        defaultValue={filters.keyword}
        placeholder={t("knowledgePage.filter.search.placeholder")}
        style={{ width: 240 }}
        onSearch={(value) => onChange({ keyword: value.trim() })}
        aria-label={t("knowledgePage.filter.search.placeholder")}
      />
      <Tooltip title={t("knowledgePage.filter.semantic.hint")}>
        <Checkbox checked={semantic} onChange={(event) => onSemanticChange(event.target.checked)}>
          {t("knowledgePage.filter.semantic")}
        </Checkbox>
      </Tooltip>
      <Select
        aria-label={t("knowledgePage.filter.category.aria")}
        value={filters.category}
        options={categoryOptions}
        style={{ width: 160 }}
        disabled={semantic}
        onChange={(value: string) => onChange({ category: value })}
      />
      <Select
        aria-label={t("knowledgePage.filter.tag.aria")}
        value={filters.tag}
        options={tagOptions}
        style={{ width: 160 }}
        disabled={semantic}
        onChange={(value: string) => onChange({ tag: value })}
      />
      <Select
        aria-label={t("knowledgePage.filter.company.aria")}
        value={filters.company}
        options={companyOptions}
        style={{ width: 180 }}
        showSearch
        optionFilterProp="label"
        onChange={(value: string) => onChange({ company: value })}
      />
      <Checkbox
        checked={filters.uncategorized}
        disabled={semantic}
        onChange={(event) => onChange({ uncategorized: event.target.checked })}
      >
        {t("knowledgePage.filter.uncategorized")}
      </Checkbox>
      <Button
        icon={<DownloadOutlined />}
        loading={exporting}
        onClick={onExport}
        disabled={semantic || undefined}
      >
        {t("knowledgePage.action.export")}
      </Button>
    </Space>
  );
}
