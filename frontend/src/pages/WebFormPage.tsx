/**
 * 网申填表：把本地资料填进公司自建网申系统的表单。
 *
 * **只填不交**——页面上不存在任何"提交"按钮，填完由用户回到浏览器窗口自己核对并提交。
 * 这条不是提示语，是产品边界：`WebFormPage.test.tsx` 里有一条断言钉着"界面上没有提交按钮"。
 *
 * 使用网申填表专用的受控浏览器窗口，与投递台分离；这里只负责状态显示与启停。
 *
 * ## 读到的表单与草稿存在 URL / 当前标签页里，不是只存在组件里
 *
 * 「资料里没有」那一块带着「去我的资料补上」的链接，**跳过去再回来是这个功能设计上就要走的
 * 路径**。快照与预览原本是组件内的 useState——一跳走就卸载、回来全空，用户会觉得
 * "我读的东西被吞了"。现在用 URL 保存 snapshot_id 以支持刷新、后退和可分享的恢复，同时用
 * 当前标签页的 sessionStorage 保存勾选、手改值、结果等临时填写状态。
 *
 * URL 这一层可分享、可刷新、可前进后退；**用 replace 写回**，否则每读一次就往历史里塞一条，
 * 用户点后退会退回"没读过"的状态。sessionStorage 只负责当前标签页的未完成草稿，不把真实资料
 * 放进 URL。
 *
 * 如果只有 URL 而没有当前标签页草稿，重放的是**「读到了什么」**，勾选会回到默认；有草稿时则连
 * 勾选、手改值和填充结果一起恢复。这样既不把临时状态塞进 URL，也不会在正常切页时丢失进度。
 */
import {
  ChromeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Space,
  Spin,
  Steps,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getLLMConfig } from "../api/settings";
import {
  fillWebForm,
  getWebFormBrowserStatus,
  getWebFormExtraProfile,
  getWebFormLiveStatus,
  listWebFormUrlHistory,
  deleteWebFormUrlHistory,
  openWebFormUrl,
  getWebFormMemoryTargets,
  previewWebForm,
  rememberWebFormLive,
  startWebFormBrowser,
  startWebFormLive,
  stopWebFormBrowser,
  stopWebFormLive,
  takeWebFormSnapshot,
  updateWebFormExtraProfile,
} from "../api/webform";
import BrowserSettingsModal from "../components/apply/BrowserSettingsModal";
import { useWebFormSession } from "../features/webform/useWebFormSession";
import type { WebFormSessionState } from "../features/webform/webFormSessionStorage";
import WebFormLearningDialog, {
  type LearningSelection,
} from "../components/webform/WebFormLearningDialog";
import WebFormMemoryDialog, {
  type WebFormMemorySelection,
} from "../components/webform/WebFormMemoryDialog";
import WebFormPendingPanel from "../components/webform/WebFormPendingPanel";
import WebFormPreviewTable from "../components/webform/WebFormPreviewTable";
import WebFormRecordsPanel from "../components/webform/WebFormRecordsPanel";
import WebFormBrowserUrlBar from "../components/webform/WebFormBrowserUrlBar";
import { useBrowserStatus } from "../hooks/useBrowserStatus";
import {
  BROWSER_STATE_META,
  type WebFormExtraEntry,
  type WebFormFillResult,
  type WebFormLearningCandidate,
  type WebFormLive,
  type WebFormMemoryTarget,
  type WebFormPreview,
  type WebFormSnapshot,
  type WebFormUrlHistory,
} from "../types";

/** URL 里记住当前这次读取的参数名。 */
const SNAPSHOT_PARAM = "snapshot";
/** AI 开关也一起记住：重放预览时要用同一个值，否则"读的时候开了 AI、回来却重算成规则版"。 */
const AI_PARAM = "ai";
const WEB_FORM_STATUS_POLL_INTERVAL_MS = 600;

/** 浏览器窗口里正在发生什么，在这边如实显示——不然用户不知道模式开着没有。 */
const LIVE_STATUS_META: Record<string, { label: string; color: string }> = {
  thinking: { label: "正在看这个框", color: "processing" },
  ai_thinking: { label: "AI 正在识别", color: "processing" },
  matched: { label: "已给出建议", color: "success" },
  blocked: { label: "不会自动填", color: "default" },
  unmatched: { label: "没认出来", color: "warning" },
  filled: { label: "已填入", color: "success" },
  failed: { label: "没填进去", color: "error" },
  "": { label: "等待你点某个框", color: "processing" },
};

/**
 * 配没配模型决定 AI 开关能不能用。
 *
 * 判据与后端**逐字一致**（`base_url` 与 `model` 都非空，不看 api_key——本地部署的模型服务
 * 常常不需要）。不一致的话会出现"界面说能用、后端静默不用"或者反过来。
 */
function useAiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void getLLMConfig()
      .then((config) => setAvailable(Boolean(config.base_url && config.model)))
      .catch(() => setAvailable(null));
  }, []);
  return available;
}

/** 一键填充成功率：按「已填 / (已填+失败)」计；没有任何尝试过的项时不显示。 */
function FillRateTag({ filled, failed }: { filled: number; failed: number }) {
  const attempted = filled + failed;
  if (attempted === 0) return null;
  return <Tag color="processing">成功率 {Math.round((filled * 100) / attempted)}%</Tag>;
}

export default function WebFormPage() {
  const { message } = App.useApp();
  const browser = useBrowserStatus(getWebFormBrowserStatus, WEB_FORM_STATUS_POLL_INTERVAL_MS);
  const {
    initial: restoredSession,
    persist: persistWebFormSession,
    clear: clearWebFormSession,
  } = useWebFormSession();
  const [snapshot, setSnapshot] = useState<WebFormSnapshot | null>(restoredSession.snapshot);
  const [preview, setPreview] = useState<WebFormPreview | null>(restoredSession.preview);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(restoredSession.selected));
  const [values, setValues] = useState<Record<number, string>>(restoredSession.values);
  const [result, setResult] = useState<WebFormFillResult | null>(restoredSession.result);
  const [sessionActive, setSessionActive] = useState(restoredSession.sessionActive);
  const [busy, setBusy] = useState<
    "start" | "read" | "fill" | "stop" | "end" | "live" | "refresh" | null
  >(null);
  // 浏览器那几个按钮共用这一个 busy：**任何一个在跑，其余的都禁用**。
  // 它们职责分得开（起停 / 配置 / 重查），但都围绕同一个浏览器进程——并行点开只会让
  // "关闭还没回来就点了启动"这类交错更难对上账。
  const anyBusy = busy !== null;
  const [live, setLive] = useState<WebFormLive | null>(null);
  const [liveOptOut, setLiveOptOut] = useState(restoredSession.liveOptOut);
  const liveStarting = useRef(false);
  // 填充完成后加一，「填充记录」据此重新拉取。
  const [recordRefresh, setRecordRefresh] = useState(0);
  // 「这次填的几项简历通里没有，要记住吗」的提案；空数组 = 不弹。
  const [learning, setLearning] = useState<WebFormLearningCandidate[]>([]);
  const [learningSaving, setLearningSaving] = useState(false);
  const [browserSettingsOpen, setBrowserSettingsOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [urlHistory, setUrlHistory] = useState<WebFormUrlHistory[]>([]);
  const [memoryTargets, setMemoryTargets] = useState<WebFormMemoryTarget[]>([]);
  const [memoryTargetsLoading, setMemoryTargetsLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const memoryPendingKey = useRef("");
  const aiAvailable = useAiAvailable();
  const [aiEnabled, setAiEnabled] = useState(restoredSession.aiEnabled);
  // 当前这次读取记在 URL 里（见文件头的说明）。`replace` 写回，不堆历史。
  const [searchParams, setSearchParams] = useSearchParams();
  // 挂载时从 URL 恢复用的一次性标记：只自动重放一次，之后由用户自己点「读取」。
  const [restoring, setRestoring] = useState(() =>
    Boolean(searchParams.get(SNAPSHOT_PARAM) && !restoredSession.preview),
  );

  const running = browser.data?.state === "running";
  // 没配模型时开关不起作用——**说清楚**，否则用户开了却毫无变化，只会以为功能坏了。
  const aiOn = aiEnabled && aiAvailable === true;
  // 后端没重启时这两个字段还不存在（它们是这一次新加的）。用 `?? []` 兜住，
  // 让"前端先更新、后端还没重启"这个窗口期表现成少显示一行，而不是整页白屏。
  const alternatives = live?.alternatives ?? [];
  const aiSuggestions = useMemo(
    () => (preview?.items ?? []).filter((item) => item.source === "ai"),
    [preview],
  );
  const stateMeta = BROWSER_STATE_META[browser.data?.state ?? "stopped"];
  const rememberPending = live?.remember_pending ?? null;
  const rememberPendingSignature = rememberPending
    ? [rememberPending.field_key, rememberPending.value, rememberPending.field_label].join("|")
    : "";

  useEffect(() => {
    void listWebFormUrlHistory()
      .then((data) => setUrlHistory(data.items))
      .catch(() => undefined);
  }, []);

  // 浏览器状态以接口探测为准，表单草稿与当前填写进度留在当前应用标签页。
  useEffect(() => {
    if (!sessionActive && !snapshot && !preview && !result) {
      clearWebFormSession();
      return;
    }
    const state: WebFormSessionState = {
      sessionActive,
      snapshot,
      preview,
      selected: [...selected],
      values,
      result,
      aiEnabled,
      liveOptOut,
    };
    persistWebFormSession(state);
  }, [
    aiEnabled,
    liveOptOut,
    preview,
    result,
    selected,
    sessionActive,
    snapshot,
    values,
    clearWebFormSession,
    persistWebFormSession,
  ]);

  // 页面从「我的资料」等其他界面回来时，实时会话状态由后端恢复，不重新要求用户开启。
  useEffect(() => {
    let cancelled = false;
    void getWebFormLiveStatus()
      .then((next) => {
        if (cancelled) return;
        setLive(next);
        if (next.running) setSessionActive(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** 把这次读取记进 URL。**`replace`**：读一次不该往历史里塞一条。 */
  const rememberSnapshot = useCallback(
    (snapshotId: string, ai: boolean) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(SNAPSHOT_PARAM, snapshotId);
          next.set(AI_PARAM, ai ? "1" : "0");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** 忘掉这次读取（填完了、关浏览器了、或后端说它过期了）。 */
  const forgetSnapshot = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(SNAPSHOT_PARAM);
        next.delete(AI_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleStart = useCallback(async () => {
    setBusy("start");
    try {
      const status = targetUrl.trim()
        ? await openWebFormUrl(targetUrl.trim()).then(() => getWebFormBrowserStatus())
        : await startWebFormBrowser();
      browser.setData(status);
      setSessionActive(true);
      message.success(
        targetUrl.trim()
          ? "目标网申页面已打开；已有网页不会被覆盖"
          : "浏览器已启动。请在这个窗口里打开目标公司的网申页面，再回来点「读取当前表单」",
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "启动浏览器失败");
    } finally {
      setBusy(null);
    }
  }, [browser, message, targetUrl]);

  const handleOpenUrl = useCallback(async () => {
    const url = targetUrl.trim();
    if (!url) {
      await handleStart();
      return;
    }
    setBusy("start");
    try {
      await openWebFormUrl(url);
      const status = await getWebFormBrowserStatus();
      browser.setData(status);
      setSessionActive(true);
      const next = await listWebFormUrlHistory();
      setUrlHistory(next.items);
      message.success("目标网申页面已打开；已有网页不会被覆盖");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开网申页面失败");
    } finally {
      setBusy(null);
    }
  }, [browser, handleStart, message, targetUrl]);

  const handleDeleteUrlHistory = useCallback(
    async (item: WebFormUrlHistory) => {
      try {
        await deleteWebFormUrlHistory(item.id);
        setUrlHistory((previous) => previous.filter((entry) => entry.id !== item.id));
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除网址记录失败");
      }
    },
    [message],
  );

  const handleStop = useCallback(async () => {
    setBusy("stop");
    try {
      if (live?.running) {
        const stopped = await stopWebFormLive();
        setLive(stopped);
      }
      setLiveOptOut(false);
      await stopWebFormBrowser();
      setSessionActive(false);
      setLive(null);
      await browser.reload();
      // 关闭浏览器不等于结束本次填写：用户重新打开后仍应接着刚才的草稿。
    } catch (error) {
      message.error(error instanceof Error ? error.message : "关闭浏览器失败");
    } finally {
      setBusy(null);
    }
  }, [browser, live?.running, message]);

  const handleEndSession = useCallback(async () => {
    setBusy("end");
    try {
      // 结束语义与普通离开不同：停止监听、关闭受控浏览器，再清理本次未完成草稿。
      await stopWebFormLive();
      await stopWebFormBrowser();
      await browser.reload();
      setLive(null);
      setLiveOptOut(false);
      setSessionActive(false);
      setSnapshot(null);
      setPreview(null);
      setSelected(new Set());
      setValues({});
      setResult(null);
      setLearning([]);
      setMemoryDialogOpen(false);
      setRestoring(false);
      clearWebFormSession();
      forgetSnapshot();
      message.success("本次网申填写已结束");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "结束本次填写失败");
    } finally {
      setBusy(null);
    }
  }, [browser, clearWebFormSession, forgetSnapshot, message]);

  const handleRefreshStatus = useCallback(async () => {
    setBusy("refresh");
    try {
      await browser.reload();
      message.success("浏览器状态已刷新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "刷新浏览器状态失败");
    } finally {
      setBusy(null);
    }
  }, [browser, message]);

  // 模式开着的时候轮询状态（面板在浏览器里，这边要能看到它在做什么）。
  // 关掉就停——不留一个永远转的定时器。
  useEffect(() => {
    if (!live?.running) return;
    const timer = window.setInterval(() => {
      void getWebFormLiveStatus()
        .then((next) => {
          setLive(next);
          if (next.running) setSessionActive(true);
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [live?.running]);

  // 「记住这条」只在用户点过按钮后出现。每个 pending 只拉一次完整资料目录，避免后台轮询
  // 每 1.5 秒都重复请求；资料目录本身包含我的资料、网申资料和已有自定义字段。
  useEffect(() => {
    const key = rememberPendingSignature;
    if (!key) {
      memoryPendingKey.current = "";
      setMemoryDialogOpen(false);
      return;
    }
    if (memoryPendingKey.current === key) return;
    memoryPendingKey.current = key;
    setMemoryDialogOpen(true);
    setMemoryTargetsLoading(true);
    void getWebFormMemoryTargets()
      .then((result) => setMemoryTargets(result.targets))
      .catch((error) => {
        message.error(error instanceof Error ? error.message : "加载完整资料目录失败");
      })
      .finally(() => setMemoryTargetsLoading(false));
  }, [message, rememberPendingSignature]);

  // 默认开启：浏览器一旦真正可用就自动装上监听。用户明确点过「关闭」后，
  // 本次页面生命周期内不再擅自打开，避免把用户的关闭操作变成反复弹出的打扰。
  //
  // **先读状态、没开才启动**：浏览器路由已经在后端顺手开过一次（见 `api/webform.py`），
  // 这里再无条件发一次 `/live/start` 不但多余，回来的旧响应还会把刚读到的"已开启"
  // 覆盖回"未开启"（用户会看到卡片先亮再灭）。
  useEffect(() => {
    if (!running || liveOptOut || aiAvailable === null || live?.running || liveStarting.current) {
      return;
    }
    liveStarting.current = true;
    void getWebFormLiveStatus()
      .then((current) => (current?.running ? current : startWebFormLive(aiOn)))
      .then((next) => {
        setLive(next ?? null);
        if (next?.running) setSessionActive(true);
      })
      .catch(() => undefined)
      .finally(() => {
        liveStarting.current = false;
      });
  }, [aiAvailable, aiOn, live?.running, liveOptOut, running]);

  // 浏览器被用户在窗口里直接关掉时，状态轮询会把本地活动标记立即收拢；
  // 已读快照仍保留，重新打开浏览器后可以继续核对，不把草稿误当成已丢失。
  useEffect(() => {
    if (browser.data?.state !== "stopped") return;
    setSessionActive(false);
    setLive(null);
    // 关闭浏览器后再次打开，点击填表应回到默认开启状态。
    setLiveOptOut(false);
  }, [browser.data?.state]);

  const handleLiveToggle = useCallback(async () => {
    setBusy("live");
    try {
      setSessionActive(true);
      const stopping = Boolean(live?.running);
      const next = stopping ? await stopWebFormLive() : await startWebFormLive(aiOn);
      setLive(next ?? null);
      setLiveOptOut(stopping);
      message.success(
        next?.running
          ? "已开启。回到浏览器窗口，点到哪个框就在旁边给你要填的值"
          : "已关闭，页面上的提示面板也撤掉了",
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "切换点击填表失败");
    } finally {
      setBusy(null);
    }
  }, [aiOn, live?.running, message]);

  /**
   * 把一份预览铺到界面上。**读取与重放共用这一处**——两处各写一遍的话，
   * 迟早会出现"读出来是这个勾选状态、恢复出来是另一个"。
   */
  const applyPreview = useCallback((report: WebFormPreview) => {
    setPreview(report);
    // 默认勾选**不含冲突项**——页面上已有的值可能是用户上一轮填了一半的草稿。
    setSelected(new Set(report.default_indexes));
    setValues({});
  }, []);

  const handleRead = useCallback(async () => {
    setBusy("read");
    setResult(null);
    setSessionActive(true);
    try {
      const taken = await takeWebFormSnapshot();
      const report = await previewWebForm(taken.snapshot_id, aiOn);
      setSnapshot(taken);
      applyPreview(report);
      rememberSnapshot(taken.snapshot_id, aiOn);
      if (!report.items.length) {
        message.info("这一页没找到能自动填的字段，可以看看下面的清单");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取表单失败");
    } finally {
      setBusy(null);
    }
  }, [aiOn, applyPreview, message, rememberSnapshot]);

  /**
   * 回到本页时按 URL 里的 `snapshot_id` 重放一次预览。
   *
   * 后端的预览是**纯计算**（快照 + 资料），所以重放出来的与当初读到的一致（资料没变的话）。
   * 快照有 15 分钟 TTL——过期时后端会抛「这次读取的表单已经过期，请重新点「读取当前表单」」，
   * 这里**原样转述那句话**（不另编一句，否则同一件事有两个说法），并清掉 URL 参数，
   * 而不是静默留一个空页面。
   *
   * AI 开关按当初那次的值重放，否则"读的时候开了 AI、回来却重算成规则版"，
   * 用户会以为结果变了。
   */
  useEffect(() => {
    if (!restoring) return;
    const snapshotId = searchParams.get(SNAPSHOT_PARAM);
    if (!snapshotId) {
      setRestoring(false);
      return;
    }
    // AI 要不要用，等模型配置读回来再定——否则 `aiOn` 还是 false，会重放成规则版。
    if (aiAvailable === null) return;

    let cancelled = false;
    const restore = async () => {
      const aiWas = searchParams.get(AI_PARAM) === "1";
      setBusy("read");
      try {
        const report = await previewWebForm(snapshotId, aiWas && aiAvailable);
        if (cancelled) return;
        setSnapshot({ snapshot_id: snapshotId, page: report.page });
        applyPreview(report);
        message.info("已恢复上次读取的表单；勾选已重置为默认，请核对后再填充");
      } catch (error) {
        if (cancelled) return;
        forgetSnapshot();
        message.warning(
          error instanceof Error ? error.message : "上次读取的表单已失效，请重新读取",
        );
      } finally {
        if (!cancelled) {
          setBusy(null);
          setRestoring(false);
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // 只在挂载时按 URL 重放一次；`restoring` 落下后就不再触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring, aiAvailable]);

  const handleFill = useCallback(async () => {
    if (!preview) return;
    setBusy("fill");
    try {
      const items = preview.items
        .filter((item) => selected.has(item.index))
        .map((item) => ({
          index: item.index,
          field: item.field,
          value: values[item.index] ?? item.value,
        }));
      const filled = await fillWebForm(preview.snapshot_id, items);
      setSessionActive(true);
      setResult(filled);
      // 让「填充记录」立刻多出这一条——用户刚填完就想看到它，不该等下次进页面。
      setRecordRefresh((previous) => previous + 1);
      // 这一轮已经落定：清掉 URL 里的读取标记，否则下次进页面会重放一份"已经填过了"的预览。
      forgetSnapshot();
      message.success(`已填 ${filled.filled} 项，请到浏览器窗口里核对后自己提交`);
      // 真填进去了、且有"库里没有"的项 → 问一句要不要记住。
      // **判据里的 filled > 0 不能省**：一个都没填进去却问"要记住吗"是自相矛盾的。
      if (filled.filled > 0 && (preview.learning?.candidates?.length ?? 0) > 0) {
        setLearning(preview.learning.candidates);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "填充失败");
    } finally {
      setBusy(null);
    }
  }, [forgetSnapshot, message, preview, selected, values]);

  /**
   * 把用户勾中的那几条记进「网申资料」。
   *
   * **先拉一次现有的再合并**：`PUT /extra-profile` 是整份覆盖（没提到的 key 会被删除），
   * 直接只发学到的这几条会把用户之前录的全删掉。
   */
  const handleRemember = useCallback(
    async (selections: LearningSelection[]) => {
      if (!selections.length) return;
      setLearningSaving(true);
      try {
        const current = await getWebFormExtraProfile();
        const values = { ...current.values };
        const details: Record<string, WebFormExtraEntry> = { ...current.details };
        for (const { candidate, reuse } of selections) {
          values[candidate.key] = candidate.value;
          details[candidate.key] = { value: candidate.value, source: "learned", reuse };
        }
        await updateWebFormExtraProfile(values, details);
        setLearning([]);
        message.success(`已记住 ${selections.length} 项，下次遇到同一个框会自动填`);
      } catch (error) {
        // **失败要说出来**：静默关掉弹窗会让用户以为记住了，而下次却没自动填。
        message.error(error instanceof Error ? error.message : "记住失败，请稍后再试");
      } finally {
        setLearningSaving(false);
      }
    },
    [message],
  );

  const handleMemorySubmit = useCallback(
    async (selection: WebFormMemorySelection) => {
      setMemorySaving(true);
      try {
        const result = await rememberWebFormLive(selection);
        setLive(result.live);
        setMemoryDialogOpen(false);
        message.success("已保存到你选择的资料目标，下次可以继续复用");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存资料失败，请稍后重试");
      } finally {
        setMemorySaving(false);
      }
    },
    [message],
  );

  /** 一次采纳全部 AI 建议——默认不勾是为了让"忘了勾"成为默认的失败形态，而不是"悄悄写错"。 */
  const selectAiSuggestions = useCallback(() => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of aiSuggestions) next.add(item.index);
      return next;
    });
  }, [aiSuggestions]);

  const toggle = useCallback((index: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const changeValue = useCallback((index: number, value: string) => {
    setValues((previous) => ({ ...previous, [index]: value }));
  }, []);

  const step = useMemo(() => {
    if (result) return 3;
    if (preview) return 2;
    if (running) return 1;
    return 0;
  }, [preview, result, running]);

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        title="这个功能只负责把资料填进页面，不会替你提交"
        description="填充完成后请回到浏览器窗口逐项核对，确认无误后由你自己点击页面上的提交按钮。"
      />

      <Card size="small" className="webform-browser-card">
        <WebFormBrowserUrlBar
          value={targetUrl}
          history={urlHistory}
          busy={busy === "start"}
          onChange={setTargetUrl}
          onOpen={() => void handleOpenUrl()}
          onSelectHistory={(item) => setTargetUrl(item.url)}
          onDeleteHistory={(item) => void handleDeleteUrlHistory(item)}
        />
        <div className="webform-browser-status-row">
          <div className="webform-browser-status">
            <Tag color={stateMeta.color}>{stateMeta.label}</Tag>
            {browser.loading && !browser.data ? <Spin size="small" /> : null}
            <Typography.Text type="secondary">
              使用独立的网申专用浏览器（不会覆盖投递台或已有网申页面）
            </Typography.Text>
          </div>
          <div className="webform-browser-actions">
            {/* 三个按钮的职责**互不重合**，各管一件事：
                  起停（启动/关闭浏览器）· 配置（浏览器设置）· 重查（刷新状态）。
                设置不回显状态、刷新不改配置、起停只碰进程——所以这里也不该让它们并行。 */}
            {running ? (
              <Tooltip title="停掉这个受控浏览器窗口。里面的登录态会保留，下次启动不用重新登录">
                <Button
                  icon={<StopOutlined />}
                  loading={busy === "stop"}
                  disabled={anyBusy}
                  onClick={handleStop}
                >
                  关闭浏览器
                </Button>
              </Tooltip>
            ) : (
              <Tooltip title="拉起这个受控浏览器窗口（独立于你日常用的浏览器）">
                <Button
                  type="primary"
                  icon={<ChromeOutlined />}
                  aria-label="开启专用浏览器"
                  loading={busy === "start"}
                  disabled={anyBusy}
                  onClick={handleStart}
                >
                  开启专用浏览器
                </Button>
              </Tooltip>
            )}
            <Tooltip title="只改「用哪个浏览器」这类配置，不会启动或关闭它——改完要关掉再启动一次才生效">
              <Button
                icon={<SettingOutlined />}
                disabled={anyBusy}
                onClick={() => setBrowserSettingsOpen(true)}
              >
                浏览器设置
              </Button>
            </Tooltip>
            <Tooltip title="重新读一次运行状态。平时它每 0.6 秒自己会刷；你刚关掉窗口或刚启动时可以用它立刻确认">
              <Button
                icon={<ReloadOutlined />}
                loading={busy === "refresh"}
                disabled={anyBusy}
                onClick={() => void handleRefreshStatus()}
                aria-label="刷新浏览器状态"
              >
                刷新状态
              </Button>
            </Tooltip>
            {running && (sessionActive || live?.running) ? (
              <Tooltip title="结束这一次网申填写：收起面板、不清理资料，下次点「读取当前表单」重来">
                <Button
                  danger
                  loading={busy === "end"}
                  disabled={anyBusy}
                  onClick={() => void handleEndSession()}
                >
                  结束本次填写
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </Card>
      {/* AI 兜底：规则能确定就不调用模型，只有认不出的框才问一次。 */}
      <Card size="small" title="未识别字段智能辅助">
        <Space size="middle" wrap>
          <Switch
            checked={aiOn}
            disabled={aiAvailable !== true}
            onChange={setAiEnabled}
            aria-label="AI 字段识别辅助"
          />
          {aiAvailable === true ? (
            <Typography.Text type="secondary">
              规则未识别的字段，可交由你在「设置」里配置的模型辅助判断。
              <Typography.Text strong>
                只发页面上本来就有的文字与字段名，不发你的资料内容
              </Typography.Text>
              ；命中的行会标上「AI 建议」并且默认不勾选。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              尚未配置大模型，暂时无法使用。到「设置」页填好 Base URL
              与模型名之后，规则认不出的框就能交给 AI 识别。
            </Typography.Text>
          )}
          {live?.running ? (
            <Typography.Text type="warning">改动会在下次「开启」时生效</Typography.Text>
          ) : null}
        </Space>
      </Card>

      {/* 「智能逐项填表」：与上面的「读取当前表单 → 批量填」并存，不是替代。
          它不做预先快照——点到哪个框才现场匹配，所以不存在"页面一联动序号就失效"。 */}
      <Card
        size="small"
        title="智能逐项填表"
        extra={
          <Button
            aria-label={live?.running ? "关闭智能逐项填表" : "开启智能逐项填表"}
            type={live?.running ? "default" : "primary"}
            loading={busy === "live"}
            // `live.running` 为真时后端一定已经开着浏览器（会话起不来会报 409），
            // 所以它可以单独解除禁用：浏览器状态轮询慢半拍时按钮不会白灰着。
            disabled={!running && !live?.running}
            onClick={handleLiveToggle}
          >
            {live?.running ? "关闭" : "开启"}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          开启后回到浏览器窗口，
          <Typography.Text strong>点到哪个框，就在框旁边给出资料里对应的值</Typography.Text>
          ，你点「填入」才写进去。认不出来的时候点
          <Typography.Text strong>「换个资料…」</Typography.Text>
          会列出你填过的全部资料（按分区、可搜索），
          <Typography.Text strong>你自己挑一条填</Typography.Text>
          ——所以不必依赖它认得出这个框。适合逐项核对，也能帮到批量填不了的框。
        </Typography.Paragraph>
        {live?.running ? (
          <Space size="middle" wrap>
            <Tag color={LIVE_STATUS_META[live.status]?.color ?? "processing"}>
              {LIVE_STATUS_META[live.status]?.label ?? "等待你点某个框"}
            </Tag>
            {live.field_label ? (
              <Typography.Text>
                {live.field_label}
                {live.value ? ` → ${live.value}` : ""}
              </Typography.Text>
            ) : null}
            {live.source === "ai" ? <Tag color="blue">AI 建议</Tag> : null}
            {alternatives.length ? (
              <Tooltip
                title={alternatives.map((item) => `${item.label}：${item.value}`).join("\n")}
              >
                <Typography.Text type="secondary">
                  另有 {alternatives.length} 个候选（在浏览器窗口里点选）
                </Typography.Text>
              </Tooltip>
            ) : null}
            {live.note ? <Typography.Text type="secondary">{live.note}</Typography.Text> : null}
            {rememberPending ? (
              <>
                <Tag color="warning">等待选择资料目标</Tag>
                <Button size="small" onClick={() => setMemoryDialogOpen(true)}>
                  选择保存位置
                </Button>
              </>
            ) : null}
            <Typography.Text type="secondary">本次已填 {live.filled} 个</Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">未开启</Typography.Text>
        )}
      </Card>

      <Steps
        size="small"
        current={step}
        items={[
          { title: "启动浏览器" },
          { title: "打开网申页" },
          { title: "核对映射" },
          { title: "填充" },
        ]}
      />

      <Card size="small">
        <Space size="middle" wrap>
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            disabled={!running}
            loading={busy === "read"}
            onClick={handleRead}
          >
            读取当前表单
          </Button>
          <Typography.Text type="secondary">
            先在浏览器窗口里打开网申表单页，停在要填的那一步，再点这里。
          </Typography.Text>
        </Space>
        {snapshot ? (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary">
              已读取：{snapshot.page.title || "（无标题）"} · {snapshot.page.url} · 共{" "}
              {snapshot.page.control_count} 个控件
            </Typography.Text>
          </div>
        ) : null}
      </Card>

      {preview ? (
        <Card
          size="small"
          title={`核对后填充（已选 ${selected.size} / ${preview.items.length} 项）`}
          extra={
            <Space size="small">
              {/* AI 建议默认不勾——失败形态是"我忘了勾"，而不是"悄悄写了个错值"。
                  想一次全采纳，这里点一下就好。 */}
              {aiSuggestions.length ? (
                <Button onClick={selectAiSuggestions} disabled={busy === "fill"}>
                  全选 AI 建议（{aiSuggestions.length}）
                </Button>
              ) : null}
              <Button
                type="primary"
                loading={busy === "fill"}
                disabled={!running || selected.size === 0}
                onClick={handleFill}
              >
                填充到页面
              </Button>
            </Space>
          }
        >
          {preview.items.length ? (
            <WebFormPreviewTable
              items={preview.items}
              selected={selected}
              values={values}
              disabled={busy === "fill"}
              onToggle={toggle}
              onValueChange={changeValue}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可自动填的字段" />
          )}
        </Card>
      ) : null}

      {result ? (
        <Card size="small" title="填充结果">
          <Space size="middle" wrap>
            <Tag color="success">已填 {result.filled}</Tag>
            {result.unverified ? <Tag color="warning">待确认 {result.unverified}</Tag> : null}
            {result.failed ? <Tag color="error">失败 {result.failed}</Tag> : null}
            <FillRateTag filled={result.filled} failed={result.failed} />
          </Space>
          {result.unverified || result.failed ? (
            <ul style={{ marginTop: 8, marginBottom: 0 }}>
              {result.outcomes
                .filter((outcome) => outcome.status === "unverified" || outcome.status === "failed")
                .map((outcome) => (
                  <li key={outcome.index}>
                    <Typography.Text type="secondary">
                      第 {outcome.index + 1} 个控件：{outcome.detail || outcome.status}
                    </Typography.Text>
                  </li>
                ))}
            </ul>
          ) : null}
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            title="请回到浏览器窗口核对，确认无误后由你自己点击提交"
          />
        </Card>
      ) : null}

      {preview ? (
        <Card size="small" title="页面还要求这些">
          <WebFormPendingPanel
            missingData={preview.missing_data}
            unrecognized={preview.unrecognized}
            blocked={preview.blocked}
          />
        </Card>
      ) : null}

      {/* 填充记录：每次填充留一笔，供事后回看"我当时到底填了什么"。
          记录里含真实值（证件号、手机号），所以删除是隐私上的必要项，不是便利。 */}
      <Card size="small" title="填充记录">
        <WebFormRecordsPanel refreshKey={recordRefresh} />
      </Card>

      <BrowserSettingsModal
        open={browserSettingsOpen}
        onClose={() => setBrowserSettingsOpen(false)}
        onSaved={() => void browser.reload()}
      />

      {/* 「要记住吗」的提案。**只在真填进去之后**才可能开（见 handleFill）——一个都没填
          却问"要记住吗"是自相矛盾的。 */}
      <WebFormLearningDialog
        open={learning.length > 0}
        candidates={learning}
        saving={learningSaving}
        onCancel={() => setLearning([])}
        onSubmit={(selections) => void handleRemember(selections)}
      />

      <WebFormMemoryDialog
        open={memoryDialogOpen && Boolean(rememberPending)}
        pending={rememberPending}
        targets={memoryTargets}
        loading={memoryTargetsLoading}
        saving={memorySaving}
        onCancel={() => setMemoryDialogOpen(false)}
        onSubmit={(selection) => void handleMemorySubmit(selection)}
      />
    </Space>
  );
}
