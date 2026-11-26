// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「外部简历」区块（第 21 条）：只读快照的列表 + 上传 + 行操作。
 *
 * 挂在简历中心顶部（不新增 Tab、不改页面的筛选/分页/批量选择）：
 *
 * - 列表按「文件行」排（整改 #3）：类型徽标 + 文件名 + 状态副行，岗位/时间各自成列，
 *   详见 `ExternalResumeFileTable.tsx`；
 * - 操作区**没有**「编辑 / 导出 / 制作台」，只有「查看文本 / 预览原件 / 文本检查 /
 *   用于面试 / 删除」——用户不会点进去找编辑；
 * - 扫描件（没提取到文字）标「未提取到文字」，主操作自动换成「预览原件」，
 *   「用于面试」置灰并说明原因；文本检查只说明"没有文字可查"，绝不显示"检查通过"；
 * - 单条删除是软删（进回收站），直接执行 + 5 秒撤销 Toast；**不删物理文件**；
 * - 批量删除走「右键/⋯ → 批量选择 → 删除所选」：**先弹一次确认**（N 份、可恢复），
 *   批量场景**不叠** 5 秒撤销——一次删十几份时撤销条只会挡住列表。
 *
 * 组件只做呈现与交互编排：取数/上传/删除在 `useExternalResumes`，详情与文本检查在
 * `ExternalResumeDetailDrawer`，上传表单在 `ExternalResumeUploadModal`。
 */
import { UploadOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { restoreTrashItem } from "../../api/trash";
import type { ExternalResumeItem } from "../../api/externalResumes";
import BatchActionBar from "../../components/common/BatchActionBar";
import BatchDeleteButton from "../../components/common/BatchDeleteButton";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import type { RowActionItem } from "../../components/common/RowActions";
import ExternalResumeDetailDrawer from "../../features/resume/list/ExternalResumeDetailDrawer";
import type { ExternalResumeDetailTab } from "../../features/resume/list/ExternalResumeDetailDrawer";
import ExternalResumeUploadModal from "../../features/resume/list/ExternalResumeUploadModal";
import { useExternalResumes } from "../../features/external-resume/useExternalResumes";
import type { ExternalResumeFilters } from "../../features/external-resume/useExternalResumes";
import ExternalResumeFileTable from "./ExternalResumeFileTable";
import ExternalResumeFiltersBar from "./ExternalResumeFiltersBar";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface DetailState {
  id: number;
  tab: ExternalResumeDetailTab;
}

interface Props {
  /**
   * `card`（默认）：自带标题 / 副标题 / 上传按钮的独立卡片，任何页面都能直接嵌。
   * `bare`：**不传 `title`**（因此没有 `.ant-card-head`，见清单 §1.9），标题行与副标题
   * 由本组件渲染在卡片**之外**，上传按钮挂在标题行右端（07-1）。独立页
   * （`/resumes/external`）用这一档；宿主页只保留返回链接。
   *
   * 默认值必须保持 `card`：将来若别处复用面板，默认值不能变成 `bare`，否则外观会被改掉。
   */
  variant?: "card" | "bare";
  filters?: ExternalResumeFilters;
  onFiltersChange?: (filters: ExternalResumeFilters) => void;
}

export default function ExternalResumePanel({
  variant = "card",
  filters = {},
  onFiltersChange,
}: Props) {
  useLocale();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const toast = useToast();
  const { items, total, loading, error, reload, uploading, upload, remove, removeMany } =
    useExternalResumes(filters);
  const hasFilters = Boolean(filters.keyword?.trim() || filters.jobId != null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  /** 多选状态机与简历中心共用一份（`useBatchSelection`），入口只有右键与「⋯」两处。 */
  const batch = useBatchSelection<number>();

  const handleUpload = async (
    file: File,
    options: { name: string; jobId: number | null },
  ): Promise<boolean> => {
    try {
      const record = await upload(file, options);
      if (record.has_text) {
        toast.success(t("resumesPage.external.uploaded", { name: record.name }));
      } else {
        // 扫描件不是失败：文件已保存，只是没有文本可检查/可复用。
        toast.warning(t("resumesPage.external.uploadedNoText", { name: record.name }));
      }
      if (hasFilters && onFiltersChange) {
        onFiltersChange({});
        toast.info(t("resumesPage.external.uploadFiltersCleared"));
      }
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.external.uploadFailed"));
      return false;
    }
  };

  const handleDelete = async (item: ExternalResumeItem): Promise<void> => {
    try {
      await remove(item.id);
      toast.undo(
        t("resumesPage.external.deleted", { name: item.name }),
        {
          label: t("toast.undo.label"),
          onClick: async () => {
            try {
              await restoreTrashItem("external_resume", item.id);
              toast.success(t("resumesPage.external.restored", { name: item.name }));
              await reload();
            } catch {
              toast.error(t("resumesPage.external.restoreFailed"));
            }
          },
        },
        { key: `undo-external-resume-${item.id}` },
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.external.deleteFailed"));
    }
  };

  const handleUseForInterview = (item: ExternalResumeItem): void => {
    if (!item.has_text) {
      message.warning(t("resumesPage.external.noTextForInterview"));
      return;
    }
    navigate(`/interview?externalResumeId=${item.id}`);
  };

  const openDetail = (item: ExternalResumeItem, tab: ExternalResumeDetailTab): void => {
    setDetail({ id: item.id, tab });
  };

  /**
   * 批量删除：**先确认再删**（一次删十几份，误点的代价远大于一次点击）。
   *
   * 与单条删除的差别是撤销：单条用 Toast 上的 5 秒撤销（软删可恢复），批量**不叠**撤销条
   * ——十几份的撤销条会盖住列表，而且"全部恢复"的语义在 Toast 里放不下。确认弹窗里写清
   * 「进回收站可恢复」，用户仍有兜底路径（回收站）。
   */
  const confirmBatchDelete = (): void => {
    if (batch.selectedCount === 0) return;
    const ids = [...batch.selectedIds];
    modal.confirm({
      title: t("resumesPage.external.batchDelete.title", { count: ids.length }),
      content: t("common.note.trashRecovery"),
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { deleted, failed } = await removeMany(ids);
          if (failed === 0) {
            toast.success(t("resumesPage.external.batchDelete.done", { count: deleted }));
          } else if (deleted > 0) {
            // 部分失败要说清两个数字：假装全成功会让用户以为列表刷新出了问题。
            toast.warning(
              t("resumesPage.external.batchDelete.partial", { done: deleted, failed }),
            );
          } else {
            toast.error(t("resumesPage.external.batchDelete.failed"));
          }
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : t("resumesPage.external.batchDelete.failed"),
          );
        } finally {
          batch.exitSelecting();
        }
      },
    });
  };

  /** 多选态的整行右键（与批量工具条同一组动作：目前只有「删除所选」）。 */
  const batchActions: RowActionItem[] = [
    {
      key: "batch_delete",
      label: t("common.batchBar.deleteSelected"),
      danger: true,
      onClick: confirmBatchDelete,
    },
  ];

  const uploadButton = (
    <Button icon={<UploadOutlined />} loading={uploading} onClick={() => setUploadOpen(true)}>
      {t("resumesPage.external.upload")}
    </Button>
  );

  /**
   * 独立页的标题行（`bare` 变体专用）：标题 + 标签 + 副标题，上传按钮挂在标题同一行的右端。
   *
   * 为什么标题行放在面板里而不是宿主页（07-1）：按钮必须在**列表为空时消失**
   * （只留 `EmptyState` 里那一颗，避免两颗同名按钮），而条数在 `useExternalResumes` 里，
   * 宿主页拿不到。放在同一个组件里，这个判断就是 `items.length > 0` 一行。
   * 宿主页（`ExternalResumesPage`）只保留页面级返回链接——「标题不进 `Card title`」的
   * 版式约束（清单 §1.9）依然成立：这一行不在 `.ant-card-head` 里。
   *
   * 对齐：按钮与标题同一行、`align="center"`（按钮 40px / 标题 28px，中心线差 0）。
   * 改之前按钮在卡片里单独占一行，中心比标题低 85px，把列表推下去 77px。
   */
  const bareHeader = (
    <div className="external-resume-header">
      <Flex vertical gap={4}>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Flex gap={8} align="center" wrap style={{ minWidth: 0 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("resumesPage.external.title")}
            </Typography.Title>
            <Tag style={{ marginInlineEnd: 0 }}>{t("resumesPage.external.tag")}</Tag>
          </Flex>
          {items.length > 0 || hasFilters ? uploadButton : null}
        </Flex>
        <Typography.Text type="secondary">{t("resumesPage.external.subtitle")}</Typography.Text>
      </Flex>
    </div>
  );

  const body = () => {
    if (loading) return <LoadingBlock minHeight={96} />;
    if (error) return <ErrorState description={error} onRetry={() => void reload()} />;
    if (items.length === 0) {
      if (hasFilters)
        return (
          <EmptyState
            description={t("resumesPage.external.noMatches")}
            actionLabel={t("resumesPage.external.clearFilters")}
            onAction={() => onFiltersChange?.({})}
          />
        );
      return (
        <EmptyState
          description={
            <Space orientation="vertical" size={2} style={{ textAlign: "center" }}>
              <Typography.Text>{t("resumesPage.external.empty")}</Typography.Text>
              <Typography.Text type="secondary">
                {t("resumesPage.external.emptyHint")}
              </Typography.Text>
            </Space>
          }
          actionLabel={t("resumesPage.external.upload")}
          onAction={() => setUploadOpen(true)}
        />
      );
    }
    // 文件行表格：呈现与事件转发在 `ExternalResumeFileTable`，这里只把"打开哪个抽屉 /
    // 删哪一份"接上去。`openDetail` 的 tab 就是抽屉的初始页（原件 / 文本 / 检查）。
    return (
      <ExternalResumeFileTable
        items={items}
        loading={loading}
        batch={batch}
        batchActions={batchActions}
        onOpenText={(item) => openDetail(item, "text")}
        onOpenOriginal={(item) => openDetail(item, "original")}
        onOpenCheck={(item) => openDetail(item, "check")}
        onUseForInterview={handleUseForInterview}
        onDelete={(item) => void handleDelete(item)}
      />
    );
  };

  const content = (
    <Flex vertical gap={12}>
      {onFiltersChange ? (
        <ExternalResumeFiltersBar
          filters={filters}
          onChange={onFiltersChange}
          total={total}
          shown={items.length}
          loading={loading}
        />
      ) : null}
      {/* 批量条只在多选态出现（默认观感与改造前一致：没有任何勾选框与工具条）。 */}
      {batch.selecting ? (
        <BatchActionBar
          count={batch.selectedCount}
          pageSelectAll={{
            allSelected:
              items.length > 0 && items.every((item) => batch.isSelected(item.id)),
            someSelected: batch.selectedCount > 0,
            onToggle: (checked) =>
              batch.selectPage(
                items.map((item) => item.id),
                checked,
              ),
          }}
          pageSelectAllLabelHidden
          onExit={batch.exitSelecting}
        >
          <BatchDeleteButton
            count={batch.selectedCount}
            noun={t("resumesPage.external.title")}
            onDelete={confirmBatchDelete}
          />
        </BatchActionBar>
      ) : null}
      {body()}
    </Flex>
  );

  const modals = (
    <>
      <ExternalResumeUploadModal
        open={uploadOpen}
        uploading={uploading}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleUpload}
      />
      <ExternalResumeDetailDrawer
        resumeId={detail?.id ?? null}
        initialTab={detail?.tab ?? "original"}
        onClose={() => setDetail(null)}
      />
    </>
  );

  // 独立页形态：没有 Card head（清单 §1.9 的硬约束），标题行由本组件渲染在卡片之外，
  // 上传按钮挂在标题行右端（07-1：不再单独占一行、不再把列表推下去 77px）。
  //
  // 标题行与列表卡之间 gap 11 而不是 12：副标题到首行 = 11（间距）+ 1（卡片边框）+
  // 12（卡内边距）= 24px，正好落在验收线上（改之前 77px）。用 12 会多出边框那 1px → 25px。
  if (variant === "bare") {
    return (
      <Flex vertical gap={11}>
        {bareHeader}
        <Card size="small">{content}</Card>
        {modals}
      </Flex>
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space orientation="vertical" size={2}>
          <Space size={8}>
            <Typography.Text strong>{t("resumesPage.external.title")}</Typography.Text>
            <Tag>{t("resumesPage.external.tag")}</Tag>
          </Space>
          <Typography.Text type="secondary" style={{ fontWeight: "normal" }}>
            {t("resumesPage.external.subtitle")}
          </Typography.Text>
        </Space>
      }
      extra={uploadButton}
    >
      {content}
      {modals}
    </Card>
  );
}
