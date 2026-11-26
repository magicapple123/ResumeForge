// SPDX-License-Identifier: Apache-2.0
/**
 * 详情抽屉「编辑」页签（#5）：取块 → 选块 → 改字 → 应用 → 用服务端返回的文件刷新。
 *
 * ## 为什么"刷新"是从服务端重取，而不是前端合成预览
 *
 * 前端合成 = 第二套排版（断行、字距、行距、字体替换各写一遍），与后端产物必然不一致，
 * 用户看到的和下载到的就是两份东西。v1 直接把这次改字的结果当**唯一真相**：
 * 应用后重新拉 `blocks`（几何可能变了）并让外层记录换成服务端返回的 `resume`
 * （`file_id` 变了 → 原件预览的 URL 跟着变）。
 *
 * ## 能力探测失败怎么办
 *
 * 422 = 这份文件不能在线编辑（扫描件 / 转曲 / 加密 / 表单 / 旋转页）。这时不装作能改：
 * 把后端给的原因原样展示，并给「下载原件」+"用本地工具改完再上传"的引导。
 */
import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { ApiError } from "../../../api/client";
import {
  editExternalResumeBlock,
  externalResumeFileUrl,
  getExternalResumeBlocks,
} from "../../../api/externalResumes";
import type {
  ExternalResumeBlock,
  ExternalResumeBlocks,
  ExternalResumeDetail,
} from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { ExternalResumeEditor } from "./ExternalResumeEditor";
import { ExternalResumeEditorPanel } from "./ExternalResumeEditorPanel";
import type { ExternalResumeEditOutcome } from "./ExternalResumeEditorPanel";

export interface ExternalResumeEditTabProps {
  resumeId: number;
  /** 当前详情：`file_id` 一变（= 又存了一版），预览与字节都要跟着换。 */
  record: ExternalResumeDetail;
  /** 这次改字产生了新版本：外层用它替换详情（不动别的 tab 的状态）。 */
  onRecordChange: (next: ExternalResumeDetail) => void;
}

/** 加载失败要区分"不支持"与"没取到"：前者给下载引导，后者给重试。 */
interface LoadFailure {
  message: string;
  status: number | undefined;
}

/** 块的读法（与左侧热区的 aria-label 同一口径）。 */
function labelOf(blocks: readonly ExternalResumeBlock[], block: ExternalResumeBlock): string {
  const index = blocks.indexOf(block);
  return block.page > 0
    ? t("externalEdit.block.label", { page: block.page, index: index + 1 })
    : t("externalEdit.block.labelNoPage", { index: index + 1 });
}

export function ExternalResumeEditTab({ resumeId, record, onRecordChange }: ExternalResumeEditTabProps) {
  useLocale();
  const [blocks, setBlocks] = useState<ExternalResumeBlocks | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [outcome, setOutcome] = useState<ExternalResumeEditOutcome | null>(null);
  /** 每次应用成功 +1：既触发重新拉 blocks，也用来重建右侧表单（初值换成服务端的新文字）。 */
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getExternalResumeBlocks(resumeId)
      .then((next) => {
        if (cancelled) return;
        setBlocks(next);
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBlocks(null);
        setFailure({
          message: error instanceof Error ? error.message : t("externalEdit.blocksFailed"),
          status: error instanceof ApiError ? error.status : undefined,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, refreshToken]);

  /** 应用一次改字。`shiftBelow` 只在用户点「下移下方内容」时非 0。 */
  const apply = async (block: ExternalResumeBlock, text: string, shiftBelow = 0): Promise<void> => {
    setSubmitting(true);
    setApplyError("");
    try {
      const result = await editExternalResumeBlock(resumeId, {
        block_id: block.block_id,
        text,
        shift_below: shiftBelow,
      });
      setOutcome({
        deltaPt: result.delta_pt,
        overflow: result.overflow,
        scaled: result.scaled,
        shifted: result.shifted,
        linesBefore: result.lines_before,
        linesAfter: result.lines_after,
      });
      onRecordChange(result.resume);
      setRefreshToken((value) => value + 1);
    } catch (error: unknown) {
      setApplyError(error instanceof Error ? error.message : t("externalEdit.applyFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fileUrl = `${externalResumeFileUrl(record.id)}?v=${record.file_id}`;

  if (loading) return <LoadingBlock tip={t("externalEdit.blocksLoading")} />;

  if (failure !== null) {
    const unsupported = failure.status === 422;
    return (
      <Space orientation="vertical" size={12} style={{ width: "100%" }} data-testid="external-edit-failed">
        <Alert
          data-testid="external-unsupported"
          type={unsupported ? "warning" : "error"}
          showIcon
          title={unsupported ? t("externalEdit.unsupported.title") : t("externalEdit.blocksFailed")}
          description={failure.message}
          action={
            <Button
              size="small"
              icon={<DownloadOutlined />}
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("externalEdit.download")}
            </Button>
          }
        />
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {unsupported ? t("externalEdit.unsupported.hint") : t("externalEdit.blocksFailedHint")}
        </Typography.Paragraph>
        {unsupported ? null : (
          <Button size="small" onClick={() => setRefreshToken((value) => value + 1)}>
            {t("common.retry")}
          </Button>
        )}
      </Space>
    );
  }

  if (blocks === null) return <ErrorState description={t("externalEdit.blocksFailed")} />;

  const selected = blocks.blocks.find((block) => block.block_id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }} data-testid="external-edit-main">
        {blocks.warnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("externalEdit.blockWarnings")}
            description={blocks.warnings.join(" ")}
          />
        ) : null}
        {blocks.blocks.length === 0 ? (
          <Alert data-testid="external-blocks-empty" type="warning" showIcon title={t("externalEdit.blocksEmpty")} />
        ) : (
          <ExternalResumeEditor
            blocks={blocks}
            selectedId={selectedId}
            fileUrl={fileUrl}
            onSelect={(blockId) => {
              setSelectedId(blockId);
              setOutcome(null);
              setApplyError("");
            }}
          />
        )}
      </div>
      <div style={{ flex: "0 1 300px", minWidth: 260 }} data-testid="external-edit-side">
        <ExternalResumeEditorPanel
          key={`${selectedId ?? "none"}-${refreshToken}`}
          block={selected}
          blockLabel={selected === null ? "" : labelOf(blocks.blocks, selected)}
          submitting={submitting}
          outcome={outcome}
          error={applyError}
          onApply={(text) => {
            if (selected !== null) void apply(selected, text);
          }}
          onShiftBelow={(delta) => {
            if (selected !== null) void apply(selected, selected.text, delta);
          }}
        />
      </div>
    </div>
  );
}

export default ExternalResumeEditTab;
