// SPDX-License-Identifier: Apache-2.0
/**
 * AI 润色的浮层卡片：显示选中的文字 → 拿要求 → 显示改写结果 → 由用户决定是否替换。
 *
 * 刻意不用 antd 的 Modal：它会把焦点搬进弹窗、把页面变暗，而这里要的是"贴着选区
 * 的一张小卡片"，且用户随时可能还要看一眼原文。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
/**
 * 「待改写内容超过上限」那条提示的 id。
 *
 * 超长时「继续改写」不可用、输入框也会被禁用——读屏用户听到的只有"不可用"，听不到
 * 原因。所以提示挂 `role="status"`（出现即播报），输入框用 `aria-describedby` 指向它；
 * 提示不渲染时输入框不挂这个属性（指向不存在的 id 比不挂更糟）。
 */
const FOLLOWUP_TOO_LONG_ID = "rf-ai-polish-followup-too-long";

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
  /**
   * 在飞的那一次改写：`null` = 空闲。
   *
   * 记下"是哪个动作发的"，是为了让 spinner 只出现在用户点的那颗按钮上——结果态里
   * 「继续改写」与「重新改写」共用同一个在飞槽位（同一时刻只允许一条），两颗按钮
   * 一起转圈会让人以为点了两次。
   */
  const [pending, setPending] = useState<"compose" | "followUp" | null>(null);
  const busy = pending !== null;
  /** 结果态里的「继续改写要求」：只对上一步的结果生效，成功即清空。 */
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** 卡片位置：初始来自浮层算好的锚点，之后由拖动改写（不写回浮层，关掉即丢）。 */
  const [pos, setPos] = useState({ left, top });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const tooLong = target.text.length > MAX_SELECTION_CHARS;
  /**
   * 待改写的这一段（结果态里就是 `rewritten`）是否已经超出单次上限。
   *
   * 用户可以在结果框里手动加字，加上「继续改写」可能一轮比一轮长；超了就不发请求——
   * 后端会整段拒掉，白等一次往返。
   */
  const followUpTooLong = rewritten.length > MAX_SELECTION_CHARS;

  // 锚点变了（用户在别处又发起一次润色）就回到新位置。
  useEffect(() => setPos({ left, top }), [left, top]);

  // 卡片关掉（或页面切走）时中止在飞的请求：结果已经没人看了。
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  /**
   * 上一次看到的选区。判断"换了一段文字"不能只看对象引用（父组件可能为同一段选区
   * 重建对象），也不能只看偏移（不同输入框里的 0~6 是同一对偏移、却不是同一段文字），
   * 所以按"元素 + 偏移 + 文本"一起认。
   */
  const seenTargetRef = useRef<SelectionTarget | null>(null);

  /**
   * 选区换了：把上一段的状态**全部**清掉（2026-10-21，QA 复核 D2）。
   *
   * 浮层里换一次选区就会换一个 `AiPolishCard` 实例（`AiPolishLayer` 给了 key），但那
   * 只是第一道防线。这里兜住"同一个实例被复用"的情形：残留的 `rewritten` 会让「替换
   * 选中」把**上一段**的改写结果写进新选区——那是直接改坏用户数据的错，不是视觉问题。
   * 同时在飞的旧请求必须 abort：它回来的结果属于上一段文字。
   *
   * 依赖只放 `target`：父组件为同一段选区重渲时不能把用户正在编辑的结果清掉。
   */
  useEffect(() => {
    const previous = seenTargetRef.current;
    seenTargetRef.current = target;
    // 首帧没有"上一段"，状态本来就是空的。
    if (!previous) return;
    if (
      previous.element === target.element &&
      previous.start === target.start &&
      previous.end === target.end &&
      previous.text === target.text
    ) {
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("compose");
    setRewritten("");
    setInstruction("");
    setFollowUp("");
    setError(null);
    setModelMissing(false);
    setPending(null);
  }, [target]);

  const start = useCallback(async () => {
    if (busy || tooLong) return;
    setError(null);
    setModelMissing(false);
    setPending("compose");
    // 控制器放在最前面建：这样"换选区 / 关卡片"能把配置查询也一起中止，catch 里也
    // 能用它判断"这次失败是不是我们自己中止的"（中止不该给新选区弹一个错）。
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // 先确认模型配置：没配就没有可发的请求，直接告诉用户去哪儿配。
      const config = await getLLMConfig();
      if (controller.signal.aborted) return;
      if (!config.base_url || !config.model) {
        setModelMissing(true);
        return;
      }
      const data = await polishSelection(target.text, instruction.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setRewritten(data.result);
      setPhase("result");
    } catch (err) {
      // 自己发起的中止（换选区 / 关卡片）不是失败：静默返回，不弹错。
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.code === "cancelled") return;
      setError(err instanceof Error && err.message ? err.message : "润色失败，请稍后重试");
      // 失败留在原状态：选区、要求、上一版结果都还在，用户可以直接重试。
    } finally {
      // 只有"发出它的那条请求"才有资格收尾：换选区后可能已经有一条新请求接管了
      // `abortRef`，旧请求的 finally 若照旧清空，会把新请求的 spinner 一起清掉。
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPending(null);
      }
    }
  }, [busy, instruction, target.text, tooLong]);

  /**
   * 继续改写：**以上一次的结果作为输入**再跑一遍，可以反复迭代。
   *
   * 用户看过一版结果之后，下一句往往只是"再精简一点"；从原文重来会把上一版白丢。
   * 所以这里把 `rewritten`（含用户在结果框里手改过的内容）当作新的源文本，成功后
   * 原地替换结果并留在结果态——直到用户替换或取消。失败则结果与要求都留着，直接
   * 再点一次即可重试。
   *
   * 不重复 `start()` 里那段模型配置预检：能走到结果态，说明上一次请求已经成功，
   * 配置必然存在；真有变化（比如在另一个标签页把模型删了）由接口报错，错误也落在
   * 同一个位置。与 `start()` 共用 `abortRef` / `pending`：同一时刻只允许一条在飞。
   */
  const continueRewrite = useCallback(async () => {
    if (busy || followUpTooLong || !rewritten.trim()) return;
    setError(null);
    setPending("followUp");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await polishSelection(rewritten, followUp.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setRewritten(data.result);
      // 停在结果态：用户要的是"再改一版"，不是回去重新填要求。
      setPhase("result");
      // 这条要求已经兑现，清空——否则下次很容易把同一句再发一遍。
      setFollowUp("");
    } catch (err) {
      // 用户关掉卡片或换选区时是取消，不是失败：静默返回，不弹错。
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.code === "cancelled") return;
      setError(err instanceof Error && err.message ? err.message : "润色失败，请稍后重试");
      // 失败不动 rewritten / followUp：上一版结果与刚写的要求都还在，可以重试。
    } finally {
      // 与 `start()` 同理：只有发出它的那条请求才收尾，免得清掉新请求的在飞状态。
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPending(null);
      }
    }
  }, [busy, followUp, followUpTooLong, rewritten]);

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

  /**
   * 拖动：按住标题栏（不是整张卡片）移动。
   *
   * 只认标题栏是有意的——卡片主体里有选中的原文、输入框和按钮，整卡可拖会让
   * "想选一段文字"变成"把卡片拖走"。位置只在本次打开期间有效，关掉即回到默认锚点。
   */
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 以 pos 为基准而不是 `getBoundingClientRect()`：卡片挂在 `position: fixed` 的
    // 宿主里（宿主铺满视口），所以 pos 就是视口坐标；从 rect 取在 jsdom 里恒为 0，
    // 测试与真机会算出不同的偏移。
    dragRef.current = { dx: event.clientX - pos.left, dy: event.clientY - pos.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = cardRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 344;
    const height = rect?.height ?? 0;
    const margin = 8;
    setPos({
      left: Math.min(Math.max(margin, event.clientX - drag.dx), window.innerWidth - width - margin),
      top: Math.min(
        Math.max(margin, event.clientY - drag.dy),
        window.innerHeight - height - margin,
      ),
    });
  };

  const onDragEnd = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={cardRef}
      className="rf-ai-polish-card"
      role="dialog"
      aria-label="AI 润色"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={keepSelection}
    >
      <div
        className="rf-ai-polish-card-head"
        title="按住标题可以拖动卡片"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
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
          {/* 继续改写（以这一版结果为输入，可反复迭代）：要求只作用于"下一步"，
              所以放在结果框下面，紧挨着它要处理的那段文字。 */}
          <Typography.Text className="rf-ai-polish-label">继续改写要求（可选）</Typography.Text>
          {followUpTooLong && (
            <Typography.Text
              id={FOLLOWUP_TOO_LONG_ID}
              // 超长是"你点了没反应"的原因，出现时就要被读屏播报出来。
              role="status"
              type="warning"
              className="rf-ai-polish-followup-warning"
            >
              待改写内容超过 {MAX_SELECTION_CHARS} 字，请先手动精简
            </Typography.Text>
          )}
          <Input.TextArea
            className="rf-ai-polish-followup"
            aria-label="继续改写要求"
            // 提示只在超长时存在，所以 id 也跟着条件挂——否则会指向一个不存在的节点。
            aria-describedby={followUpTooLong ? FOLLOWUP_TOO_LONG_ID : undefined}
            value={followUp}
            maxLength={MAX_INSTRUCTION_CHARS}
            autoSize={{ minRows: 1, maxRows: 3 }}
            placeholder="例如：再精简一点 / 突出量化结果"
            disabled={followUpTooLong}
            onChange={(event) => setFollowUp(event.target.value)}
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
        {/* 两个分支各带一个 key：不然 React 会按"同位置同类型"复用按钮实例，结果态的
            「继续改写」会继承上一步「开始改写」的 loading 退场动画——刚出结果时它先闪
            一下转圈图标，期间可访问名还会变成"loading继续改写"。 */}
        {phase === "result" ? (
          <Space key="result" size={8} wrap>
            {/* 顺序按"改动幅度"排：继续改写（在同一版上接着改）→ 重新改写（从原文重来）
                → 替换选中（定稿）→ 取消。定稿仍是唯一的主按钮。 */}
            <Button
              size="small"
              onClick={() => void continueRewrite()}
              loading={pending === "followUp"}
              // 只在"别人在飞"时禁用：自己转圈时若也置灰，按钮会整块变灰白，看不出在跑。
              disabled={followUpTooLong || !rewritten.trim() || (busy && pending !== "followUp")}
            >
              继续改写
            </Button>
            {/* 与「替换选中」同样受 `busy` 约束：原来只有守卫、按钮看着能点却点了没反应。
                与「继续改写」保持同一套写法——自己转圈时不置灰（否则整颗按钮变灰白，
                看不出在跑），别人在飞时才禁用。 */}
            <Button
              size="small"
              onClick={() => void start()}
              loading={pending === "compose"}
              disabled={busy && pending !== "compose"}
            >
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
          <Space key="compose" size={8} wrap>
            <Button
              size="small"
              type="primary"
              onClick={() => void start()}
              loading={pending === "compose"}
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
