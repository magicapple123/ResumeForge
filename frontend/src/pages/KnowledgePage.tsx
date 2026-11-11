// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库：集中沉淀面经总结、简历技巧、求职策略、行业笔记等成文内容（#29）。
 *
 * 页面只负责「取数与页面级动作」（加载、删除/批量删除、打开详情/编辑、导出）；
 * 筛选与 URL 状态、卡片网格、语义检索结果、复习提醒、表单与详情分别住在
 * components/knowledge/ 下——原页面已 440 行贴线，新能力一律拆文件再加。
 */
import { PlusOutlined } from "@ant-design/icons";
import { App, Button, Pagination, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  batchDeleteKnowledge,
  createKnowledge,
  deleteKnowledge,
  exportKnowledgeMarkdown,
  getKnowledge,
  listKnowledgeCategories,
  listKnowledgeCompanies,
  listKnowledgePage,
  listKnowledgeTags,
  updateKnowledge,
} from "../api/knowledge";
import BatchActionBar from "../components/common/BatchActionBar";
import BatchDeleteButton from "../components/common/BatchDeleteButton";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import LoadingBlock from "../components/common/LoadingBlock";
import KnowledgeCardGrid from "../components/knowledge/KnowledgeCardGrid";
import KnowledgeFilterBar from "../components/knowledge/KnowledgeFilterBar";
import KnowledgeFormModal from "../components/knowledge/KnowledgeFormModal";
import KnowledgeViewerModal from "../components/knowledge/KnowledgeViewerModal";
import ReviewPromptBanner from "../components/knowledge/ReviewPromptBanner";
import SemanticSearchPanel from "../components/knowledge/SemanticSearchPanel";
import { useKnowledgeFilters } from "../components/knowledge/useKnowledgeFilters";
import { useDeleteUndo } from "../features/trash/useDeleteUndo";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useApi } from "../hooks/useApi";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type { Knowledge, KnowledgePayload, KnowledgeSummary } from "../types";
import { downloadBlob } from "../utils/download";

/** 卡片网格 15 个一页（3 列 × 5 行），与后端 /knowledge/page 端点默认值一致。 */
const KNOWLEDGE_PAGE_SIZE = 15;

export default function KnowledgePage() {
  useLocale();
  const { message } = App.useApp();
  const { filters, update } = useKnowledgeFilters();
  // 语义检索是页内展示模式，不是筛选条件：不进 URL（分享链接应该回到普通列表）。
  const [semantic, setSemantic] = useState(false);
  const [exporting, setExporting] = useState(false);
  const batch = useBatchSelection<number>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewing, setViewing] = useState<Knowledge | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestKey = JSON.stringify(filters);
  const {
    data,
    loading,
    error,
    reload: load,
  } = useApi(async () => {
    const [pageData, categoryList, tagList, companyList] = await Promise.all([
      listKnowledgePage(
        {
          q: filters.keyword,
          category: filters.category,
          tag: filters.tag,
          company: filters.company,
          uncategorized: filters.uncategorized,
        },
        filters.page,
        KNOWLEDGE_PAGE_SIZE,
      ),
      listKnowledgeCategories(),
      listKnowledgeTags(),
      // 公司下拉是可选增强：接口失败不该让整页报错。
      listKnowledgeCompanies().catch(() => [] as string[]),
    ]);
    return {
      ...pageData,
      categories: categoryList,
      tags: tagList.tags,
      companies: companyList,
      requestKey,
    };
  }, [requestKey]);

  const entries = data?.items ?? [];
  const total = data?.total ?? 0;
  const categories = data?.categories ?? [];
  const tags = data?.tags ?? [];
  const companies = data?.companies ?? [];
  const lastPage = Math.max(1, Math.ceil(total / KNOWLEDGE_PAGE_SIZE));
  // 删掉最后一页最后一条后按正确页码重拉（不能把用户困在删空的页码上）。
  useEffect(() => {
    if (data?.requestKey !== requestKey) return;
    if (entries.length === 0 && total > 0 && filters.page > lastPage) {
      update({ page: lastPage });
    }
  }, [data, requestKey, entries.length, total, filters.page, lastPage, update]);

  const submit = async (payload: KnowledgePayload) => {
    setSubmitting(true);
    try {
      if (editing) {
        await updateKnowledge(editing.id, payload);
        message.success(t("knowledgePage.toast.updated"));
      } else {
        await createKnowledge(payload);
        message.success(t("knowledgePage.toast.created"));
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("knowledgePage.error.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const exportMarkdown = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportKnowledgeMarkdown();
      downloadBlob(blob, filename);
      message.success(t("knowledgePage.toast.exported", { count: total }));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("knowledgePage.error.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  // 软删可撤销：单条删除不再前置确认，Toast 里给 5 秒「撤销」（见 useDeleteUndo）。
  const deleteUndo = useDeleteUndo();
  const remove = async (entry: KnowledgeSummary) => {
    try {
      await deleteUndo.run(
        { type: "knowledge_entry", ids: [entry.id] },
        () => deleteKnowledge(entry.id),
        { onRestored: () => load() },
      );
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : t("knowledgePage.error.deleteFailed"));
    }
  };

  /** 批量删除：一次请求删完（软删）。失败时保留选择，用户可直接重试。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteKnowledge(ids);
      message.success(t("knowledgePage.toast.batchDeleted", { count: deleted }));
      batch.exitSelecting();
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : t("knowledgePage.error.batchDeleteFailed"),
      );
      return;
    }
    await load();
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  /** 编辑需要全文（表单带正文编辑器），列表行只有摘要——打开前先取详情。 */
  const openEdit = async (entry: KnowledgeSummary) => {
    try {
      setEditing(await getKnowledge(entry.id));
      setFormOpen(true);
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : t("knowledgePage.error.loadEntryFailed"),
      );
    }
  };

  /** 查看同样需要全文：弹窗先开、占位，详情到了替换成正文。 */
  const openViewId = async (id: number) => {
    setViewOpen(true);
    setViewLoading(true);
    setViewing(null);
    try {
      setViewing(await getKnowledge(id));
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : t("knowledgePage.error.loadEntryFailed"),
      );
      setViewOpen(false);
    } finally {
      setViewLoading(false);
    }
  };

  const openView = (entry: KnowledgeSummary) => void openViewId(entry.id);

  const filtersEmpty =
    !filters.keyword &&
    !filters.category &&
    !filters.tag &&
    !filters.company &&
    !filters.uncategorized;
  const semanticActive = semantic && filters.keyword.trim().length > 0;

  return (
    <div className="knowledge-page">
      <div className="knowledge-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("knowledgePage.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("knowledgePage.page.subtitle")}</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t("knowledgePage.action.create")}
        </Button>
      </div>

      {/* #29F 复习提醒：每周最多一次，失败安静隐藏。 */}
      <ReviewPromptBanner />

      <KnowledgeFilterBar
        filters={filters}
        onChange={update}
        semantic={semantic}
        onSemanticChange={setSemantic}
        categories={categories}
        tags={tags}
        companies={companies}
        exporting={exporting}
        onExport={() => void exportMarkdown()}
      />

      {batch.selecting && (
        <BatchActionBar
          count={batch.selectedCount}
          onExit={batch.exitSelecting}
          pageSelectAll={{
            allSelected: entries.length > 0 && entries.every((item) => batch.isSelected(item.id)),
            someSelected: entries.some((item) => batch.isSelected(item.id)),
            onToggle: (checked) =>
              batch.selectPage(
                entries.map((item) => item.id),
                checked,
              ),
          }}
        >
          <BatchDeleteButton
            count={batch.selectedCount}
            noun={t("knowledgePage.batch.noun")}
            onDelete={removeSelected}
          />
        </BatchActionBar>
      )}

      {semanticActive ? (
        <SemanticSearchPanel
          query={filters.keyword}
          company={filters.company}
          onOpen={(id) => void openViewId(id)}
        />
      ) : loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorState
          description={t("knowledgePage.error.loadFailed", { error })}
          onRetry={() => void load()}
        />
      ) : entries.length === 0 ? (
        // total=0 时区分「库里真没东西」和「筛选后没结果」：库空时把主按钮内嵌进空态。
        total === 0 && filtersEmpty ? (
          <EmptyState
            description={t("knowledgePage.empty.none")}
            actionLabel={t("knowledgePage.action.create")}
            onAction={openCreate}
          />
        ) : (
          <EmptyState description={t("knowledgePage.empty.filtered")} />
        )
      ) : (
        <>
          <KnowledgeCardGrid
            entries={entries}
            selecting={batch.selecting}
            selectedIds={batch.selectedIds}
            onToggleSelect={batch.toggle}
            onOpen={(entry) => void openView(entry)}
            onEdit={(entry) => void openEdit(entry)}
            onDelete={(entry) => void remove(entry)}
            onEnterSelecting={batch.enterSelecting}
          />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={filters.page}
              pageSize={KNOWLEDGE_PAGE_SIZE}
              total={total}
              onChange={(nextPage) => update({ page: nextPage })}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => t("knowledgePage.pagination.total", { count })}
            />
          </div>
        </>
      )}

      <KnowledgeFormModal
        open={formOpen}
        entry={editing}
        categories={categories}
        submitting={submitting}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(payload) => void submit(payload)}
      />

      <KnowledgeViewerModal
        open={viewOpen}
        loading={viewLoading}
        entry={viewing}
        onClose={() => setViewOpen(false)}
      />
    </div>
  );
}
