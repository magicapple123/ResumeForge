/**
 * 事实台账：把写进简历的每一句话沉淀成可核对、可复核的条目。
 *
 * 页面职责很窄——筛选、展示、把改动交给后端；判断规则（什么状态能进终稿、什么写法
 * 会被追问）全在后端算好随条目下发，前端不自己再判一次。顶部那行"事实基线"读数
 * 直接取 `/api/claims/baseline`，所以界面显示的就是生成简历时真正会用到的东西。
 */
import {
  CheckSquareOutlined,
  FileAddOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Input, Pagination, Select, Space, Statistic, Typography } from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import ErrorState from "../components/common/ErrorState";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  batchDeleteClaims,
  deleteClaim,
  getClaim,
  getClaimBaseline,
  listClaimsPage,
  updateClaim,
} from "../api/claims";
import ClaimCard from "../components/claims/ClaimCard";
import ClaimDraftModal from "../components/claims/ClaimDraftModal";
import ClaimFormModal from "../components/claims/ClaimFormModal";
import { RowContextMenu } from "../components/common/RowActions";
import BatchActionBar from "../components/common/BatchActionBar";
import BatchDeleteButton from "../components/common/BatchDeleteButton";
import { useApi } from "../hooks/useApi";
import { useBatchSelection } from "../hooks/useBatchSelection";
import type { Claim, ClaimSummary } from "../types";
import { CLAIM_CATEGORIES, VERIFICATION_STATUSES, claimPayload } from "../types";

/** 列表一页 20 条，与后端 /claims/page 的默认口径一致。 */
const CLAIMS_PAGE_SIZE = 20;

export default function ClaimsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  // 批量选择：勾选若干条后一次删除（软删，全部进回收站）。
  const batch = useBatchSelection<number>();
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Claim | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);

  // 分页在服务端做（RF-08 续）：列表行是摘要（原文/表述 ≤200 字），汇总
  // （total/confirmed/pending/category_counts）随同一响应下发，不再为统计拉全量。
  const { data, loading, error, reload } = useApi(
    () => listClaimsPage({ category, status, keyword }, page, CLAIMS_PAGE_SIZE),
    [category, status, keyword, page],
  );
  const baseline = useApi(() => getClaimBaseline(), []);

  const items = useMemo(() => data?.items ?? [], [data]);

  // 筛选条件变化时回第 1 页（渲染期守卫式调整，与 KnowledgePage 同一模式）。
  const filterKey = `${keyword}|${category}|${status}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const remove = async (summary: ClaimSummary) => {
    try {
      await deleteClaim(summary.id);
      message.success("已移入回收站，可在「回收站」里恢复");
      await reload();
      await baseline.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const confirm = async (summary: ClaimSummary) => {
    try {
      // 摘要行没有 claimPayload 需要的全文与证据字段：先按 id 取全量再提交。
      const full = await getClaim(summary.id);
      // 后端会再校验一次占位符；前端只负责把当前值原样提交并换个状态。
      const saved = await updateClaim(
        full.id,
        claimPayload(full, { verification_status: "已确认" }),
      );
      // 后端可能因为"还留着【待补】"而拒绝，这里要如实说清是哪一条、为什么。
      if (saved.warnings.length > 0) {
        message.warning(`已标记为已确认，但还有待办：${saved.warnings[0]}`);
      } else {
        message.success("已标记为已确认");
      }
      await reload();
      await baseline.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const refreshAll = async () => {
    await reload();
    await baseline.reload();
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并刷新列表与统计。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteClaims(ids);
      message.success(`已删除 ${deleted} 条台账，可在「回收站」里恢复`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量删除失败，请重试");
    }
    batch.exitSelecting();
    await refreshAll();
  };

  // 摘要行没有表单需要的全文与证据字段：编辑前先按 id 取全量。
  const openEdit = async (summary: ClaimSummary) => {
    try {
      setEditing(await getClaim(summary.id));
      setFormOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载条目失败");
    }
  };

  // 各分类的条目数来自分页响应的 SQL 汇总（与旧端点内存汇总同口径），渲染进下拉标签。
  const categoryOptions = useMemo(
    () =>
      CLAIM_CATEGORIES.map((value) => {
        const count = data?.category_counts?.[value];
        return { value, label: count == null ? value : `${value}（${count}）` };
      }),
    [data],
  );

  return (
    <div className="claims-page">
      <div className="claims-page-head">
        <Space orientation="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            事实台账
          </Typography.Title>
          <Typography.Text type="secondary">
            每条对外说得出的话，都能回到一个出处。只有「已确认」的条目会作为事实进入简历生成；
            其余说法会被显式避开。
          </Typography.Text>
        </Space>
        <Space>
          {/* 深挖的输入就是台账条目，所以入口放在这里——从别处进它都要先绕一圈。 */}
          <Button icon={<ThunderboltOutlined />} onClick={() => navigate("/claims/drill")}>
            拿去深挖
          </Button>
          <Button icon={<FileAddOutlined />} onClick={() => setDraftOpen(true)}>
            从资料生成
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            新建条目
          </Button>
        </Space>
      </div>

      <div className="claims-summary">
        <Statistic title="条目总数" value={data?.total ?? 0} />
        <Statistic
          title="已确认（可进正式简历）"
          value={data?.confirmed_count ?? 0}
          styles={{ content: { color: "var(--rf-success-text)" } }}
        />
        <Statistic
          title="待确认"
          value={data?.pending_count ?? 0}
          styles={{ content: { color: "var(--rf-warning-text)" } }}
        />
        <Statistic
          title="生成时可用的事实"
          value={baseline.data?.confirmed_count ?? 0}
          prefix={<SafetyCertificateOutlined />}
        />
        {(baseline.data?.blocked_wording.length ?? 0) > 0 && (
          <Statistic
            title="会被避开的未确认说法"
            value={baseline.data?.blocked_wording.length ?? 0}
            styles={{ content: { color: "var(--rf-error-text)" } }}
          />
        )}
      </div>

      <Space size={16} wrap className="claims-filters rf-filter-bar">
        <Select
          aria-label="事实分类筛选"
          value={category}
          onChange={setCategory}
          style={{ width: 180 }}
          options={[{ value: "", label: "全部分类" }, ...categoryOptions]}
        />
        <Select
          aria-label="事实核实状态筛选"
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          options={[
            { value: "", label: "全部状态" },
            ...VERIFICATION_STATUSES.map((value) => ({ value, label: value })),
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索标题、主体、事实或表述"
          style={{ width: 280 }}
          onSearch={setKeyword}
        />
      </Space>

      {batch.selecting && (
        <BatchActionBar
          count={batch.selectedCount}
          onExit={batch.exitSelecting}
          pageSelectAll={{
            allSelected: items.length > 0 && items.every((item) => batch.isSelected(item.id)),
            someSelected: items.some((item) => batch.isSelected(item.id)),
            onToggle: (checked) =>
              batch.selectPage(
                items.map((item) => item.id),
                checked,
              ),
          }}
        >
          <BatchDeleteButton count={batch.selectedCount} noun="条台账" onDelete={removeSelected} />
        </BatchActionBar>
      )}

      {loading && <PageSkeleton rows={6} />}
      {error && <ErrorState description={error} onRetry={() => void reload()} />}
      {!loading && !error && items.length === 0 && (
        <Empty
          description={
            keyword || category || status
              ? "没有符合条件的条目"
              : "事实台账还是空的。可以先「从资料生成」一批草稿，或者手工新建一条。"
          }
        >
          <Button type="primary" onClick={() => setDraftOpen(true)}>
            从资料生成
          </Button>
        </Empty>
      )}

      <div className="claims-list">
        {items.map((claim) => (
          // 右键菜单挂在 DOM 元素上（ClaimCard 不透传 ref/事件，直接包它会失效）。
          <RowContextMenu
            key={claim.id}
            items={
              batch.selecting
                ? []
                : [
                    {
                      key: "batch_select",
                      label: "批量选择",
                      icon: <CheckSquareOutlined />,
                      onClick: batch.enterSelecting,
                    },
                  ]
            }
          >
            <div>
              <ClaimCard
                claim={claim}
                selecting={batch.selecting}
                selected={batch.isSelected(claim.id)}
                onToggleSelected={() => batch.toggle(claim.id)}
                onEdit={() => void openEdit(claim)}
                onDelete={() => void remove(claim)}
                onConfirm={() => void confirm(claim)}
              />
            </div>
          </RowContextMenu>
        ))}
      </div>

      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Pagination
          current={page}
          pageSize={CLAIMS_PAGE_SIZE}
          total={data?.total ?? 0}
          onChange={setPage}
          hideOnSinglePage
          showSizeChanger={false}
          showTotal={(count) => `共 ${count} 条`}
        />
      </div>

      <ClaimFormModal
        open={formOpen}
        claim={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => void refreshAll()}
      />
      <ClaimDraftModal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        onSaved={() => void refreshAll()}
      />
    </div>
  );
}
