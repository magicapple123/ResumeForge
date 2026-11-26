// SPDX-License-Identifier: Apache-2.0
/** 简历中心的筛选栏：新建 / 交付存档 / 外部简历入口、岗位与关键词筛选、排序复位与场景建议。 */
import { Button, Select, Space, Tag } from "antd";
import { FilterResetSlot } from "../../components/common/FilterResetSlot";
import ResumeCenterAiEntry from "../../features/career-scenarios/ResumeCenterAiEntry";
import ResumeScenarioSuggestion from "../../features/career-scenarios/ResumeScenarioSuggestion";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ExternalResumeEntry from "./ExternalResumeEntry";
import JobFilterSelect from "./JobFilterSelect";
import ResumeSearchInput from "./ResumeSearchInput";

interface Props {
  keyword: string;
  jobId: number | undefined;
  jobLabel: string;
  hasJobFilter: boolean | undefined;
  /**
   * 当前排序是否已离开默认值——**由页面判定**，因为本页有两套排序（折叠视图的本地
   * 组级排序 / 平铺视图的服务端排序），哪个在屏幕上就复位哪个。筛选栏只负责"离开
   * 默认才出现复位按钮"，不认识排序状态本身。
   */
  sortChanged: boolean;
  onNewResume: () => void;
  onOpenArchive: () => void;
  onJobFilterChange: (jobId: number | undefined) => void;
  onJobLabelChange: (label: string) => void;
  onKeywordCommit: (keyword: string) => void;
  onHasJobFilterChange: (value: boolean | undefined) => void;
  onSortReset: () => void;
}

export default function ResumeFilterBar({
  keyword,
  jobId,
  jobLabel,
  hasJobFilter,
  sortChanged,
  onNewResume,
  onOpenArchive,
  onJobFilterChange,
  onJobLabelChange,
  onKeywordCommit,
  onHasJobFilterChange,
  onSortReset,
}: Props) {
  useLocale();
  return (
    <FilterResetSlot
      changed={sortChanged}
      hint={t("resume.sort.resetHint")}
      label={t("resumesPage.sort.reset")}
      onReset={onSortReset}
      bar={
        <Space wrap size={16} align="center" className="rf-filter-bar">
          <Button type="primary" onClick={onNewResume}>
            {t("resumesPage.page.newResume")}
          </Button>
          <ResumeCenterAiEntry />
          <Button onClick={onOpenArchive}>{t("resumesPage.page.deliveryArchive")}</Button>
          {/* 第 1 条：外部简历不再常驻本页，改为独立页入口（带数量）。 */}
          <ExternalResumeEntry />
          {jobId && (
            <Space size={4} align="center">
              <Tag color="blue">
                {t("resumesPage.page.jobFilterTag", { job: jobLabel || `#${jobId}` })}
              </Tag>
              <Button type="link" size="small" onClick={() => onJobFilterChange(undefined)}>
                {t("resumesPage.page.clearFilter")}
              </Button>
            </Space>
          )}
          <JobFilterSelect
            value={jobId}
            onChange={onJobFilterChange}
            onLabelChange={onJobLabelChange}
          />
          <ResumeSearchInput keyword={keyword} onCommit={onKeywordCommit} />
          <Select
            allowClear
            placeholder={t("resumesPage.filter.jobRelation")}
            aria-label={t("resumesPage.filter.jobRelationAria")}
            style={{ width: 140 }}
            value={hasJobFilter}
            onChange={onHasJobFilterChange}
            options={[
              { value: true, label: t("resumesPage.filter.hasJob") },
              { value: false, label: t("resumesPage.filter.general") },
            ]}
          />
          {/* A2 场景建议入口：悬停/点击才浮出说明，只提供入口，不调用模型、不按场景
              过滤任何已有简历。 */}
          <ResumeScenarioSuggestion />
        </Space>
      }
    />
  );
}
