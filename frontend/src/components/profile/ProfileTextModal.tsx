// SPDX-License-Identifier: Apache-2.0
/**
 * 粘贴整段个人资料（或资料截图、简历文档）并结构化识别的弹窗。
 *
 * 两个阶段（项 13 / D23）：
 * 1. **输入**：粘贴 / 拖文件 / 截图 → 「识别并填入」；识别过程中主按钮变成
 *    「取消识别」（不是一直转圈的 loading 按钮——用户想反悔时得有个能点的东西）。
 * 2. **校对**：识别成功后**弹窗不关**，结果变成一张可编辑的清单；用户看过、改过、点
 *    「确认填入 N 项」才写进表单。识别是猜、改资料是写，两件事不该由一个按钮完成。
 *
 * `rows !== null` 即进入校对阶段——**不另立 step 状态**：两处状态（step + rows）能不一致，
 * 而它们本来描述的是同一件事。
 */

import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Progress, Space, Spin, Typography } from "antd";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { StagedFile } from "../../hooks/useRecognitionFiles";
import { MaxLengthHint } from "../common/MaxLengthHint";
import RecognitionFileField from "../RecognitionFileField";
import RecognitionOutcome from "../RecognitionOutcome";
import RecognitionReviewList from "./RecognitionReviewList";
import type { RecognitionReviewRow } from "./RecognitionReviewList";
import type { RecognitionSource } from "../../types";

/** 上传阶段在整条进度里占的比例：0-15%，剩下的时间都在解析。 */
const UPLOAD_SHARE_PERCENT = 15;

/** 两种宿主：资料页（本轮）与网申资料（下一轮接链路，本轮只有文案）。 */
export type ProfileTextMode = "profile" | "webform";

const COPY: Record<
  ProfileTextMode,
  { titleKey: MessageKey; placeholderKey: MessageKey; introKey: MessageKey }
> = {
  profile: {
    titleKey: "profileTextModal.profile.title",
    placeholderKey: "profileTextModal.profile.placeholder",
    introKey: "profileTextModal.profile.intro",
  },
  webform: {
    titleKey: "profileTextModal.webform.title",
    placeholderKey: "profileTextModal.webform.placeholder",
    introKey: "profileTextModal.webform.intro",
  },
};

interface Props {
  open: boolean;
  text: string;
  warnings: string[];
  parsing: boolean;
  /**
   * 附件上传进度（0-100）；null 表示不在上传中。
   *
   * **100 表示字节已经发完**，服务端此时才开始解析、调模型——那一段耗时不可预估，
   * 所以到 100 就切成不确定态（转圈），不再显示百分比。
   */
  uploadPercent: number | null;
  recognizedText: string;
  /** 这次识别是 AI 还是本地规则；还没识别过时为 null。 */
  recognitionSource: RecognitionSource | null;
  files: StagedFile[];
  filesReading: boolean;
  /** 宿主形态：决定标题 / 说明 / 占位文案。默认资料页。 */
  mode?: ProfileTextMode;
  /** 非 null 即进入校对阶段（内容就是识别结果的行）。 */
  rows?: RecognitionReviewRow[] | null;
  onRowsChange?: (rows: RecognitionReviewRow[]) => void;
  /** 「确认填入」：把校对后的清单写进表单。 */
  onApply?: () => void;
  /** 「取消」：放弃这次识别结果，不写表单。 */
  onDiscard?: () => void;
  /** 识别中「取消识别」：中止请求。 */
  onCancelParse?: () => void;
  onTextChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: number) => void;
  onPasteFiles: (event: React.ClipboardEvent<HTMLElement>) => void;
  onClose: () => void;
  onParse: () => void;
}

export default function ProfileTextModal({
  open,
  text,
  warnings,
  parsing,
  uploadPercent,
  recognizedText,
  recognitionSource,
  files,
  filesReading,
  mode = "profile",
  rows = null,
  onRowsChange,
  onApply,
  onDiscard,
  onCancelParse,
  onTextChange,
  onAddFiles,
  onRemoveFile,
  onPasteFiles,
  onClose,
  onParse,
}: Props) {
  useLocale();
  const reviewing = rows !== null;
  const copy = COPY[mode];
  // 新字段只有在勾选后才计入"将写入 N 项"，所以这个数字就是用户眼前真正会发生的变化量。
  const confirmCount = rows ? rows.filter((row) => !row.isNew || row.selected).length : 0;
  // 关闭（X / ESC）在校对阶段等价于"放弃这次结果"，不能静默留下半份草稿。
  const handleCancel = reviewing ? (onDiscard ?? onClose) : onClose;

  return (
    <Modal
      title={t(copy.titleKey)}
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width={760}
      footer={
        reviewing
          ? [
              <Button key="discard" onClick={onDiscard}>
                {t("profileTextModal.action.cancel")}
              </Button>,
              <Button key="apply" type="primary" disabled={confirmCount === 0} onClick={onApply}>
                {t("profileTextModal.action.apply", { count: confirmCount })}
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose} disabled={parsing}>
                {t("profileTextModal.action.close")}
              </Button>,
              parsing ? (
                // 识别中不再给一个"转圈到结束"的 loading 按钮：用户唯一想做的事是取消。
                <Button key="cancel-parse" danger onClick={onCancelParse}>
                  {t("profileTextModal.action.cancelRecognize")}
                </Button>
              ) : (
                <Button key="parse" type="primary" icon={<FileSearchOutlined />} onClick={onParse}>
                  {t("profileTextModal.action.recognize")}
                </Button>
              ),
            ]
      }
      styles={{ body: { paddingRight: 8 } }}
    >
      {reviewing ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("profileTextModal.review.count", { count: rows.length })}
            description={t("profileTextModal.review.hint")}
          />
          {warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={warnings.join(t("profileTextModal.separator.warning"))}
            />
          )}
          <RecognitionReviewList rows={rows} onChange={onRowsChange ?? (() => undefined)} />
          <RecognitionOutcome source={recognitionSource} text={recognizedText} />
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary">{t(copy.introKey)}</Typography.Paragraph>
          <Input.TextArea
            aria-label={t("profileTextModal.input.textAria")}
            value={text}
            disabled={parsing}
            onPaste={onPasteFiles}
            onChange={(event) => onTextChange(event.target.value)}
            maxLength={100_000}
            placeholder={t(copy.placeholderKey)}
            autoSize={{ minRows: 14, maxRows: 24 }}
          />
          <MaxLengthHint value={text} maxLength={100_000} />
          {/* 文件暂存区紧跟输入框下缘，补 12px 呼吸空隙，避免「添加截图或文档」按钮贴住边框。 */}
          <div style={{ marginTop: 12 }}>
            <RecognitionFileField
              files={files}
              reading={filesReading}
              disabled={parsing}
              onAddFiles={onAddFiles}
              onRemove={onRemoveFile}
            />
          </div>
          <RecognitionOutcome source={recognitionSource} text={recognizedText} />
          {uploadPercent !== null && uploadPercent < 100 && (
            // 上传阶段只占整个等待的一小段：真实字节映射到 0-15%，避免大文件一上传完
            // 进度条就画满、而用户还要再等十几秒解析。
            <Progress
              aria-label={t("profileTextModal.upload.progressAria")}
              percent={Math.round((uploadPercent / 100) * UPLOAD_SHARE_PERCENT)}
              size="small"
              status="active"
              style={{ marginTop: 12 }}
            />
          )}
          {uploadPercent !== null && uploadPercent >= 100 && parsing && (
            // 解析阶段不显示百分比：服务端要抽文本、可能还要调模型，耗时不可预估。
            // 用不确定态 + 一句说明，比一个停在 15% 的假进度条诚实。
            <Space size={8} style={{ marginTop: 12 }}>
              <Spin size="small" />
              <Typography.Text type="secondary">
                {t("profileTextModal.upload.parsing")}
              </Typography.Text>
            </Space>
          )}
          {warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              title={warnings.join(t("profileTextModal.separator.warning"))}
            />
          )}
        </>
      )}
    </Modal>
  );
}
