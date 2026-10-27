// SPDX-License-Identifier: Apache-2.0
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
import { formatErrorGuidance } from "../api/errorGuidance";
import BatchActionBar from "../components/common/BatchActionBar";
import BatchDeleteButton from "../components/common/BatchDeleteButton";
import { useApi } from "../hooks/useApi";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useDeleteUndo } from "../features/trash/useDeleteUndo";
import type { Claim, ClaimSummary } from "../types";
import { CLAIM_CATEGORIES, VERIFICATION_STATUSES, claimPayload } from "../types";
import { t } from "../i18n";
import { CLAIM_CATEGORY_LABEL_KEYS, VERIFICATION_STATUS_LABEL_KEYS } from "../i18n/enum/claims";
import { useLocale } from "../i18n/i18nContext";

/** 列表一页 20 条，与后端 /claims/page 的默认口径一致。 */
const CLAIMS_PAGE_SIZE = 20;

export default function ClaimsPage() {
  // 本页用模块级 t()：必须订阅语言变化，否则切语言后整页文案不重渲染。
  useLocale();
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

  // 列表与「事实基线」两个读数都随同一次改动失效：只在删除后刷列表会让统计停在旧值。
  const refreshAll = async () => {
    await reload();
    await baseline.reload();
  };

  // 软删可撤销：单条删除不再前置确认，Toast 里给 5 秒「撤销」（见 useDeleteUndo）。
  // 批量删除仍走 BatchDeleteButton（二次确认），不受这里影响。
  const deleteUndo = useDeleteUndo();
  const remove = async (summary: ClaimSummary) => {
    try {
      await deleteUndo.run({ type: "claim", ids: [summary.id] }, () => deleteClaim(summary.id), {
        onRestored: () => refreshAll(),
      });
      await refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("claimsPage.error.deleteFailed"));
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
        message.warning(t("claimsPage.toast.confirmedWithTodo", { warning: saved.warnings[0] }));
      } else {
        message.success(t("claimsPage.toast.confirmed"));
      }
      await reload();
      await baseline.reload();
    } catch (err) {
      // 兜底不再是「操作失败」：说清这一步是「标记为已确认」，再拼 errorGuidance 三段（F11）。
      message.error(formatErrorGuidance(err, t("claimsPage.error.confirmFailed")));
    }
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并刷新列表与统计。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteClaims(ids);
      message.success(t("claimsPage.toast.batchDeleted", { count: deleted }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("claimsPage.error.batchDeleteFailed"));
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
      message.error(err instanceof Error ? err.message : t("claimsPage.error.loadFailed"));
    }
  };

  // 各分类的条目数来自分页响应的 SQL 汇总（与旧端点内存汇总同口径），渲染进下拉标签。
  // 不用 useMemo：标签要按当前语言取，缓存住 data 会让切语言后停在旧语言
  // （t() 是模块级函数，memo 不会为语言变化失效），7 条数据直接算更省心。
  const categoryOptions = CLAIM_CATEGORIES.map((value) => {
    const count = data?.category_counts?.[value];
    const label = t(CLAIM_CATEGORY_LABEL_KEYS[value]);
    return {
      value,
      label: count == null ? label : label + t("claimsPage.filter.countSuffix", { count }),
    };
  });

  return (
    <div className="claims-page">
      <div className="claims-page-head">
        <Space orientation="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("claimsPage.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("claimsPage.subtitle")}</Typography.Text>
        </Space>
        <Space>
          {/* 深挖的输入就是台账条目，所以入口放在这里——从别处进它都要先绕一圈。 */}
          <Button icon={<ThunderboltOutlined />} onClick={() => navigate("/claims/drill")}>
            {t("claimsPage.action.drill")}
          </Button>
          <Button icon={<FileAddOutlined />} onClick={() => setDraftOpen(true)}>
            {t("claimsPage.action.fromProfile")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("claimsPage.action.create")}
          </Button>
        </Space>
      </div>

      <div className="claims-summary">
        <Statistic title={t("claimsPage.stat.total")} value={data?.total ?? 0} />
        <Statistic
          title={t("claimsPage.stat.confirmed")}
          value={data?.confirmed_count ?? 0}
          styles={{ content: { color: "var(--rf-success-text)" } }}
        />
        <Statistic
          title={t("claimsPage.stat.pending")}
          value={data?.pending_count ?? 0}
          styles={{ content: { color: "var(--rf-warning-text)" } }}
        />
        <Statistic
          title={t("claimsPage.stat.baseline")}
          value={baseline.data?.confirmed_count ?? 0}
          prefix={<SafetyCertificateOutlined />}
        />
        {(baseline.data?.blocked_wording.length ?? 0) > 0 && (
          <Statistic
            title={t("claimsPage.stat.blocked")}
            value={baseline.data?.blocked_wording.length ?? 0}
            styles={{ content: { color: "var(--rf-error-text)" } }}
          />
        )}
      </div>

      <Space size={16} wrap className="claims-filters rf-filter-bar">
        <Select
          aria-label={t("claimsPage.filter.categoryAria")}
          value={category}
          onChange={setCategory}
          style={{ width: 180 }}
          options={[{ value: "", label: t("claimsPage.filter.allCategories") }, ...categoryOptions]}
        />
        <Select
          aria-label={t("claimsPage.filter.statusAria")}
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          options={[
            { value: "", label: t("claimsPage.filter.allStatuses") },
            ...VERIFICATION_STATUSES.map((value) => ({
              value,
              label: t(VERIFICATION_STATUS_LABEL_KEYS[value]),
            })),
          ]}
        />
        <Input.Search
          allowClear
          placeholder={t("claimsPage.filter.searchPlaceholder")}
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
          <BatchDeleteButton
            count={batch.selectedCount}
            noun={t("claimsPage.deleteNoun")}
            onDelete={removeSelected}
          />
        </BatchActionBar>
      )}

      {loading && <PageSkeleton rows={6} />}
      {error && <ErrorState description={error} onRetry={() => void reload()} />}
      {!loading && !error && items.length === 0 && (
        <Empty
          description={
            keyword || category || status
              ? t("claimsPage.empty.filtered")
              : t("claimsPage.empty.initial")
          }
        >
          <Button type="primary" onClick={() => setDraftOpen(true)}>
            {t("claimsPage.action.fromProfile")}
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
                      label: t("common.action.batchSelect"),
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
          showTotal={(count) => t("claimsPage.pagination.total", { count })}
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
