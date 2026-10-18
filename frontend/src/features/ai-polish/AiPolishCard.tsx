/**
 * AI 润色的浮层卡片：显示选中的文字 → 拿要求 → 显示改写结果 → 由用户决定是否替换。
 *
 * 刻意不用 antd 的 Modal：它会把焦点搬进弹窗、把页面变暗，而这里要的是"贴着选区
 * 的一张小卡片"，且用户随时可能还要看一眼原文。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Input, Space, Typography } from "antd";
import { ApiError } from "../../api/client";
import { getLLMConfig } from "../../api/settings";
import { polishSelection } from "../../api/writing";
import { replaceSelection } from "./replaceSelection";
import type { SelectionTarget } from "./selectionTarget";

/** 与后端 `MAX_SELECTION_TEXT_CHARS` 同一口径：超过就不发请求，先说清楚为什么。 */
export const MAX_SELECTION_CHARS = 4000;
/** 与后端 `MAX_SELECTION_INSTRUCTION_CHARS` 同一口径。 */
export const MAX_INSTRUCTION_CHARS = 500;

export interface AiPolishCardProps {
  target: SelectionTarget;
  /** 卡片左上角（相对视口），由浮层按选区算出并已夹进可视区。 */
  left: number;
  top: number;
  onClose: () => void;
  /** 替换成功后由浮层收尾（关卡片、清选区）。 */
  onReplaced: () => void;
}

export default function AiPolishCard({
  target,
  left,
  top,
  onClose,
  onReplaced,
}: AiPolishCardProps) {
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<"compose" | "result">("compose");
  const [rewritten, setRewritten] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const tooLong = target.text.length > MAX_SELECTION_CHARS;

  // 卡片关掉（或页面切走）时中止在飞的请求：结果已经没人看了。
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const start = useCallback(async () => {
    if (busy || tooLong) return;
    setError(null);
    setModelMissing(false);
    setBusy(true);
    try {
      // 先确认模型配置：没配就没有可发的请求，直接告诉用户去哪儿配。
      const config = await getLLMConfig();
      if (!config.base_url || !config.model) {
        setModelMissing(true);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const data = await polishSelection(target.text, instruction.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setRewritten(data.result);
      setPhase("result");
    } catch (err) {
      if (err instanceof ApiError && err.code === "cancelled") return;
      setError(err instanceof Error && err.message ? err.message : "润色失败，请稍后重试");
      // 失败留在原状态：选区、要求、上一版结果都还在，用户可以直接重试。
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, instruction, target.text, tooLong]);

  const apply = useCallback(() => {
    const outcome = replaceSelection(target, rewritten);
    if (outcome.ok) {
      onReplaced();
      return;
    }
    setError(
      outcome.reason === "maxLength"
        ? "这个字段有字数上限，放不下这段改写。请缩短结果后再替换。"
        : "原来的输入框已经不在了（页面可能已切换），请重新选中文字。",
    );
  }, [onReplaced, rewritten, target]);

  // 卡片内除输入框与链接之外都拦掉 mousedown 的默认行为：点按钮不该把原文的选区清掉。
  const keepSelection = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const targetNode = event.target as HTMLElement | null;
    if (targetNode?.closest("textarea, input, a")) return;
    event.preventDefault();
  }, []);

  return (
    <div
      className="rf-ai-polish-card"
      role="dialog"
      aria-label="AI 润色"
      style={{ left, top }}
      onMouseDown={keepSelection}
    >
      <div className="rf-ai-polish-card-head">
        <Typography.Text strong>AI 润色</Typography.Text>
        <Typography.Text className="rf-ai-polish-privacy">
          只发送选中的这段文字，不发送整份简历
        </Typography.Text>
      </div>

      <Typography.Text className="rf-ai-polish-label">
        {phase === "result" ? "原文" : "选中的文字"}
      </Typography.Text>
      <div
        className={phase === "result" ? "rf-ai-polish-preview is-muted" : "rf-ai-polish-preview"}
      >
        {target.text}
      </div>

      {phase === "result" ? (
        <>
          <Typography.Text className="rf-ai-polish-label">改写结果（可以直接改）</Typography.Text>
          <Input.TextArea
            className="rf-ai-polish-result"
            aria-label="改写结果"
            value={rewritten}
            autoSize={{ minRows: 3, maxRows: 8 }}
            onChange={(event) => setRewritten(event.target.value)}
          />
        </>
      ) : (
        <>
          <Typography.Text className="rf-ai-polish-label">你的要求（可选）</Typography.Text>
          <Input.TextArea
            className="rf-ai-polish-instruction"
            aria-label="润色要求"
            value={instruction}
            maxLength={MAX_INSTRUCTION_CHARS}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="例如：更简洁、突出成果、改成 STAR 结构"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </>
      )}

      {tooLong && (
        <Alert
          type="warning"
          showIcon
          title={`选中的文字超过 ${MAX_SELECTION_CHARS} 字`}
          description="一次只润色一段：请缩小选中范围后再试。"
        />
      )}

      {modelMissing && (
        <Alert
          type="warning"
          showIcon
          title="还没有配置大模型"
          description={
            <span>
              润色需要调用大模型，
              <Link to="/settings">去设置配置模型</Link>
              后再回来试。
            </span>
          }
        />
      )}

      {error && <Alert type="error" showIcon title="润色没有完成" description={error} />}

      <div className="rf-ai-polish-actions">
        {phase === "result" ? (
          <Space size={8} wrap>
            <Button size="small" onClick={() => void start()} loading={busy}>
              重新改写
            </Button>
            <Button size="small" type="primary" onClick={apply} disabled={busy}>
              替换选中
            </Button>
            <Button size="small" type="text" onClick={onClose}>
              取消
            </Button>
          </Space>
        ) : (
          <Space size={8} wrap>
            <Button
              size="small"
              type="primary"
              onClick={() => void start()}
              loading={busy}
              disabled={tooLong}
            >
              开始改写
            </Button>
            <Button size="small" type="text" onClick={onClose}>
              取消
            </Button>
          </Space>
        )}
      </div>
    </div>
  );
}
