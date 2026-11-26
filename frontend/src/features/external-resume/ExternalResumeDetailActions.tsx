// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历详情里的「P0 四项」动作条（T28）：收藏 / 备注 / 重命名 / 导出原件。
 *
 * 为什么单独一个组件而不是塞进 `ExternalResumeDetailDrawer`：
 *
 * 1. 抽屉已经 470+ 行（Modal 骨架 + 五个页签 + 缓存），再进去一百多行必然破 500；
 * 2. 这四项都是**行级动作**（只改这一行，不碰文件与正文），与"取详情 / 跑检查 / 画预览"
 *    是两件事，混在一起会让抽屉的读写边界变模糊。
 *
 * ## 收藏：与内部简历同一口径
 *
 * 收藏是**标记**不是编辑。服务端走 `services/favorites.update_favorite`（Core UPDATE +
 * 把 `updated_at` 列自身写回 SET 子句，抑制 `onupdate`），所以收藏后按「最近更新」排序
 * 那一行**不会**跳到最前面（R2）。这里只调接口、回传最新详情，绝不在本地改字段——
 * 本地改了列表那一份仍是旧的，用户会看到"详情已收藏、列表还是空星"。
 *
 * ## 备注：空备注不占位
 *
 * 没写备注时**不渲染**备注行（验收项 2），只留「添加备注」按钮；写了才显示一行，
 * 完整内容在弹窗里改（`TextArea`，上限与服务端同为 2000 字）。
 *
 * ## 重命名：先本地校验，再交给服务端
 *
 * 空名 / 超长在弹窗里就拦住（服务端同样会 422，两处判据一致，界面上不必等一个来回）。
 * 成功后把新详情回传给抽屉：抽屉更新缓存 + `onChanged()` 打脏列表，文件名立刻变。
 *
 * ## 导出原件：字节与扩展名都是原样
 *
 * 走 `externalResumeFileUrl(id, revisionId, true)`：后端只把 `Content-Disposition` 换成
 * `attachment`，文件名取上传时的原始名、内容不重编码。**在历史版本里点它导的是那一版**
 * （`revisionId` 由抽屉传下来），所以"看哪一版就能导出哪一版"。
 */
import { DownloadOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Space, Typography } from "antd";
import { useCallback, useState } from "react";
import {
  externalResumeFileUrl,
  setExternalResumeFavorite,
  setExternalResumeNote,
  updateExternalResume,
} from "../../api/externalResumes";
import type { ExternalResumeDetail } from "../../api/externalResumes";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import "./externalResumeActions.css";

/** 文件名上限（与后端 `MAX_NAME_CHARS` / `external_resume.name` 列宽一致）。 */
export const MAX_EXTERNAL_NAME_CHARS = 256;
/** 备注上限（与后端 `MAX_EXTERNAL_NOTE_CHARS` 一致）。 */
export const MAX_EXTERNAL_NOTE_CHARS = 2000;

export interface ExternalResumeDetailActionsProps {
  record: ExternalResumeDetail;
  /** 写操作成功后回传最新详情；抽屉据此更新缓存并 `onChanged()` 刷新列表。 */
  onRecordChange: (next: ExternalResumeDetail) => void;
  /** 正在看的历史版本号：给了它，「导出原件」导的是那一版。 */
  revisionId?: number;
}

export function ExternalResumeDetailActions({
  record,
  onRecordChange,
  revisionId,
}: ExternalResumeDetailActionsProps) {
  useLocale();
  const toast = useToast();
  // 收藏 / 备注是后加的字段（见 `ExternalResumeItem` 的注释），读侧统一归一，
  // 免得局部 DTO 缺字段时渲染出 `undefined`。
  const favorite = Boolean(record.favorite);
  const note = record.note ?? "";
  /** 收藏在飞行中：连点两次不该发两个方向相反的请求。 */
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const toggleFavorite = useCallback(() => {
    setFavoriteBusy(true);
    void setExternalResumeFavorite(record.id, !favorite)
      .then((next) => onRecordChange(next))
      .catch(() => toast.error(t("resumesPage.external.favoriteFailed")))
      .finally(() => setFavoriteBusy(false));
  }, [record.id, favorite, onRecordChange, toast]);

  const openNote = useCallback(() => {
    setNoteDraft(note);
    setNoteOpen(true);
  }, [note]);

  const saveNote = useCallback(() => {
    setNoteBusy(true);
    void setExternalResumeNote(record.id, noteDraft)
      .then((next) => {
        onRecordChange(next);
        setNoteOpen(false);
        toast.success(t("resumesPage.external.note.saved"));
      })
      .catch(() => toast.error(t("resumesPage.external.note.failed")))
      .finally(() => setNoteBusy(false));
  }, [record.id, noteDraft, onRecordChange, toast]);

  const openRename = useCallback(() => {
    setRenameDraft(record.name);
    setRenameError("");
    setRenameOpen(true);
  }, [record.name]);

  /** 本地校验与服务端同判据：去掉首尾空白后不能为空，且不超过列宽。 */
  const submitRename = useCallback(() => {
    const next = renameDraft.trim();
    if (!next) {
      setRenameError(t("resumesPage.external.rename.empty"));
      return;
    }
    if (next.length > MAX_EXTERNAL_NAME_CHARS) {
      setRenameError(t("resumesPage.external.rename.tooLong", { max: MAX_EXTERNAL_NAME_CHARS }));
      return;
    }
    setRenameBusy(true);
    void updateExternalResume(record.id, { name: next })
      .then((updated) => {
        onRecordChange(updated);
        setRenameOpen(false);
        toast.success(t("resumesPage.external.rename.done", { name: updated.name }));
      })
      .catch(() => setRenameError(t("resumesPage.external.rename.failed")))
      .finally(() => setRenameBusy(false));
  }, [record.id, renameDraft, onRecordChange, toast]);

  return (
    <div className="rf-ext-actions">
      <Space size={8} wrap>
        <Button
          size="small"
          data-testid="external-favorite-toggle"
          aria-pressed={favorite}
          loading={favoriteBusy}
          icon={favorite ? <StarFilled /> : <StarOutlined />}
          onClick={toggleFavorite}
        >
          {favorite ? t("resumesPage.external.unfavorite") : t("resumesPage.external.favorite")}
        </Button>
        <Button size="small" data-testid="external-note-open" onClick={openNote}>
          {note ? t("resumesPage.external.note.edit") : t("resumesPage.external.note.add")}
        </Button>
        <Button size="small" data-testid="external-rename-open" onClick={openRename}>
          {t("resumesPage.external.rename.action")}
        </Button>
        {/* 导出原件：同一个 `/file` 端点，只是 `download=true`（attachment + 原始文件名）。 */}
        <Button
          size="small"
          data-testid="external-export-original"
          icon={<DownloadOutlined />}
          href={externalResumeFileUrl(record.id, revisionId, true)}
          download
        >
          {t("resumesPage.external.exportOriginal")}
        </Button>
      </Space>
      {/* 备注：没有就整行不渲染（空行等于多一个"这里什么都没有"的视觉噪音）。 */}
      {note ? (
        <Typography.Paragraph
          type="secondary"
          className="rf-ext-note"
          data-testid="external-note-view"
          ellipsis={{ rows: 2, tooltip: note }}
        >
          {t("resumesPage.external.note.display", { note })}
        </Typography.Paragraph>
      ) : null}

      <Modal
        open={noteOpen}
        title={t("resumesPage.external.note.label")}
        okText={t("common.action.save")}
        cancelText={t("common.action.cancel")}
        confirmLoading={noteBusy}
        onOk={saveNote}
        onCancel={() => setNoteOpen(false)}
        okButtonProps={{ "data-testid": "external-note-save" }}
        destroyOnHidden
      >
        <Input.TextArea
          data-testid="external-note-input"
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder={t("resumesPage.external.note.placeholder")}
          maxLength={MAX_EXTERNAL_NOTE_CHARS}
          showCount
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      </Modal>

      <Modal
        open={renameOpen}
        title={t("resumesPage.external.rename.title")}
        okText={t("common.action.save")}
        cancelText={t("common.action.cancel")}
        confirmLoading={renameBusy}
        onOk={submitRename}
        onCancel={() => setRenameOpen(false)}
        okButtonProps={{ "data-testid": "external-rename-save" }}
        destroyOnHidden
      >
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {t("resumesPage.external.rename.label")}
          </Typography.Text>
          <Input
            data-testid="external-rename-input"
            value={renameDraft}
            status={renameError ? "error" : undefined}
            maxLength={MAX_EXTERNAL_NAME_CHARS}
            onChange={(event) => {
              setRenameDraft(event.target.value);
              setRenameError("");
            }}
            onPressEnter={submitRename}
          />
          {renameError ? (
            <Typography.Text type="danger" data-testid="external-rename-error">
              {renameError}
            </Typography.Text>
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}

export default ExternalResumeDetailActions;
