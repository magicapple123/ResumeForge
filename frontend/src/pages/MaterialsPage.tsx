/** 资料箱：集中管理找工作和面试相关的材料（证书、作品、面经、复盘、链接、笔记）。 */
import {
  CheckSquareOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PaperClipOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Pagination,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import LoadingBlock from "../components/common/LoadingBlock";
import { useMemo, useState } from "react";
import {
  batchDeleteMaterials,
  createMaterial,
  deleteMaterial,
  getMaterial,
  listMaterialCategories,
  listMaterialsPage,
  updateMaterial,
} from "../api/material";
import MaterialFormModal from "../components/materials/MaterialFormModal";
import UserFilesPanel from "../components/materials/UserFilesPanel";
import { DetailTrigger, RecordDetailDrawer } from "../components/common/RecordDetail";
import { RowActions, RowContextMenu } from "../components/common/RowActions";
import BatchActionBar from "../components/common/BatchActionBar";
import BatchDeleteButton from "../components/common/BatchDeleteButton";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useApi } from "../hooks/useApi";
import ErrorState from "../components/common/ErrorState";
import type { Material, MaterialPayload, MaterialSummary } from "../types";
import { canPreviewImage } from "../utils/attachments";
import { formatDateTime } from "../utils/format";

/** 卡片网格 18 个一页（桌面主断点下 4 列网格，末行可留空），与后端 /materials/page 的默认口径一致。 */
const MATERIALS_PAGE_SIZE = 18;

export default function MaterialsPage() {
  const { message } = App.useApp();
  // 批量选择：勾选若干份后一次删除（软删，全部进回收站）。
  const batch = useBatchSelection<number>();
  // 列表是摘要（无 data_url / 附件文字）；详情与编辑时再按需取全量。
  // 分页在服务端做（RF-08 续）：只保存当前页 18 张，keyword/category 下发服务端。
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [detail, setDetail] = useState<Material | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 页面顶部视图切换：资料卡片 / 我的文件清单（入口刻意挂在这里，不加新菜单）。
  const [view, setView] = useState<string>("materials");

  const {
    data,
    loading,
    error,
    reload: load,
  } = useApi(async () => {
    const [pageData, categoryList] = await Promise.all([
      listMaterialsPage({ keyword, category }, page, MATERIALS_PAGE_SIZE),
      listMaterialCategories(),
    ]);
    return { ...pageData, categories: categoryList };
  }, [category, keyword, page]);
  const materials = data?.items ?? [];
  const total = data?.total ?? 0;
  const categories = useMemo(() => data?.categories ?? [], [data]);

  // 筛选条件变化时回第 1 页（渲染期守卫式调整，Compiler 规范）。
  const filterKey = `${keyword}|${category}`;
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

  const submit = async (payload: MaterialPayload) => {
    setSubmitting(true);
    try {
      if (editing) {
        await updateMaterial(editing.id, payload);
        message.success("资料已更新");
      } else {
        await createMaterial(payload);
        message.success("已放进资料箱");
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

  const remove = async (summary: MaterialSummary) => {
    try {
      await deleteMaterial(summary.id);
      message.success("已移入回收站，可在「回收站」里恢复");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：一次请求删完（软删），成功后清空选择并重拉当前页。 */
  const removeSelected = async () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteMaterials(ids);
      message.success(`已删除 ${deleted} 份资料，可在「回收站」里恢复`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量删除失败，请重试");
    }
    batch.exitSelecting();
    await load();
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  // 列表只有摘要：详情与编辑都要先按 id 取全量（图片 data_url、附件全文在详情接口里）。
  const openDetail = async (summary: MaterialSummary) => {
    try {
      setDetail(await getMaterial(summary.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载资料详情失败");
    }
  };

  const openEdit = async (summary: MaterialSummary) => {
    try {
      setEditing(await getMaterial(summary.id));
      setFormOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载资料失败");
    }
  };

  // 右键菜单：批量选择（顶部入口）+ 编辑 + 单条删除；多选模式下收起。
  const actionsFor = (summary: MaterialSummary) => {
    const items = [
      { key: "edit", label: "编辑", icon: <EditOutlined />, onClick: () => void openEdit(summary) },
      {
        key: "delete",
        label: "删除",
        danger: true,
        icon: <DeleteOutlined />,
        confirm: `删除资料「${summary.title || summary.category}」？`,
        onClick: () => void remove(summary),
      },
    ];
    return batch.selecting
      ? []
      : [
          {
            key: "batch_select",
            label: "批量选择",
            icon: <CheckSquareOutlined />,
            onClick: batch.enterSelecting,
          },
          ...items,
        ];
  };

  return (
    <div className="materials-page">
      <div className="materials-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            资料箱
          </Typography.Title>
          <Typography.Text type="secondary">
            这里放与找工作、面试相关的材料：证书、作品、面经、公司信息、面试复盘、实习材料、链接与笔记。
            助手可以读它们、帮你归类整理、总结某一条，或把某条内容整理进个人资料。
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          放入资料
        </Button>
      </div>

      <Segmented
        style={{ marginBottom: 16 }}
        value={view}
        onChange={(value) => setView(String(value))}
        options={[
          { label: "资料", value: "materials" },
          { label: "我的文件", value: "files" },
        ]}
      />

      {view === "files" ? (
        <UserFilesPanel />
      ) : (
        <>
          <Space wrap className="rf-filter-bar">
            <Input.Search
              allowClear
              placeholder="搜索标题、正文或备注"
              style={{ width: 260 }}
              onSearch={setKeyword}
            />
            <Select
              aria-label="资料分类筛选"
              value={category}
              options={categoryOptions}
              style={{ width: 160 }}
              onChange={setCategory}
            />
          </Space>

          {batch.selecting && (
            <BatchActionBar
              count={batch.selectedCount}
              onExit={batch.exitSelecting}
              pageSelectAll={{
                allSelected:
                  materials.length > 0 && materials.every((item) => batch.isSelected(item.id)),
                someSelected: materials.some((item) => batch.isSelected(item.id)),
                onToggle: (checked) =>
                  batch.selectPage(
                    materials.map((item) => item.id),
                    checked,
                  ),
              }}
            >
              <BatchDeleteButton
                count={batch.selectedCount}
                noun="份资料"
                onDelete={removeSelected}
              />
            </BatchActionBar>
          )}

          {loading ? (
            <LoadingBlock />
          ) : error ? (
            <ErrorState description={`资料箱加载失败：${error}`} onRetry={() => void load()} />
          ) : materials.length === 0 ? (
            <Empty
              // total=0 时区分「库里真没东西」和「筛选后没结果」：库空才引导去新增，
              // 否则提示调整筛选（服务端筛选下 total 就是筛选后的总数）。
              description={
                total === 0 && !keyword && !category
                  ? "资料箱还是空的，点右上角「放入资料」开始"
                  : "没有符合筛选条件的资料"
              }
            />
          ) : (
            <>
              <div className="materials-grid">
                {materials.map((material) => (
                  // 右键菜单挂在 DOM 元素上（DetailTrigger 不透传 ref/事件，直接包它会失效）。
                  <RowContextMenu key={material.id} items={actionsFor(material)}>
                    <div>
                      <DetailTrigger
                        label={`打开资料「${material.title || material.category}」的详情`}
                        onOpen={() => void openDetail(material)}
                      >
                        <Card size="small" className="material-card">
                          <div className="material-card-head">
                            {batch.selecting && (
                              <Checkbox
                                aria-label={`选择资料 ${material.title || material.category}`}
                                checked={batch.isSelected(material.id)}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => batch.toggle(material.id)}
                              />
                            )}
                            <Tag color="blue">{material.category}</Tag>
                            <RowActions more={actionsFor(material)} disabled={batch.selecting} />
                          </div>
                          <Typography.Title level={5} ellipsis={{ tooltip: material.title }}>
                            {material.title || "（未命名资料）"}
                          </Typography.Title>
                          {material.content && (
                            <Typography.Paragraph
                              type="secondary"
                              ellipsis={{ rows: 3 }}
                              className="material-card-content"
                            >
                              {material.content}
                            </Typography.Paragraph>
                          )}
                          <div className="material-card-meta">
                            {material.files.length > 0 && (
                              <Typography.Text type="secondary">
                                <PaperClipOutlined /> {material.files.length} 个附件
                              </Typography.Text>
                            )}
                            {material.url && (
                              <Typography.Link
                                href={material.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <LinkOutlined /> 链接
                              </Typography.Link>
                            )}
                            <Typography.Text type="secondary">
                              {formatDateTime(material.updated_at)}
                            </Typography.Text>
                          </div>
                        </Card>
                      </DetailTrigger>
                    </div>
                  </RowContextMenu>
                ))}
              </div>
              <div style={{ textAlign: "right", marginTop: 12 }}>
                <Pagination
                  current={page}
                  pageSize={MATERIALS_PAGE_SIZE}
                  total={total}
                  onChange={setPage}
                  hideOnSinglePage
                  showSizeChanger={false}
                  showTotal={(count) => `共 ${count} 条`}
                />
              </div>
            </>
          )}
        </>
      )}

      <RecordDetailDrawer
        open={detail !== null}
        title={detail?.title || "（未命名资料）"}
        tags={detail && <Tag color="blue">{detail.category}</Tag>}
        fields={
          detail
            ? [
                { label: "链接", value: detail.url || "-" },
                {
                  label: "附件",
                  value: detail.files.length > 0 ? `${detail.files.length} 个` : "-",
                },
                { label: "创建时间", value: formatDateTime(detail.created_at) },
                { label: "更新时间", value: formatDateTime(detail.updated_at) },
              ]
            : []
        }
        sections={
          detail
            ? [
                { title: "正文", content: detail.content || "（无）" },
                { title: "备注", content: detail.note || "（无）" },
                {
                  title: `附件（${detail.files.length}）`,
                  content:
                    detail.files.length === 0 ? (
                      "（无）"
                    ) : (
                      <div className="material-file-list">
                        {detail.files.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="material-file-item">
                            {file.data_url && canPreviewImage(file.mime_type) ? (
                              <img
                                src={file.data_url}
                                alt={file.name}
                                style={{
                                  width: 64,
                                  height: 64,
                                  objectFit: "cover",
                                  borderRadius: 4,
                                }}
                              />
                            ) : (
                              <PaperClipOutlined className="material-file-icon" />
                            )}
                            <div className="material-file-meta">
                              <Typography.Text ellipsis={{ tooltip: file.name }}>
                                {file.name}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {file.data_url
                                  ? `图片 · ${Math.round(file.size_bytes / 1024)} KB`
                                  : `文字 ${file.text.length} 字`}
                              </Typography.Text>
                            </div>
                          </div>
                        ))}
                      </div>
                    ),
                },
              ]
            : []
        }
        actions={
          detail && (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => {
                // 详情里已经是全量数据，不必再按 id 拉一次。
                setEditing(detail);
                setFormOpen(true);
                setDetail(null);
              }}
            >
              编辑
            </Button>
          )
        }
        onClose={() => setDetail(null)}
      />

      <MaterialFormModal
        open={formOpen}
        material={editing}
        categories={categories}
        submitting={submitting}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(payload) => void submit(payload)}
      />
    </div>
  );
}
