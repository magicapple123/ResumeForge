// SPDX-License-Identifier: Apache-2.0
/** 知识库：集中沉淀面经总结、简历技巧、求职策略、行业笔记等成文内容。 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import LoadingBlock from "../components/common/LoadingBlock";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  batchDeleteKnowledge,
  createKnowledge,
  deleteKnowledge,
  getKnowledge,
  listKnowledgeCategories,
  listKnowledgePage,
  listKnowledgeTags,
  updateKnowledge,
} from "../api/knowledge";
import { RowActions, RowContextMenu } from "../components/common/RowActions";
import BatchActionBar from "../components/common/BatchActionBar";
import BatchDeleteButton from "../components/common/BatchDeleteButton";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useApi } from "../hooks/useApi";
import ErrorState from "../components/common/ErrorState";
import { DetailTrigger } from "../components/common/RecordDetail";
import KnowledgeFormModal from "../components/knowledge/KnowledgeFormModal";
import { AssistantMessageContent } from "../features/assistant/components/AssistantMessageContent";
import type { Knowledge, KnowledgePayload, KnowledgeSummary } from "../types";
import { formatDateTime } from "../utils/format";

/** 卡片网格 15 个一页（3 列 × 5 行），与后端 /knowledge/page 端点默认值一致。 */
const KNOWLEDGE_PAGE_SIZE = 15;

export default function KnowledgePage() {
  const { message } = App.useApp();
  // 批量选择：勾选若干条后一次删除（软删，全部进回收站）。
  const batch = useBatchSelection<number>();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Knowledge | null>(null);
  // 查看弹窗：全文不在列表响应里（列表只有 content_excerpt 摘要），打开时取详情。
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewing, setViewing] = useState<Knowledge | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestKey = JSON.stringify([keyword, category, tag, page]);
  const {
    data,
    loading,
    error,
    reload: load,
  } = useApi(async () => {
    const [pageData, categoryList, tagList] = await Promise.all([
      listKnowledgePage({ q: keyword, category, tag }, page, KNOWLEDGE_PAGE_SIZE),
      listKnowledgeCategories(),
      listKnowledgeTags(),
    ]);
    return { ...pageData, categories: categoryList, tags: tagList.tags, requestKey };
  }, [requestKey]);
  const entries = data?.items ?? [];
  const total = data?.total ?? 0;
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const tags = useMemo(() => data?.tags ?? [], [data]);
  // Only a response for this filter/page can correct a deleted last page.
  const lastPage = Math.max(1, Math.ceil(total / KNOWLEDGE_PAGE_SIZE));
  if (data?.requestKey === requestKey && entries.length === 0 && total > 0 && page > lastPage) {
    setPage(lastPage);
  }

  // 筛选条件变化时回第 1 页（渲染期守卫式调整，Compiler 规范）。
  const filterKey = `${keyword}|${category}|${tag}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "全部分类" },
      ...categories.map((item) => ({ value: item, label: item })),
    ],
    [categories],
  );

  // 标签下拉来自全库标签端点（/knowledge/tags），与服务端筛选口径一致；
  // 换标签会触发 filterKey 变化 → 回第 1 页并按 tag 重新请求。
  const tagOptions = useMemo(
    () => [{ value: "", label: "全部标签" }, ...tags.map((item) => ({ value: item, label: item }))],
    [tags],
  );

  const submit = async (payload: KnowledgePayload) => {
    setSubmitting(true);
    try {
      if (editing) {
        await updateKnowledge(editing.id, payload);
        message.success("条目已更新");
      } else {
        await createKnowledge(payload);
        message.success("已加入知识库");
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (entry: KnowledgeSummary) => {
    try {
      await deleteKnowledge(entry.id);
      message.success("已移入回收站，可在「回收站」里恢复");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：一次请求删完（软删）。**失败时保留选择**——悄悄清掉选中会让用户
   *  以为删成功了，留着选择可以直接重试（PR-14）。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteKnowledge(ids);
      message.success(`已删除 ${deleted} 条知识，可在「回收站」里恢复`);
      batch.exitSelecting();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败，请重试");
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取条目失败");
    }
  };

  /** 查看同样需要全文：弹窗先开、Spin 占位，详情到了替换成正文。 */
  const openView = async (entry: KnowledgeSummary) => {
    setViewOpen(true);
    setViewLoading(true);
    setViewing(null);
    try {
      setViewing(await getKnowledge(entry.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取条目失败");
      setViewOpen(false);
    } finally {
      setViewLoading(false);
    }
  };

  const actionsFor = (entry: KnowledgeSummary) => {
    // 不再放「查看」按钮：点卡片本身就打开详情（DetailTrigger），重复入口只会占地方。
    const primary: { key: string; label: string; icon?: ReactNode; onClick: () => void }[] = [];
    const more = [
      { key: "edit", label: "编辑", icon: <EditOutlined />, onClick: () => void openEdit(entry) },
      {
        key: "delete",
        label: "删除",
        danger: true,
        icon: <DeleteOutlined />,
        confirm: `删除条目「${entry.title}」？`,
        onClick: () => void remove(entry),
      },
    ];
    // 右键菜单顶部加「批量选择」入口；多选模式下右键菜单收起。
    const all = batch.selecting
      ? []
      : [
          {
            key: "batch_select",
            label: "批量选择",
            icon: <CheckSquareOutlined />,
            onClick: batch.enterSelecting,
          },
          ...primary,
          ...more,
        ];
    return { primary, more, all };
  };

  return (
    <div className="knowledge-page">
      <div className="knowledge-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            知识库
          </Typography.Title>
          <Typography.Text type="secondary">
            沉淀面经总结、简历技巧、求职策略、行业笔记等成文内容。正文支持 Markdown，
            保存后按标题、列表、表格等结构渲染。
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增知识
        </Button>
      </div>

      <Space wrap className="rf-filter-bar">
        <Input.Search
          allowClear
          placeholder="搜索标题或正文"
          style={{ width: 260 }}
          onSearch={setKeyword}
        />
        <Select
          aria-label="分类筛选"
          value={category}
          options={categoryOptions}
          style={{ width: 160 }}
          onChange={setCategory}
        />
        <Select
          aria-label="标签筛选"
          value={tag}
          options={tagOptions}
          style={{ width: 160 }}
          onChange={setTag}
        />
      </Space>

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
          <BatchDeleteButton count={batch.selectedCount} noun="条知识" onDelete={removeSelected} />
        </BatchActionBar>
      )}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorState description={`知识库加载失败：${error}`} onRetry={() => void load()} />
      ) : entries.length === 0 ? (
        <Empty
          // total=0 时区分「库里真没东西」和「筛选后没结果」：库空才引导去新增，
          // 否则提示调整筛选（服务端筛选下 total 就是筛选后的总数）。
          description={
            total === 0 && !keyword && !category && !tag
              ? "知识库还是空的，点右上角「新增知识」开始"
              : "没有符合筛选条件的条目"
          }
        />
      ) : (
        <>
          <div className="knowledge-grid">
            {entries.map((entry) => {
              const { primary, more, all } = actionsFor(entry);
              return (
                // 右键菜单挂在 DOM 元素上（DetailTrigger 不透传 ref/事件，直接包它会失效）。
                <RowContextMenu key={entry.id} items={all}>
                  <div>
                    <DetailTrigger
                      label={`打开知识条目「${entry.title}」的详情`}
                      onOpen={() => void openView(entry)}
                    >
                      <Card size="small" className="knowledge-card">
                        <div className="knowledge-card-head">
                          {batch.selecting && (
                            <Checkbox
                              aria-label={`选择知识条目 ${entry.title}`}
                              checked={batch.isSelected(entry.id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => batch.toggle(entry.id)}
                            />
                          )}
                          <Tag color="blue">{entry.category}</Tag>
                          <RowActions primary={primary} more={more} disabled={batch.selecting} />
                        </div>
                        <Typography.Title level={5} ellipsis={{ tooltip: entry.title }}>
                          {entry.title}
                        </Typography.Title>
                        {entry.tags.length > 0 && (
                          <Space size={4} wrap className="knowledge-card-tags">
                            {entry.tags.map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                          </Space>
                        )}
                        {entry.content_excerpt && (
                          <Typography.Paragraph
                            type="secondary"
                            ellipsis={{ rows: 3 }}
                            className="knowledge-card-content"
                          >
                            {entry.content_excerpt}
                          </Typography.Paragraph>
                        )}
                        <div className="knowledge-card-meta">
                          {entry.source && (
                            <Typography.Text type="secondary">{entry.source}</Typography.Text>
                          )}
                          <Typography.Text type="secondary">
                            {formatDateTime(entry.updated_at)}
                          </Typography.Text>
                        </div>
                      </Card>
                    </DetailTrigger>
                  </div>
                </RowContextMenu>
              );
            })}
          </div>
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={KNOWLEDGE_PAGE_SIZE}
              total={total}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => `共 ${count} 条`}
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

      <Modal
        open={viewOpen}
        title={viewing?.title}
        width={760}
        footer={null}
        onCancel={() => setViewOpen(false)}
      >
        {viewLoading ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <LoadingBlock />
          </div>
        ) : (
          viewing && (
            <>
              <Space wrap style={{ marginBottom: 12 }}>
                <Tag color="blue">{viewing.category}</Tag>
                {viewing.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
                {viewing.source && (
                  <Typography.Text type="secondary">{viewing.source}</Typography.Text>
                )}
              </Space>
              <div className="knowledge-card-content">
                <AssistantMessageContent content={viewing.content} />
              </div>
            </>
          )
        )}
      </Modal>
    </div>
  );
}
