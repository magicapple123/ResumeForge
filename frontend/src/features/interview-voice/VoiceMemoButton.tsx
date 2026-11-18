// SPDX-License-Identifier: Apache-2.0
/**
 * 「语音记一条」（T09）：简历编辑器里的**全局**入口，不是某个字段的按钮。
 *
 * 点一下开始录音（再点一下结束）→ 走现有 `POST /api/transcribe` → 走现有
 * `POST /api/profile/parse-text` 抽取 → 弹窗里逐字段校对 → 插入为可编辑条目。
 *
 * 三个刻意的选择：
 *
 * 1. **不另写解析**：抽取一律交给既有接口（模型优先、本地规则兜底），本组件只负责
 *    "把草稿折成条目提案"（`voiceMemoDraft`，纯函数）与写回文档（`addEntry` 等既有 mutation）。
 * 2. **上限按服务端说的来**：`/transcribe/status` 的 `max_seconds` 是唯一口径。选到
 *    DeepSeek（不支持流式）时它是 120 秒，界面**用一句话解释原因**——静默把滑块砍掉
 *    会让用户以为录音坏了。
 * 3. **插入前给一次校对**：语音识别必然有错字，直接写进简历比让用户多点一次更糟。
 */
import { AudioOutlined, StopOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { parseProfileText } from "../../api/profile";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import { buildFallbackCatalog } from "../resume/document/fieldCatalog";
import { getTranscribeStatus, type TranscribeStatus } from "./asrApi";
import { formatVoiceSeconds } from "./voiceFormat";
import { useVoiceMemoCapture } from "./voiceMemoCapture";
import {
  applyMemoProposals,
  memoProposals,
  type MemoDraftSection,
  type MemoProposal,
} from "./voiceMemoDraft";
import "./voice-memo.css";

/** 单段上限的兜底值：拿不到 `/transcribe/status` 时按最保守的那个（= DeepSeek 的硬上限）。 */
const FALLBACK_MAX_SECONDS = 120;

/**
 * `/profile/parse-text` 的响应形状：旧字段之外**追加**了 `sections`（新目录草稿）。
 * 与 `useProfileRecognition` 一样在本地补这个类型——api 层的公共类型不带它，
 * 改公共类型会波及所有消费者。
 */
type ParseDraftResult = { sections?: MemoDraftSection[] };

export interface VoiceMemoButtonProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  /** 字段目录（宿主已有一份）；缺省时用语言包构造的兜底目录，不会凭空编字段。 */
  catalog?: DocumentFieldCatalog | null;
  /** 只读预览里不出现这个入口。 */
  readOnly?: boolean;
  /**
   * 插入成功后回调新条目路径（`<sectionKey>.<entryId>`）。
   *
   * I-20：宿主接上 `DocumentEditor.select` 那条链路，插入后自动定位到新条目；
   * 组件本身**不做滚动**（它拿不到中栏的滚动容器）。
   */
  onInserted?: (paths: string[]) => void;
}

export function VoiceMemoButton({
  document,
  onChange,
  catalog = null,
  readOnly = false,
  onInserted,
}: VoiceMemoButtonProps) {
  useLocale();
  const { message } = App.useApp();
  const [status, setStatus] = useState<TranscribeStatus | null>(null);
  const [proposals, setProposals] = useState<MemoProposal[] | null>(null);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getTranscribeStatus();
        if (!cancelled) setStatus(snapshot);
      } catch {
        // 探测失败不拦着用户尝试：转写接口会用准确的中文原因再报一次。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogOf = catalog ?? buildFallbackCatalog(t);
  const maxSeconds = status?.max_seconds ?? FALLBACK_MAX_SECONDS;
  const host = status?.provider_host ?? "";

  const extract = async (text: string) => {
    setParsing(true);
    try {
      const parsed = (await parseProfileText({ text })) as ParseDraftResult;
      const memo = memoProposals(parsed.sections ?? [], catalogOf);
      if (memo.proposals.length === 0) {
        message.info(
          memo.skippedSections > 0 ? t("voiceMemo.toast.basicOnly") : t("voiceMemo.toast.nothing"),
        );
        return;
      }
      setProposals(memo.proposals);
    } catch (error) {
      message.error(
        error instanceof Error && error.message ? error.message : t("voiceMemo.error.parse"),
      );
    } finally {
      setParsing(false);
    }
  };

  const voice = useVoiceMemoCapture({ maxSeconds, onTranscribed: (text) => void extract(text) });
  const recording = voice.status === "recording";
  const transcribing = voice.status === "transcribing" || parsing;

  const apply = () => {
    if (!proposals || proposals.length === 0) {
      setProposals(null);
      return;
    }
    const result = applyMemoProposals(document, proposals, catalogOf);
    if (result.inserted > 0) onChange(result.document);
    if (result.inserted > 0) {
      message.success(t("voiceMemo.toast.inserted", { count: result.inserted }));
      // 只在真的插进去时跳转：`insertedPaths` 已排除被去重/丢弃的条目。
      onInserted?.(result.insertedPaths);
    }
    if (result.duplicates > 0) {
      message.info(t("voiceMemo.toast.covered", { count: result.duplicates }));
    }
    if (result.inserted === 0 && result.duplicates === 0) {
      message.info(t("voiceMemo.toast.nothing"));
    }
    setProposals(null);
  };

  /** 校对弹窗里改一个字段的值（键是文档字段 key）。 */
  const editValue = (proposalIndex: number, fieldKey: string, value: string) => {
    setProposals((current) => {
      if (!current) return current;
      const next = current.slice();
      next[proposalIndex] = {
        ...next[proposalIndex],
        values: { ...next[proposalIndex].values, [fieldKey]: value },
      };
      return next;
    });
  };

  /**
   * I-18：tooltip **第一行写用途、第二行写限制**。
   *
   * 缺陷原形：唯一的用途说明只在 `aria-label` 里，视觉用户悬停后只看到"单段最长 180 秒"
   * ——那是限制，不是这件东西是干什么的。顺序不能反：限制一占首行，用户又只会看到它。
   */
  const tooltip = (
    <span className="voice-memo-tooltip">
      <span>{t("voiceMemo.hint.purpose")}</span>
      <span className="voice-memo-tooltip-limit">
        {t("voiceMemo.hint.limit", { seconds: maxSeconds })}
      </span>
    </span>
  );

  const control = recording ? (
    <button
      type="button"
      className="voice-memo-recording"
      aria-label={t("voiceMemo.status.recording")}
      title={t("voiceMemo.status.recording")}
      onClick={voice.stop}
    >
      <span className="voice-memo-dot" aria-hidden="true" />
      <span className="voice-memo-time">{formatVoiceSeconds(voice.seconds)}</span>
      <StopOutlined aria-hidden="true" />
    </button>
  ) : (
    <Tooltip
      title={tooltip}
      classNames={{ root: "voice-memo-tooltip-root" }}
      styles={{ root: { maxWidth: 320 } }}
    >
      <Button
        size="small"
        icon={<AudioOutlined />}
        loading={transcribing || undefined}
        aria-label={t("voiceMemo.buttonAria")}
        onClick={() => {
          voice.clearError();
          voice.start();
        }}
      >
        {t("voiceMemo.button")}
      </Button>
    </Tooltip>
  );

  // I-19：只读预览里**不渲染**这个入口（置灰的录音键仍然占位，也仍然在问"为什么点不了"）。
  if (readOnly) return null;

  return (
    <span className="voice-memo">
      {control}
      {/*
        提示行三选一：错误 → 转写中的说明 → 录音中的隐私告知。
        120 秒那句解释只在**真的**被服务端限住时出现，避免每台机器上都念一遍。
      */}
      {voice.error ? (
        <Typography.Text type="danger" className="voice-memo-hint">
          {voice.error.message}
        </Typography.Text>
      ) : recording && host ? (
        <Typography.Text type="secondary" className="voice-memo-hint">
          {t("voiceMemo.hint.privacy", { host })}
        </Typography.Text>
      ) : status && status.max_seconds < 180 ? (
        <Typography.Text type="secondary" className="voice-memo-hint">
          {t("voiceMemo.hint.streamLimited", { seconds: status.max_seconds })}
        </Typography.Text>
      ) : null}

      <Modal
        open={proposals !== null}
        title={t("voiceMemo.modal.title")}
        okText={t("voiceMemo.modal.apply")}
        cancelText={t("common.action.cancel")}
        onOk={apply}
        onCancel={() => setProposals(null)}
        // 有写入动作的弹层：禁掉蒙层关闭（误点会把刚校对完的内容丢掉）。
        mask={{ closable: false }}
        width={560}
      >
        <Typography.Paragraph type="secondary">{t("voiceMemo.modal.hint")}</Typography.Paragraph>
        {(proposals ?? []).map((proposal, proposalIndex) => (
          <div className="voice-memo-entry" key={`${proposal.sectionKey}-${proposalIndex}`}>
            <div className="voice-memo-entry-title">{proposal.sectionTitle}</div>
            {Object.entries(proposal.values).map(([fieldKey, value]) => (
              <label className="voice-memo-field" key={fieldKey}>
                <span className="voice-memo-field-label">
                  {proposal.labels[fieldKey] ?? fieldKey}
                </span>
                <Input.TextArea
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  value={value}
                  onChange={(event) => editValue(proposalIndex, fieldKey, event.target.value)}
                />
              </label>
            ))}
          </div>
        ))}
      </Modal>
    </span>
  );
}

export default VoiceMemoButton;
