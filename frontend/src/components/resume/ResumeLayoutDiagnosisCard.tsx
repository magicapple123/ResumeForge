// SPDX-License-Identifier: Apache-2.0
/**
 * 版面诊断面板：告诉你版面是空是挤、按什么顺序改，并提供「自动一页」。
 *
 * 分工：**规则全在后端**（多少算满、先动哪个旋钮、字号缩到哪为止），这里只做两件
 * 前端才有能力做的事——把实测高度送上取结论、把候选版式真的应用到预览上量一次。
 *
 * 「自动一页」的关键取舍：**逐档试、够放下就停**，而不是一步把字号缩到最小。
 * 每试一档只是往 iframe 里注入一段后端给的 CSS 再量一次，没有网络往返，所以可以
 * 试得比较细（页边距 → 区块间距 → 行高 → 字号，共十几档）。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { App, Alert, Button, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeResumeLayout, updateResumeLayout } from "../../api/resumes";
import { ApiError } from "../../api/client";
import { ot } from "../../features/resume-optimizer/i18n";
import type {
  OptimizerCandidateView,
  OptimizerContentHint,
} from "../../features/resume-optimizer/types";
import LayoutOptimizerPanel from "./optimizer/LayoutOptimizerPanel";
import { draftLayoutKey, optimizerCurrentOf, STATUS_COLORS } from "./resumeLayoutDiagnosisKeys";
import type {
  ResumeContent,
  ResumeLayout,
  ResumeLayoutAnalysis,
  ResumeLayoutStatus,
} from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";

interface Props {
  resumeId: number;
  /** 预览量到的实测高度；还没渲染完时为 null。 */
  measure: LayoutMeasure | null;
  /** 预览是否已经判定溢出。诊断接口不可用时靠它兜底，免得连"塞不下"都不说。 */
  overflow: boolean;
  previewRef: React.RefObject<ResumePreviewHandle | null>;
  /**
   * 这份简历当前的版式参数。
   *
   * **必须原样回传**：`PATCH /layout` 是整体替换，漏掉哪个字段就等于把它重置成默认值——
   * 只想着保存 format_config 而传空模板名，会把用户选好的模板和字号悄悄改掉。
   */
  layout: ResumeLayout;
  disabled?: boolean;
  /** 保存了新方案之后让父组件重新渲染预览。 */
  onApplied: (formatConfig: ResumeFormatConfig) => void;
  onAddPage: () => void;
  /**
   * 当前正文（含还没保存的加粗叠加）：内容精简候选从"用户眼前这一版"生成。
   *
   * 制作台弹层打开时这张卡在它后面（点不到），所以这里拿不到也不需要中栏的未保存草稿；
   * 缺省 = 不生成内容候选（旧宿主行为逐字不变）。
   */
  content?: ResumeContent | null;
  /** 应用内容候选：宿主写回正文（成功后才 toast；失败不假装成功）。 */
  onApplyContent?: (next: ResumeContent) => void | Promise<void>;
  /** 诊断结论回调（问题 8）：阈值只在后端，诊断条只做展示；ref 持有避免重打接口。 */
  onDiagnosisChange?: (
    info: { status: ResumeLayoutStatus; statusLabel: string; fill: number } | null,
  ) => void;
}

export default function ResumeLayoutDiagnosisCard({
  resumeId,
  measure,
  overflow,
  previewRef,
  layout,
  disabled = false,
  onApplied,
  onAddPage,
  content = null,
  onApplyContent,
  onDiagnosisChange,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  // 诊断条消费结论：用 ref 持有回调，回调身份不进 effect 依赖（否则接口会被反复重打）。
  const diagnosisListener = useRef(onDiagnosisChange);
  useEffect(() => {
    diagnosisListener.current = onDiagnosisChange;
  });
  const [analysis, setAnalysis] = useState<ResumeLayoutAnalysis | null>(null);
  /**
   * `analysis` 是**基于哪一版版式**算出来的（`draftLayoutKey` 的结果）。
   *
   * 没有它就会出现 2026-10-24 那个 bug：用户拖完滑杆立刻点「自动一页」，而 effect 里那份
   * `fit_ladder` 还是防抖前那一版 layout 算出来的——照着陈旧清单逐档试、再把结果落库。
   */
  const [analysisKey, setAnalysisKey] = useState<string | null>(null);
  /**
   * 优化器面板上的「最小页边距」。提升到这里的原因：它是**阶梯生成参数**（后端在阈值处
   * 截断页边距档位，问题 17），不是面板本地过滤；诊断按它重算，并且要能判断
   * "这份 analysis 是不是按当前下限算的"（`analysisMargin`）。
   */
  const [optimizerMinMargin, setOptimizerMinMargin] = useState<number | null>(null);
  const [analysisMargin, setAnalysisMargin] = useState<number | null>(null);
  // 详情默认收起（2026-10-28 用户要求）：标题行的状态与占用率仍然一直可见，
  // 收起的只是"结论正文 + 优化候选"，把首屏留给简历本身。
  const [bodyOpen, setBodyOpen] = useState(false);
  // W09 优化器：应用候选 = 一次显式写回（与「自动一页」同一条 PATCH 路径）。
  const [optimizerApplying, setOptimizerApplying] = useState(false);
  const [optimizerConflict, setOptimizerConflict] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [fitting, setFitting] = useState<{ index: number; total: number; label: string } | null>(
    null,
  );
  const requestId = useRef(0);

  const measureKey = measure
    ? `${measure.usedHeight.toFixed(1)}:${measure.pageContentHeight.toFixed(1)}:${measure.pageLimit}`
    : "";
  const layoutKey = draftLayoutKey(layout);

  // 无度量时清空分析状态。Compiler 规范：随 measure 变化的重置用渲染期守卫式调整。
  const [prevMeasure, setPrevMeasure] = useState(measure);
  if (prevMeasure !== measure && !measure) {
    setPrevMeasure(measure);
    setAnalysis(null);
    setAnalysisKey(null);
    setAnalyzing(false);
  }

  useEffect(() => {
    if (!measure) return;
    const current = ++requestId.current;
    // 轻微防抖：预览刚渲染完时可能连着上报几次（字体就绪、缩放变化）。
    const timer = setTimeout(() => {
      setAnalyzing(true);
      // 版式一起送过去：诊断看的是**屏幕上这一版**，不是记录里存的那一版。
      analyzeResumeLayout(
        resumeId,
        {
          used_height: measure.usedHeight,
          page_content_height: measure.pageContentHeight,
          page_limit: measure.pageLimit,
        },
        layout,
        optimizerMinMargin,
      )
        .then((result) => {
          if (current === requestId.current) {
            setAnalysis(result);
            // 记下这份清单的基准：`autoFit` 要拿它判断"是不是上一版算出来的"。
            setAnalysisKey(layoutKey);
            setAnalysisMargin(optimizerMinMargin);
            const diagnosis = result?.diagnosis;
            diagnosisListener.current?.(
              diagnosis
                ? {
                    status: diagnosis.status,
                    statusLabel: diagnosis.status_label,
                    fill: diagnosis.fill,
                  }
                : null,
            );
          }
        })
        .catch(() => {
          // 诊断失败不该打扰正在看简历的用户：面板退回"只说溢出"的兜底形态。
          if (current === requestId.current) {
            setAnalysis(null);
            setAnalysisKey(null);
            diagnosisListener.current?.(null);
          }
        })
        .finally(() => {
          // ★ 复位不能加 `current === requestId.current` 条件：防抖期间连续上报时，
          // 先发出的那次会被后来者"作废"，于是它的 finally 被跳过、analyzing 永远停在
          // true——表现就是卡片该消失的时候一直挂着。只有**结果**需要防过期，
          // "加载中"这个状态不需要。
          setAnalyzing(false);
        });
    }, 250);
    return () => clearTimeout(timer);
    // measureKey 把「同一个高度重复上报」折叠掉，避免每次渲染都打一次接口；
    // layoutKey 管另一件事——高度没动但版式动了（换模板/换预设/手动改间距）时，
    // `fit_room` 与「自动一页」清单都必须重算，否则用户改完参数看到的还是上一版结论。
    // layout 与 measure 都随各自的 key 变化，key 不变就说明送的还是同一份，无需重跑。
    // 优化器的「最小页边距」也是阶梯的输入（后端据此截断页边距档位），必须一起重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, measureKey, layoutKey, optimizerMinMargin]);

  /**
   * 「自动一页」：从**当前这一版**版式出发逐档收紧，够放下就停。
   *
   * 第一步永远是"确认清单是这一版算的"：`analysis` 可能是防抖/网络往返期间留下的上一版
   * 结论（见 `analysisKey` 的说明）。拿陈旧清单去 `measureWithProbe` 并落库，落库的参数与
   * 实测那一版不是同一套，用户看到的就是"点了没变"——这是本条要修的根因。
   */
  const autoFit = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview || !measure) return;

    let current = analysis;
    if (!current || analysisKey !== layoutKey) {
      setAnalyzing(true);
      try {
        current = await analyzeResumeLayout(
          resumeId,
          {
            used_height: measure.usedHeight,
            page_content_height: measure.pageContentHeight,
            page_limit: measure.pageLimit,
          },
          layout,
        );
        setAnalysis(current);
        setAnalysisKey(layoutKey);
      } catch (error) {
        // 拿不到这一版的结论就不能猜着收：宁可什么都不做，也不要存下一套没量过的参数。
        message.error(
          error instanceof Error ? error.message : t("workbench.autofit.analyze-failed"),
        );
        return;
      } finally {
        setAnalyzing(false);
      }
    }

    const ladder = current.fit_ladder ?? [];
    if (ladder.length === 0) return;

    // 逐档试：够放下就停在这里，不会一步把字号缩到最小。
    let measured = true;
    for (let index = 0; index < ladder.length; index += 1) {
      const candidate = ladder[index];
      setFitting({ index: index + 1, total: ladder.length, label: candidate.label });
      const result = preview.measureWithProbe(candidate.css);
      if (!result) {
        // 探针量不到（iframe 还没排版完 / 被卸载）：如实说一句，别静默什么都不做。
        measured = false;
        break;
      }
      const fits = result.usedHeight <= result.pageContentHeight + 0.5;
      if (!fits) {
        // 让浏览器有机会把「正在试第 N 档」画出来，否则循环会把整段时间占满。
        await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      setFitting(null);
      try {
        const saved = await updateResumeLayout(resumeId, {
          template: layout.template,
          format_name: layout.format_name,
          page_limit: layout.page_limit,
          font_scale: layout.font_scale,
          // 本接口是整体替换：语言也一并带上（`undefined` 会由后端当成"不涉及"，不会重置）。
          language: layout.language,
          // 候选版式只描述"怎么收紧"，把它叠在用户已有的版式覆盖之上——
          // 否则「自动一页」会把用户自己调过的板块顺序等覆盖清掉。
          format_config: { ...layout.format_config, ...candidate.config },
        });
        // 后端只回显它接受的部分；以它为准，别用本地算的值假装成功。
        onApplied(saved.format_config ?? {});
        // 不写死"已收进 N 页"：重排之后才知道到底进没进，那句话此前会说谎。
        message.success(t("workbench.autofit.applied", { label: candidate.label }));
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("workbench.autofit.save-failed"));
      }
      return;
    }

    setFitting(null);
    if (!measured) {
      message.warning(t("workbench.autofit.no-measure"));
      return;
    }
    // 收到底也放不下时必须如实说，并把用户指向下一条真正有用的建议。
    message.warning(t("resume.diagnosis.tightest"));
  }, [analysis, analysisKey, layout, layoutKey, measure, message, onApplied, previewRef, resumeId]);

  /**
   * W09：把候选方案里的数值合并进用户已有版式覆盖后写回（整体替换，模板/版式/页数/字号原样回传）。
   * 409（版本冲突）不自动重试：把业务码交给面板显示"先刷新再试"。
   */
  const applyOptimizer = useCallback(
    async (candidate: OptimizerCandidateView) => {
      setOptimizerApplying(true);
      setOptimizerConflict(null);
      try {
        const saved = await updateResumeLayout(resumeId, {
          template: layout.template,
          format_name: layout.format_name,
          page_limit: layout.page_limit,
          font_scale: layout.font_scale,
          language: layout.language,
          format_config: { ...layout.format_config, ...candidate.config },
        });
        onApplied(saved.format_config ?? {});
        message.success(ot("optimizer.applied"));
      } catch (error) {
        if (error instanceof ApiError && error.businessCode === "resume_revision_conflict") {
          setOptimizerConflict(error.businessCode);
        } else {
          message.error(
            error instanceof Error ? error.message : t("workbench.autofit.save-failed"),
          );
        }
      } finally {
        setOptimizerApplying(false);
      }
    },
    [layout, message, onApplied, resumeId],
  );

  /**
   * 内容候选写回正文的**唯一出口**：成功后由面板自己 toast，失败必须在这里说话。
   *
   * 失败后仍然抛出：面板靠"这次 await 是否成功"决定要不要显示成功提示，吞掉错误就会
   * 出现"没写进去却提示已精简"。原稿不受影响（写回是整份替换，失败即未改）。
   */
  const applyContent = useCallback(
    async (next: ResumeContent) => {
      if (!onApplyContent) return;
      try {
        await onApplyContent(next);
      } catch (error) {
        message.error(
          error instanceof Error && error.message
            ? error.message
            : t("workbench.conflict.save-failed"),
        );
        throw error;
      }
    },
    [message, onApplyContent],
  );

  const diagnosis = analysis?.diagnosis;
  const fitRoom = analysis?.fit_room;
  // W09：后端可选下发的"低相关"提示（后端未合入时字段缺省 = 不生成该类候选，fail-soft）。
  const contentHints: readonly OptimizerContentHint[] =
    (analysis as { content_hints?: OptimizerContentHint[] } | null)?.content_hints ?? [];

  const suggestions = useMemo(() => diagnosis?.suggestions ?? [], [diagnosis]);

  // 没有实测高度就无从诊断。诊断拿不到、又不溢出时整块不显示——留一个空标题只会让
  // 用户以为功能坏了。溢出时必须显示：那时兜底提示是唯一告诉他"塞不下"的地方。
  // （版面健康时后端会给一条"保持即可"的建议，所以那种情况下卡片是**该显示**的：
  //   它顺手回答了"我现在这份到底行不行"。）
  if (!measure) return null;
  if (!diagnosis && !overflow) return null;

  return (
    <div className="resume-diagnosis">
      <div className="resume-diagnosis-head">
        <Space size={8} wrap>
          <Typography.Text strong>{t("resume.diagnosis.title")}</Typography.Text>
          {analyzing && <Spin size="small" />}
          {diagnosis && (
            <>
              <Tag color={STATUS_COLORS[diagnosis.status]}>{diagnosis.status_label}</Tag>
              <Typography.Text type="secondary">
                {t("resume.diagnosis.fill", { percent: Math.round(diagnosis.fill * 100) })}
              </Typography.Text>
            </>
          )}
        </Space>
        <Button size="small" type="text" onClick={() => setBodyOpen((open) => !open)}>
          {bodyOpen ? t("resume.diagnosis.collapse") : t("resume.diagnosis.expand")}
        </Button>
        {diagnosis?.status === "overflow" && (analysis?.fit_ladder.length ?? 0) > 0 && (
          <Button
            size="small"
            type="primary"
            loading={fitting !== null}
            // 诊断在飞时也禁用：这一档的清单还没到，点下去要么什么都不做、要么按旧清单做。
            disabled={disabled || analyzing || fitting !== null}
            onClick={() => void autoFit()}
          >
            {t("resume.diagnosis.autofit")}
          </Button>
        )}
      </div>

      {bodyOpen && (
        <>
          {fitting && (
            <Typography.Text type="secondary" className="resume-diagnosis-progress">
              {t("resume.diagnosis.fitting", {
                index: fitting.index,
                total: fitting.total,
                label: fitting.label,
              })}
            </Typography.Text>
          )}

          {diagnosis && (
            <Typography.Paragraph className="resume-diagnosis-summary">
              {diagnosis.summary}
            </Typography.Paragraph>
          )}

          {/* 诊断接口不可用（后端一时不可达等）时，至少把"塞不下"这件事说出来——
          只是静默地不显示面板，用户会以为版面没问题。措辞不再提"整体缩小"：
          2026-10-21 起预览不再自动缩字号，装不下的部分直接截断。 */}
          {!diagnosis && overflow && (
            <Alert
              type="warning"
              showIcon
              className="resume-diagnosis-floor"
              title={t("resume.diagnosis.overflowNoAnalysis", { pages: layout.page_limit })}
            />
          )}

          {suggestions.length > 0 && (
            <ol className="resume-diagnosis-list">
              {suggestions.map((item) => (
                <li key={item.kind}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Typography.Text type="secondary"> — {item.detail}</Typography.Text>
                </li>
              ))}
            </ol>
          )}

          {/* W09：按条件优化版面的候选方案（挂在诊断结论下方；应用=写回滑杆）。 */}
          <LayoutOptimizerPanel
            analysis={
              analysisKey === layoutKey && analysisMargin === optimizerMinMargin ? analysis : null
            }
            current={optimizerCurrentOf(layout)}
            probe={(css) => previewRef.current?.measureWithProbe(css) ?? null}
            before={measure}
            disabled={disabled}
            applying={optimizerApplying}
            conflictCode={optimizerConflict}
            onApply={applyOptimizer}
            content={content}
            contentHints={contentHints}
            onApplyContent={onApplyContent ? applyContent : undefined}
            pageLimit={layout.page_limit}
            onMinMarginChange={setOptimizerMinMargin}
          />

          {fitRoom && diagnosis?.status === "overflow" && (
            <Alert
              type="info"
              showIcon
              className="resume-diagnosis-floor"
              title={fitRoom.font_floor_note}
              action={
                layout.page_limit < 3 && (
                  <Button size="small" disabled={disabled || fitting !== null} onClick={onAddPage}>
                    {t("resume.diagnosis.addPage", { pages: layout.page_limit + 1 })}
                  </Button>
                )
              }
            />
          )}
        </>
      )}
    </div>
  );
}
