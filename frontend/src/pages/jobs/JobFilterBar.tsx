// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场筛选工具栏：搜索/类型/状态/来源筛选 + 选择模式与各入口按钮。
 * （自 JobsPage 拆出：:362-487 整块逐字随迁，aria-label「来源筛选」「补齐详情」保留；
 * openMatchBatch/backfillDetails 等经 prop 直通页面 handler，零 api 导入。）
 */
import {
  HistoryOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Button, Divider, Input, Select, Space, Tooltip } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { JOB_STATUS_LABEL_KEYS, JOB_TYPE_LABEL_KEYS } from "../../i18n/enum/jobs";
import { useLocale } from "../../i18n/i18nContext";
import type { BatchAction } from "./jobFilterOptions";
import { SOURCE_KIND_OPTIONS } from "./jobFilterOptions";

export function JobFilterBar({
  keyword,
  setKeyword,
  setPage,
  jobType,
  setJobType,
  status,
  setStatus,
  sourceKind,
  setSourceKind,
  batchAction,
  openMatchBatch,
  emptyDescriptionJobIds,
  backfilling,
  backfillDetails,
  setCandidatesOpen,
  setFormOpen,
  onImportCsv,
  selectionMode = false,
  extraActions,
}: {
  keyword: string;
  setKeyword: (value: string) => void;
  setPage: (value: number) => void;
  jobType: string;
  setJobType: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  sourceKind: "" | "collected" | "manual";
  setSourceKind: (value: "" | "collected" | "manual") => void;
  batchAction: BatchAction;
  openMatchBatch: (view?: "setup" | "history") => void;
  emptyDescriptionJobIds: number[];
  backfilling: boolean;
  backfillDetails: () => Promise<void>;
  setCandidatesOpen: (value: boolean) => void;
  setFormOpen: (value: boolean) => void;
  onImportCsv: () => void;
  /**
   * 是否处于多选态。默认 `false`（既有调用方与单测都不用改）。
   *
   * 多选时**不渲染**「分析记录」：用户的原话是"多选的时候把分析记录删掉，在 AI 对比选岗
   * 界面看就好了"——勾选状态下这一栏的注意力属于批量动作，跳去历史记录会中断它。
   * 只隐藏入口、不删功能：`?match_batch=history` 深链仍可达（完成通知会跳它），
   * 非多选态下这颗按钮照旧出现。
   */
  selectionMode?: boolean;
  extraActions?: ReactNode;
}) {
  useLocale();
  // 搜索框受控：本地镜像同步外部 keyword（URL 带参等外部变化能回填输入框），
  // 点 × 清空时立即把筛选也清掉——之前非受控时清空后列表仍按旧关键词过滤。
  // Compiler 规范：镜像同步用渲染期守卫式调整。
  const [searchText, setSearchText] = useState(keyword);
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setSearchText(keyword);
  }

  // 下拉的 value 仍是落库的协议值，展示名在渲染期取（见 i18n/enum/jobs.ts）。
  const jobTypeOptions = Object.entries(JOB_TYPE_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  const statusOptions = Object.entries(JOB_STATUS_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));

  return (
    <div style={{ marginBottom: 16 }}>
      {/* F04：10 个控件原本挤在一条 `size={2}` 的 Space 里，控件几乎相接、两个 primary
          互相抢注意力。现在按「筛选｜AI｜导入｜新增」分成四簇：簇内 6px、簇间 8px + 一条
          竖分隔线，读到哪一簇停在哪里由线来断句；全栏只留「手动添加」一个 primary。 */}
      <Space wrap size={8} align="center" className="jobs-filter-bar">
        <Space
          wrap
          size={6}
          align="center"
          className="jobs-filter-group jobs-filter-group-filters"
        >
          <Input.Search
            size="small"
            className="jobs-search-input"
            placeholder={t("jobsPage.filter.searchPlaceholder")}
            allowClear
            disabled={batchAction !== null}
            value={searchText}
            onChange={(event) => {
              const value = event.target.value;
              setSearchText(value);
              if (value === "" && keyword !== "") {
                setKeyword("");
                setPage(1);
              }
            }}
            onSearch={(value) => {
              setSearchText(value);
              setKeyword(value);
              setPage(1);
            }}
          />
          <Select
            size="small"
            aria-label={t("jobsPage.filter.jobTypeAria")}
            placeholder={t("jobsPage.filter.jobTypePlaceholder")}
            allowClear
            disabled={batchAction !== null}
            style={{ width: 90 }}
            value={jobType || undefined}
            onChange={(value) => {
              setJobType(value ?? "");
              setPage(1);
            }}
            options={jobTypeOptions}
          />
          <Select
            size="small"
            aria-label={t("jobsPage.filter.statusAria")}
            placeholder={t("jobsPage.filter.statusPlaceholder")}
            allowClear
            disabled={batchAction !== null}
            style={{ width: 90 }}
            value={status || undefined}
            onChange={(value) => {
              setStatus(value ?? "");
              setPage(1);
            }}
            options={statusOptions}
          />
          <Select
            size="small"
            aria-label={t("jobsPage.filter.sourceAria")}
            placeholder={t("jobsPage.filter.sourcePlaceholder")}
            allowClear
            disabled={batchAction !== null}
            style={{ width: 90 }}
            value={sourceKind || undefined}
            onChange={(value) => {
              setSourceKind((value ?? "") as "" | "collected" | "manual");
              setPage(1);
            }}
            options={SOURCE_KIND_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </Space>
        <Divider orientation="vertical" className="jobs-filter-divider" />
        <Space wrap size={6} align="center" className="jobs-filter-group jobs-filter-group-ai">
          {/* 进入选择模式的入口在行右键菜单的「批量选择」（R8）；退出选择已挪到
              BatchToolbar 的「全选全部岗位」右侧（用户要求，两行各归其位）。 */}
          {/* 开始分析在面板里确认（设置视图有「开始分析」按钮）；分析一律走后台任务，
              关掉面板/切页都不会中断，无需单独的"后台运行"入口。 */}
          {/* 它不是本页唯一的动作（旁边还有「手动添加」），所以不再用 primary——两个实心
              按钮并排时用户看不出哪个是主路径。 */}
          <Button
            size="small"
            disabled={batchAction !== null}
            onClick={() => openMatchBatch("setup")}
          >
            {t("jobsPage.filter.analyzeMatch")}
          </Button>
          {/* 多选态不渲染「分析记录」（用户要求）：勾选中这一栏只服务批量动作，
              历史记录请到「AI 对比选岗 / 批量匹配分析」界面看。非多选态保留入口（深链也仍然可达）。 */}
          {selectionMode ? null : (
            <Button
              size="small"
              icon={<HistoryOutlined />}
              disabled={batchAction !== null}
              onClick={() => openMatchBatch("history")}
            >
              {t("jobsPage.filter.matchHistory")}
            </Button>
          )}
          <Button
            size="small"
            icon={<InboxOutlined />}
            disabled={batchAction !== null}
            onClick={() => setCandidatesOpen(true)}
          >
            {t("jobsPage.filter.candidates")}
          </Button>
          {emptyDescriptionJobIds.length > 0 && (
            <Tooltip title={t("jobsPage.filter.backfill")}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                aria-label={t("jobsPage.filter.backfill")}
                disabled={batchAction !== null || undefined}
                loading={backfilling}
                onClick={() => void backfillDetails()}
              />
            </Tooltip>
          )}
        </Space>
        <Divider orientation="vertical" className="jobs-filter-divider" />
        {/* 「导入」与「新增」合成一个 flex 项：两者都是"往库里添东西"，而且 1440 的可用宽
            容不下四簇并排（实测合计 1241 > 1166）。合并成一项后整行按 2+2 折行——两行各
            两簇，而不是把「手动添加」单独甩到第二行留一片空白。宽屏（≥1500）仍是一行四簇。 */}
        <div className="jobs-filter-actions">
          <Space
            wrap
            size={6}
            align="center"
            className="jobs-filter-group jobs-filter-group-import"
          >
            {extraActions}
            <Button
              size="small"
              icon={<UploadOutlined />}
              disabled={batchAction !== null || undefined}
              onClick={onImportCsv}
            >
              {t("jobsPage.filter.importCsv")}
            </Button>
          </Space>
          <Divider orientation="vertical" className="jobs-filter-divider" />
          <Space wrap size={6} align="center" className="jobs-filter-group jobs-filter-group-add">
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              disabled={batchAction !== null}
              onClick={() => setFormOpen(true)}
            >
              {t("jobsPage.filter.addManual")}
            </Button>
          </Space>
        </div>
      </Space>
    </div>
  );
}
