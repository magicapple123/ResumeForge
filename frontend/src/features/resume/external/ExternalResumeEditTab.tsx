// SPDX-License-Identifier: Apache-2.0
/**
 * 详情弹层「编辑」页签（R9-5 / R11）：取块 → 左栏选段 → 右栏改字 → 应用 → 出成功条。
 *
 * ## 版面：左清单 / 右表单，PDF 只在「原件」页
 *
 * 旧版左栏是"PDF 上盖热区"，字小、还被色块压住。现在左栏是段落清单（序号 / 摘要 /
 * 页内位置 / 标题·正文·锁定），右栏是灰底原文 + 新文输入；PDF 画布只留在「原件」页签。
 *
 * ## 为什么"刷新"是从服务端重取，而不是前端合成预览
 *
 * 前端合成 = 第二套排版（断行、字距、行距、字体替换各写一遍），与后端产物必然不一致，
 * 用户看到的和下载到的就是两份东西。应用后重新拉 `blocks`（几何可能变了），并让外层
 * 记录换成服务端返回的 `resume`（`file_id` 变了 → 原件页的 URL 跟着变）。
 *
 * ## 成功条（R11）
 *
 * 「改完看不到结果」的原因是：改完之后没有任何入口指向新版本。所以应用成功后在右栏下方
 * 出一条成功条：版本号 + 字数 + 两个入口（查看修改后的原件 / 查看文本），两个入口都
 * 由外层切页签，进去看到的就是刚存下的那一版。
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
  listExternalResumeRevisions,
} from "../../../api/externalResumes";
import type {
  ExternalResumeBlock,
  ExternalResumeBlocks,
  ExternalResumeDetail,
} from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { ExternalBlockPreview } from "./ExternalBlockPreview";
import { ExternalResumeEditor } from "./ExternalResumeEditor";
import { ExternalResumeEditorPanel } from "./ExternalResumeEditorPanel";
import type { ExternalResumeEditOutcome } from "./ExternalResumeEditorPanel";
import "./externalPreview.css";
import "./externalEditLayout.css";

export interface ExternalResumeEditTabProps {
  resumeId: number;
  /** 当前详情：`file_id` 一变（= 又存了一版），预览与字节都要跟着换。 */
  record: ExternalResumeDetail;
  /** 这次改字产生了新版本：外层用它替换详情（不动别的 tab 的状态）。 */
  onRecordChange: (next: ExternalResumeDetail) => void;
  /** 成功条上的两个入口：切到「原件」/「文本」页签并看到新内容（由外层实现）。 */
  onGotoTab?: (tab: "original" | "text") => void;
}

/** 成功条里的那点信息：第几版（拿不到时留空）+ 当前总字数。 */
interface ApplySuccess {
  version: number | null;
  chars: number;
}

/** 加载失败要分三种：不支持（422）、原件文件没了（404）、临时读不到（其它状态 / 网络）。 */
interface LoadFailure {
  message: string;
  status: number | undefined;
}

type LoadFailureKind = "unsupported" | "missing" | "transient";

function failureKindOf(status: number | undefined): LoadFailureKind {
  if (status === 422) return "unsupported";
  if (status === 404) return "missing";
  return "transient";
}

/** 标题文案：三种失败各一句，不共用一句"没能读到"。 */
function failureTitleKey(kind: LoadFailureKind): MessageKey {
  if (kind === "unsupported") return "externalEdit.unsupported.title";
  if (kind === "missing") return "externalEdit.blocksMissingTitle";
  return "externalEdit.blocksFailed";
}

/** 下方说明：只有 `transient` 才允许说"原件不受影响"。 */
function failureHintKey(kind: LoadFailureKind): MessageKey {
  if (kind === "unsupported") return "externalEdit.unsupported.hint";
  if (kind === "missing") return "externalEdit.blocksMissingHint";
  return "externalEdit.blocksFailedHint";
}

/** 块的读法（与左栏清单同一口径）。 */
function labelOf(blocks: readonly ExternalResumeBlock[], block: ExternalResumeBlock): string {
  const index = blocks.indexOf(block);
  return block.page > 0
    ? t("externalEdit.block.label", { page: block.page, index: index + 1 })
    : t("externalEdit.block.labelNoPage", { index: index + 1 });
}

export function ExternalResumeEditTab({
  resumeId,
  record,
  onRecordChange,
  onGotoTab,
}: ExternalResumeEditTabProps) {
  useLocale();
  const [blocks, setBlocks] = useState<ExternalResumeBlocks | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [outcome, setOutcome] = useState<ExternalResumeEditOutcome | null>(null);
  const [success, setSuccess] = useState<ApplySuccess | null>(null);
  /** 每次应用成功 +1：既触发重新拉 blocks，也用来重建右栏表单（初值换成服务端的新文字）。 */
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
      // 先出条（版本号未知就先不写第几版），拿到版本总数后再补上「第 N 版」。
      setSuccess({ version: null, chars: result.resume.text_chars });
      void listExternalResumeRevisions(resumeId)
        .then((list) => {
          setSuccess((current) =>
            current === null ? current : { ...current, version: list.total },
          );
        })
        .catch(() => {
          // 版本号只是锦上添花：拿不到就沿用「已生成新版本」那句，不影响去哪看结果。
        });
    } catch (error: unknown) {
      setApplyError(error instanceof Error ? error.message : t("externalEdit.applyFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fileUrl = `${externalResumeFileUrl(record.id)}?v=${record.file_id}`;

  if (loading) return <LoadingBlock tip={t("externalEdit.blocksLoading")} />;

  if (failure !== null) {
    const kind = failureKindOf(failure.status);
    return (
      <Space
        orientation="vertical"
        size={12}
        style={{ width: "100%" }}
        data-testid="external-edit-failed"
      >
        <Alert
          data-testid={`external-edit-failure-${kind}`}
          type={kind === "unsupported" ? "warning" : "error"}
          showIcon
          title={t(failureTitleKey(kind))}
          description={failure.message}
          action={
            // 原件已不在本机时，「下载原件」也会 404：不给一个必然失败的按钮。
            kind === "missing" ? null : (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("externalEdit.download")}
              </Button>
            )
          }
        />
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {t(failureHintKey(kind))}
        </Typography.Paragraph>
        {kind === "transient" ? (
          <Button
            size="small"
            data-testid="external-retry"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            {t("common.retry")}
          </Button>
        ) : null}
      </Space>
    );
  }

  if (blocks === null) return <ErrorState description={t("externalEdit.blocksFailed")} />;

  const selected = blocks.blocks.find((block) => block.block_id === selectedId) ?? null;

  return (
    <div className="rf-ext-edit">
      {/* 第一栏：选中那一段所在的页（只读、不可点，选块仍只在清单里进行）。 */}
      <div className="rf-ext-edit-origin" data-testid="external-edit-origin">
        <Typography.Text strong className="rf-ext-edit-origin-title">
          {t("externalEdit.blockPreview.title")}
        </Typography.Text>
        <div className="rf-ext-edit-origin-body">
          <ExternalBlockPreview
            record={record}
            block={selected}
            pageWidth={blocks.page_width}
            pageHeight={blocks.page_height}
          />
        </div>
      </div>
      <div className="rf-ext-edit-blocks">
        {blocks.warnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("externalEdit.blockWarnings")}
            description={blocks.warnings.join(" ")}
          />
        ) : null}
        <ExternalResumeEditor
          blocks={blocks}
          selectedId={selectedId}
          onSelect={(blockId) => {
            setSelectedId(blockId);
            setOutcome(null);
            setApplyError("");
          }}
        />
      </div>
      <div className="rf-ext-edit-panel">
        {/* 表单自己滚，成功条钉在右下角：改完"怎么去看结果"永远看得见（R11）。 */}
        <div className="rf-ext-edit-form">
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
        {success === null ? null : (
          <div className="rf-ext-success" data-testid="external-apply-success">
            <Typography.Text strong>
              {success.version === null
                ? t("externalEdit.success.titleNoVersion", { chars: success.chars })
                : t("externalEdit.success.title", {
                    version: success.version,
                    chars: success.chars,
                  })}
            </Typography.Text>
            <Typography.Text type="secondary">{t("externalEdit.success.hint")}</Typography.Text>
            <Space size={8} wrap>
              <Button
                size="small"
                data-testid="external-success-original"
                onClick={() => onGotoTab?.("original")}
              >
                {t("externalEdit.success.viewOriginal")}
              </Button>
              <Button
                size="small"
                data-testid="external-success-text"
                onClick={() => onGotoTab?.("text")}
              >
                {t("externalEdit.success.viewText")}
              </Button>
            </Space>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExternalResumeEditTab;
