// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球 #27 六项的**编排层**。
 *
 * 球体组件（`TouTouOrb.tsx`）已经贴着 500 行预算，而这里是"把页面上下文、信号、
 * 中断预算、划词动作、动作面板、侧问与提案卡接起来"的纯胶水：不渲染任何可见元素，
 * 只返回给球体要用的 props 与回调。这样六个子项各自的规则仍住在各自的小模块里。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMaterial } from "../../api/material";
import { getProfile } from "../../api/profile";
import { t, type MessageKey, type MessageParams } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useShortcut } from "../shortcuts/useShortcutKeymap";
import {
  buildSideAskQuestion,
  askTouTouSideQuestion,
  type TouTouSideAskAction,
} from "./touTouSideAsk";
import { copyTextToClipboard } from "./touTouClipboard";
import { duplicateAnchorsFromProfile, findDuplicatePairs } from "./touTouDuplicateCriteria";
import { touTouActionById, type TouTouActionRuntime } from "./touTouActions";
import {
  clearTouTouProposal,
  useTouTouProposal,
  type TouTouProposalDraft,
} from "./touTouProposalStore";
import {
  readActiveSelection,
  type DomSelectionSnapshot,
  type TouTouSelectionActionId,
} from "./touTouSelection";
import type { TouTouActionPanelProps } from "./TouTouActionPanel";
import { useTouTou } from "./touTouContext";
import { useTouTouIntervention } from "./useTouTouIntervention";
import { useTouTouPageContext } from "./useTouTouPageContext";
import { useTouTouProposalBridge } from "./useTouTouProposalBridge";
import { useTouTouSignals } from "./useTouTouSignals";

/** 长按多久打开动作面板（详册：400ms）。 */
export const LONG_PRESS_MS = 400;

/** 需要模型回答的划词动作（其余是本地动作）。 */
const MODEL_SELECTION_ACTIONS: ReadonlySet<TouTouSelectionActionId> = new Set([
  "rewrite",
  "star",
  "numbers",
  "jd-match",
  "keywords",
  "explain",
  "recognize",
]);

const SECTION_LABEL_KEYS: Record<string, MessageKey> = {
  educations: "touTou.section.educations",
  experiences: "touTou.section.experiences",
  campus_experiences: "touTou.section.campusExperiences",
  projects: "touTou.section.projects",
};

/** 打开面板那一刻要展示的内容。`id` 变化 = 重开，面板内部状态跟着复位。 */
interface PanelState {
  id: number;
  selection: DomSelectionSnapshot | null;
  autoAsk: string | null;
  initialResult: { title: string; text: string } | null;
}

export interface TouTouOrbFeaturesOptions {
  enabled: boolean;
  /** 设置里的「提示标语」开关：关掉只停气泡，pulse 与其余功能不受影响。 */
  tipsEnabled: boolean;
  /**
   * 设置里的「划词浮条」开关（Q9）：关掉后选中文字不再浮出动作条。
   * 可选——不传时读 TouTou 上下文里的同名值（调用它的球体组件已贴 500 行预算）。
   */
  selectionEnabled?: boolean;
  /** 资料页的「去改资料」提示卡在场时压掉信号气泡（同一块地方会打架）。 */
  suppressAnnouncement: boolean;
  onOpenAssistant?: () => void;
  onOpenClipboard?: () => void;
}

export interface TouTouOrbSignalTip {
  text: MessageKey;
  params?: MessageParams;
  actionLabel: MessageKey;
  onAction: () => void;
  muteLabel: MessageKey;
  onMute: () => void;
}

export interface TouTouOrbFeatures {
  pulsing: boolean;
  signalCount: number;
  tip: TouTouOrbSignalTip | null;
  onTipClose: () => void;
  selectionEnabled: boolean;
  onSelectionAction: (action: TouTouSelectionActionId, snapshot: DomSelectionSnapshot) => void;
  panelProps: TouTouActionPanelProps | null;
  /** 面板实例序号：同一次打开内保持，重开换 key 让面板内部状态复位。 */
  panelKey: number | null;
  proposal: TouTouProposalDraft | null;
  onProposalDismiss: () => void;
  startLongPress: () => void;
  cancelLongPress: () => void;
  /** 返回 true = 这次"点击"其实是长按，调用方要吞掉它。 */
  consumeLongPress: () => boolean;
}

export function useTouTouOrbFeatures({
  enabled,
  tipsEnabled,
  selectionEnabled,
  suppressAnnouncement,
  onOpenAssistant,
  onOpenClipboard,
}: TouTouOrbFeaturesOptions): TouTouOrbFeatures {
  useLocale();
  // 调用方没显式传时以设置上下文为准：划词浮条和入口、标语一样是用户可单独关掉的。
  const { selectionEnabled: selectionFromContext } = useTouTou();
  const selectionAllowed = selectionEnabled ?? selectionFromContext;
  const navigate = useNavigate();
  const pageContext = useTouTouPageContext();
  const signals = useTouTouSignals();
  const intervention = useTouTouIntervention(signals);
  const proposal = useTouTouProposal();
  // #27F × #13D：订阅助手流，把写操作预览实时转成提案卡（只读订阅，不改 w1 文件）。
  useTouTouProposalBridge();

  const [panel, setPanel] = useState<PanelState | null>(null);
  const panelSeqRef = useRef(0);
  const pageTitle = pageContext.titleKey ? t(pageContext.titleKey) : "";

  const openPanel = useCallback(
    (
      options: {
        selection?: DomSelectionSnapshot | null;
        autoAsk?: string | null;
        initialResult?: { title: string; text: string } | null;
      } = {},
    ) => {
      panelSeqRef.current += 1;
      setPanel({
        id: panelSeqRef.current,
        selection:
          options.selection === undefined ? readActiveSelection(window) : options.selection,
        autoAsk: options.autoAsk ?? null,
        initialResult: options.initialResult ?? null,
      });
    },
    [],
  );

  const runtime = useMemo<TouTouActionRuntime>(
    () => ({
      openAssistant: () => onOpenAssistant?.(),
      openClipboard: () => onOpenClipboard?.(),
      openSideAsk: () => openPanel({ selection: null }),
      navigate: (path) => void navigate(path),
    }),
    [navigate, onOpenAssistant, onOpenClipboard, openPanel],
  );

  const runAction = useCallback(
    (actionId: string) => {
      intervention.onTipEngage();
      touTouActionById(actionId)?.run(runtime);
      setPanel(null);
    },
    [intervention, runtime],
  );

  /** 划词动作分发：本地动作就地出结果，模型动作打开面板直接问。 */
  const runSelectionAction = useCallback(
    (action: TouTouSelectionActionId, snapshot: DomSelectionSnapshot) => {
      intervention.onTipEngage();
      if (MODEL_SELECTION_ACTIONS.has(action)) {
        openPanel({
          selection: snapshot,
          autoAsk: buildSideAskQuestion(action as TouTouSideAskAction),
        });
        return;
      }
      void (async () => {
        if (action === "copy") {
          const copied = await copyTextToClipboard(snapshot.text);
          openPanel({
            selection: snapshot,
            initialResult: {
              title: t("touTou.selection.copy"),
              text: copied ? t("touTou.selection.copied") : t("touTou.selection.copyFailed"),
            },
          });
          return;
        }
        if (action === "save-material") {
          const firstLine = snapshot.text.split(/\r?\n/u)[0]?.trim() ?? "";
          try {
            const material = await createMaterial({
              title: firstLine.slice(0, 30) || t("touTou.clipboard.untitled"),
              // i18n-ok: 资料箱分类是协议值（后端 MATERIAL_CATEGORIES 里的固定字符串），不翻译
              category: "笔记",
              content: snapshot.text,
              url: "",
              files: [],
              note: "",
            });
            openPanel({
              selection: snapshot,
              initialResult: {
                title: t("touTou.selection.saveMaterial"),
                text: t("touTou.selection.saved", { title: material.title }),
              },
            });
          } catch (cause) {
            openPanel({
              selection: snapshot,
              initialResult: {
                title: t("touTou.selection.saveMaterial"),
                text: t("touTou.selection.saveFailed", {
                  reason: cause instanceof Error ? cause.message : String(cause),
                }),
              },
            });
          }
          return;
        }
        // check-duplicates：复用 #20 判据在本地比对资料条目，不花模型调用。
        try {
          const anchors = duplicateAnchorsFromProfile(await getProfile());
          const pairs = findDuplicatePairs(anchors, snapshot.text);
          const lines = pairs.map((pair) => {
            const section = t(SECTION_LABEL_KEYS[pair.section] ?? "touTou.panel.title");
            // 分隔符用半角：这是拼给用户看的"分区: A ↔ B"数据行，全角会进中文棘轮。
            return `${section}: ${pair.left.anchor} ↔ ${pair.right.anchor}`;
          });
          openPanel({
            selection: snapshot,
            initialResult: {
              title:
                pairs.length > 0
                  ? t("touTou.selection.duplicateFound", { count: pairs.length })
                  : t("touTou.selection.duplicateNone"),
              text:
                pairs.length > 0
                  ? `${lines.join("\n")}\n\n${t("touTou.selection.duplicateCriteria")}`
                  : t("touTou.selection.duplicateNone"),
            },
          });
        } catch (cause) {
          openPanel({
            selection: snapshot,
            initialResult: {
              title: t("touTou.selection.checkDuplicates"),
              text: t("touTou.selection.saveFailed", {
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
            },
          });
        }
      })();
    },
    [intervention, openPanel],
  );

  const askSideQuestion = useCallback(
    async (question: string): Promise<string> => {
      const answer = await askTouTouSideQuestion({
        question,
        selection: panel?.selection?.text,
        page: pageTitle,
      });
      return answer.answer;
    },
    [pageTitle, panel],
  );

  // 长按 400ms 打开面板；返回 true 时调用方吞掉随后的 click（长按不是单击）。
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  const startLongPress = useCallback(() => {
    clearLongPress();
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      openPanel();
    }, LONG_PRESS_MS);
  }, [clearLongPress, openPanel]);
  const consumeLongPress = useCallback(() => {
    const fired = longPressFiredRef.current;
    longPressFiredRef.current = false;
    return fired;
  }, []);
  useEffect(() => clearLongPress, [clearLongPress]);

  // Search and selection actions share one dispatcher and complementary context predicates.
  useShortcut("selectionPanel", () => openPanel(), enabled);

  // 信号气泡：设置开关关掉就只保留 pulse；提示卡在场时不抢同一块地方。
  const signal = tipsEnabled && !suppressAnnouncement ? intervention.announce : null;
  const tip: TouTouOrbSignalTip | null = signal
    ? {
        text: signal.messageKey,
        params: signal.params,
        actionLabel: signal.actionId
          ? (touTouActionById(signal.actionId)?.labelKey ?? "touTou.signal.openPanel")
          : "touTou.signal.openPanel",
        onAction: () => {
          if (signal.actionId) {
            runAction(signal.actionId);
            return;
          }
          intervention.onTipEngage();
          openPanel({ selection: null });
        },
        muteLabel: "touTou.signal.mute",
        onMute: () => intervention.onMute(signal.kind),
      }
    : null;

  const panelProps: TouTouActionPanelProps | null = panel
    ? {
        pageActions: pageContext.actions,
        selection: panel.selection,
        autoAsk: panel.autoAsk,
        initialResult: panel.initialResult,
        onRunAction: runAction,
        onRunSelectionAction: runSelectionAction,
        onSideAsk: askSideQuestion,
        mutedCount: intervention.mutedCount,
        onRestoreMuted: intervention.onRestoreMuted,
        onClose: () => setPanel(null),
      }
    : null;

  return {
    pulsing: intervention.signals.length > 0,
    signalCount: intervention.signals.length,
    tip,
    onTipClose: intervention.onTipDismiss,
    selectionEnabled: enabled && selectionAllowed && panel === null,
    onSelectionAction: runSelectionAction,
    panelProps,
    panelKey: panel?.id ?? null,
    proposal,
    onProposalDismiss: () => {
      if (proposal) clearTouTouProposal(proposal.id);
    },
    startLongPress,
    cancelLongPress: clearLongPress,
    consumeLongPress,
  };
}
