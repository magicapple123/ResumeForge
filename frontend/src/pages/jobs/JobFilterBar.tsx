/**
 * 岗位广场筛选工具栏：搜索/类型/状态/来源筛选 + 选择模式与各入口按钮。
 * （自 JobsPage 拆出：:362-487 整块逐字随迁，aria-label「来源筛选」「补齐详情」保留；
 * openMatchBatch/backfillDetails 等经 prop 直通页面 handler，零 api 导入。）
 */
import {
  CheckSquareOutlined,
  CloseCircleOutlined,
  HistoryOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Select, Space } from "antd";
import type { BatchAction, MatchBatchRunMode } from "./jobFilterOptions";
import { JOB_TYPE_OPTIONS, SOURCE_KIND_OPTIONS, STATUS_OPTIONS } from "./jobFilterOptions";

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
  selectionMode,
  setSelectionMode,
  exitSelectionMode,
  openMatchBatch,
  emptyDescriptionJobIds,
  backfilling,
  backfillDetails,
  setCandidatesOpen,
  setFormOpen,
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
  selectionMode: boolean;
  setSelectionMode: (value: boolean) => void;
  exitSelectionMode: () => void;
  openMatchBatch: (autoRun: boolean, runMode?: MatchBatchRunMode) => void;
  emptyDescriptionJobIds: number[];
  backfilling: boolean;
  backfillDetails: () => Promise<void>;
  setCandidatesOpen: (value: boolean) => void;
  setFormOpen: (value: boolean) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Space wrap className="jobs-filter-bar">
        <Input.Search
          className="jobs-search-input"
          placeholder="搜索职位 / 公司 / 城市 / 描述 / 备注"
          allowClear
          disabled={batchAction !== null}
          defaultValue={keyword}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Select
          placeholder="类型"
          allowClear
          disabled={batchAction !== null}
          style={{ width: 110 }}
          value={jobType || undefined}
          onChange={(value) => {
            setJobType(value ?? "");
            setPage(1);
          }}
          options={JOB_TYPE_OPTIONS}
        />
        <Select
          placeholder="状态"
          allowClear
          disabled={batchAction !== null}
          style={{ width: 110 }}
          value={status || undefined}
          onChange={(value) => {
            setStatus(value ?? "");
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Select
          aria-label="来源筛选"
          placeholder="来源"
          allowClear
          disabled={batchAction !== null}
          style={{ width: 120 }}
          value={sourceKind || undefined}
          onChange={(value) => {
            setSourceKind((value ?? "") as "" | "collected" | "manual");
            setPage(1);
          }}
          options={SOURCE_KIND_OPTIONS}
        />
        {selectionMode ? (
          <Button
            icon={<CloseCircleOutlined />}
            disabled={batchAction !== null}
            onClick={exitSelectionMode}
          >
            退出选择
          </Button>
        ) : (
          <Button
            icon={<CheckSquareOutlined />}
            disabled={batchAction !== null}
            onClick={() => setSelectionMode(true)}
          >
            选择
          </Button>
        )}
        {/* Dropdown.Button 已废弃（v6）：按官方指引以 Space.Compact + Dropdown + Button 重组。 */}
        <Space.Compact>
          <Button
            type="primary"
            disabled={batchAction !== null}
            onClick={() => openMatchBatch(true)}
          >
            AI 分析适配度
          </Button>
          <Dropdown
            disabled={batchAction !== null}
            placement="bottomRight"
            menu={{
              items: [{ key: "background", label: "后台运行分析" }],
              onClick: ({ key }) => {
                if (key === "background") openMatchBatch(true, "background");
              },
            }}
          >
            <Button type="primary" icon={<RobotOutlined />} disabled={batchAction !== null} />
          </Dropdown>
        </Space.Compact>
        <Button
          icon={<HistoryOutlined />}
          disabled={batchAction !== null}
          onClick={() => openMatchBatch(false)}
        >
          分析记录
        </Button>
        <Button
          icon={<InboxOutlined />}
          disabled={batchAction !== null}
          onClick={() => setCandidatesOpen(true)}
        >
          备选岗位
        </Button>
        {emptyDescriptionJobIds.length > 0 && (
          // 只在有 JD 为空的岗位时才出现——否则按钮点了什么也不会发生。
          // 显式 aria-label：antd 会给纯中文按钮做字距处理，用文本当查询条件可能找不到。
          <Button
            icon={<ReloadOutlined />}
            aria-label="补齐详情"
            disabled={batchAction !== null}
            loading={backfilling}
            onClick={() => void backfillDetails()}
          >
            补齐详情
          </Button>
        )}
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={batchAction !== null}
          onClick={() => setFormOpen(true)}
        >
          手动添加
        </Button>
      </Space>
    </div>
  );
}
