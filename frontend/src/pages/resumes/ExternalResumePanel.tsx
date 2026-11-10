// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「外部简历」区块（第 21 条）：只读快照的列表 + 上传 + 行操作。
 *
 * 挂在简历中心顶部（不新增 Tab、不改页面的筛选/分页/批量选择）：
 *
 * - 每条带「外部」标签与一行说明，操作区**没有**「编辑 / 导出 / 制作台」，只有
 *   「预览原件 / 查看文本 / 文本检查 / 用于面试 / 删除」——用户不会点进去找编辑；
 * - 扫描件（没提取到文字）标「未提取到文字」，文本检查只说明"没有文字可查"，
 *   绝不显示"检查通过"；
 * - 删除是软删（进回收站），直接执行 + 5 秒撤销 Toast；**不删物理文件**。
 *
 * 组件只做呈现与交互编排：取数/上传/删除在 `useExternalResumes`，详情与文本检查在
 * `ExternalResumeDetailDrawer`，上传表单在 `ExternalResumeUploadModal`。
 */
import { UploadOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Listy, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { restoreTrashItem } from "../../api/trash";
import type { ExternalResumeItem } from "../../api/externalResumes";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { ListyItem, ListyMeta } from "../../components/common/ListyItem";
import { RowActions, type RowActionItem } from "../../components/common/RowActions";
import ExternalResumeDetailDrawer from "../../components/resumes/ExternalResumeDetailDrawer";
import type { ExternalResumeDetailTab } from "../../components/resumes/ExternalResumeDetailDrawer";
import ExternalResumeUploadModal from "../../components/resumes/ExternalResumeUploadModal";
import { useExternalResumes } from "../../features/external-resume/useExternalResumes";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";

interface DetailState {
  id: number;
  tab: ExternalResumeDetailTab;
}

interface Props {
  /**
   * `card`（默认）：自带标题 / 副标题 / 上传按钮的独立卡片，任何页面都能直接嵌。
   * `bare`：**不传 `title`**（因此没有 `.ant-card-head`，见清单 §1.9），标题由宿主页提供，
   * 卡片里只留"上传按钮 + 列表"。独立页（`/resumes/external`）用这一档。
   *
   * 默认值必须保持 `card`：将来若别处复用面板，默认值不能变成 `bare`，否则外观会被改掉。
   */
  variant?: "card" | "bare";
}

export default function ExternalResumePanel({ variant = "card" }: Props) {
  useLocale();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const toast = useToast();
  const { items, loading, error, reload, uploading, upload, remove } = useExternalResumes();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);

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

  const rowActions = (item: ExternalResumeItem): RowActionItem[] => [
    {
      key: "preview",
      label: t("resumesPage.external.preview"),
      onClick: () => openDetail(item, "original"),
    },
    {
      key: "interview",
      label: t("resumesPage.external.useForInterview"),
      onClick: () => handleUseForInterview(item),
    },
    {
      key: "text",
      label: t("resumesPage.external.viewText"),
      onClick: () => openDetail(item, "text"),
    },
    {
      key: "check",
      label: t("resumesPage.external.check"),
      onClick: () => openDetail(item, "check"),
    },
    {
      key: "delete",
      label: t("resumesPage.external.delete"),
      danger: true,
      // 软删：不弹确认，撤销入口在 Toast 上（见 handleDelete）。
      undo: true,
      onClick: () => void handleDelete(item),
    },
  ];

  const uploadButton = (
    <Button icon={<UploadOutlined />} loading={uploading} onClick={() => setUploadOpen(true)}>
      {t("resumesPage.external.upload")}
    </Button>
  );

  const body = () => {
    if (loading) return <LoadingBlock minHeight={96} />;
    if (error) return <ErrorState description={error} onRetry={() => void reload()} />;
    if (items.length === 0) {
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
    return (
      <Listy
        items={items}
        rowKey={(item) => item.id}
        itemRender={(item) => {
          // 同一份动作清单同时喂给行内按钮与「更多」菜单，避免两处漂移。
          const actions = rowActions(item);
          return (
            <ListyItem
              actions={[
                <RowActions key="actions" primary={actions.slice(0, 2)} more={actions.slice(2)} />,
              ]}
            >
              <ListyMeta
                title={
                  <Space size={8} wrap>
                    <Typography.Text strong>{item.name}</Typography.Text>
                    <Tag>{t("resumesPage.external.tag")}</Tag>
                    {item.has_text ? null : (
                      <Tag color="warning">{t("resumesPage.external.noText")}</Tag>
                    )}
                  </Space>
                }
                description={
                  <Space size={8} wrap>
                    <Typography.Text type="secondary">
                      {t("resumesPage.external.chars", { count: item.text_chars })}
                    </Typography.Text>
                    {item.job_id ? (
                      <Tag color="blue">
                        {t("resumesPage.external.jobTag", { job: item.job_title })}
                      </Tag>
                    ) : null}
                    <Typography.Text type="secondary">
                      {formatDateTime(item.created_at)}
                    </Typography.Text>
                  </Space>
                }
              />
            </ListyItem>
          );
        }}
      />
    );
  };

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

  // 独立页形态：没有 Card head（清单 §1.9 的硬约束），标题由宿主页渲染。
  if (variant === "bare") {
    return (
      <Card size="small">
        <Flex vertical gap={12}>
          {/* 卡片里唯一的写操作放右上角，与列表拉开 12px，不抢标题的层级。 */}
          <Flex justify="flex-end">{uploadButton}</Flex>
          {body()}
        </Flex>
        {modals}
      </Card>
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
      {body()}
      {modals}
    </Card>
  );
}
