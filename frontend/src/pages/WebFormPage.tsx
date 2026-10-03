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
import { Alert, App, Card, Space } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDiagnostics } from "../api/system";
import { clientDiagnosticSnapshot } from "../utils/clientDiagnostics";
import {
  fillWebForm,
  getWebFormBrowserStatus,
  getWebFormExtraProfile,
  listWebFormUrlHistory,
  deleteWebFormUrlHistory,
  openWebFormUrl,
  previewWebForm,
  rememberWebFormLive,
  setWebFormLiveEnabled,
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
import WebFormRecordsPanel from "../components/webform/WebFormRecordsPanel";
import { useBrowserStatus } from "../hooks/useBrowserStatus";
import { AiAssistCard } from "./webform/AiAssistCard";
import { BrowserControlCard } from "./webform/BrowserControlCard";
import { FillResultCard } from "./webform/FillResultCard";
import { LiveModeCard } from "./webform/LiveModeCard";
import { PreviewCard } from "./webform/PreviewCard";
import { ReadSnapshotCard } from "./webform/ReadSnapshotCard";
import { WEB_FORM_STATUS_POLL_INTERVAL_MS } from "./webform/constants";
import { useAiAvailable } from "./webform/useAiAvailable";
import { useLiveSession } from "./webform/useLiveSession";
import { useSnapshotUrl } from "./webform/useSnapshotUrl";
import {
  type WebFormExtraEntry,
  type WebFormFillResult,
  type WebFormLearningCandidate,
  type WebFormPreview,
  type WebFormSnapshot,
  type WebFormUrlHistory,
} from "../types";

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
    "start" | "read" | "fill" | "stop" | "end" | "live" | "refresh" | "diagnostics" | null
  >(null);
  // 浏览器那几个按钮共用这一个 busy：**任何一个在跑，其余的都禁用**。
  // 它们职责分得开（起停 / 配置 / 重查），但都围绕同一个浏览器进程——并行点开只会让
  // "关闭还没回来就点了启动"这类交错更难对上账。
  const anyBusy = busy !== null;
  // 填充完成后加一，「填充记录」据此重新拉取。
  const [recordRefresh, setRecordRefresh] = useState(0);
  // 「这次填的几项简历通里没有，要记住吗」的提案；空数组 = 不弹。
  const [learning, setLearning] = useState<WebFormLearningCandidate[]>([]);
  const [learningSaving, setLearningSaving] = useState(false);
  const [browserSettingsOpen, setBrowserSettingsOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [urlHistory, setUrlHistory] = useState<WebFormUrlHistory[]>([]);
  const aiAvailable = useAiAvailable();
  const [aiEnabled, setAiEnabled] = useState(restoredSession.aiEnabled);

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

  const { rememberSnapshot, forgetSnapshot, setRestoring } = useSnapshotUrl({
    aiAvailable,
    restoredSessionPreview: restoredSession.preview,
    applyPreview,
    setSnapshot,
    setBusy,
    message,
  });

  const running = browser.data?.state === "running";
  // 没配模型时开关不起作用——**说清楚**，否则用户开了却毫无变化，只会以为功能坏了。
  const aiOn = aiEnabled && aiAvailable === true;
  const aiSuggestions = useMemo(
    () => (preview?.items ?? []).filter((item) => item.source === "ai"),
    [preview],
  );

  const {
    live,
    setLive,
    liveOptOut,
    setLiveOptOut,
    rememberPending,
    memoryTargets,
    memoryTargetsLoading,
    memorySaving,
    setMemorySaving,
    memoryDialogOpen,
    setMemoryDialogOpen,
  } = useLiveSession({
    restoredLiveOptOut: restoredSession.liveOptOut,
    browserState: browser.data?.state,
    running,
    aiAvailable,
    aiOn,
    setSessionActive,
    message,
  });

  const liveEnabled = live?.enabled ?? live?.running ?? false;
  // 后端没重启时这两个字段还不存在（它们是这一次新加的）。用 `?? []` 兜住，
  // 让"前端先更新、后端还没重启"这个窗口期表现成少显示一行，而不是整页白屏。
  const alternatives = live?.alternatives ?? [];

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

  const handleExportDiagnostics = useCallback(async () => {
    setBusy("diagnostics");
    try {
      let snapshot;
      try {
        snapshot = await getDiagnostics();
      } catch {
        snapshot = {
          generated_at: new Date().toISOString(),
          app_version: "unknown",
          events: [],
        };
      }
      const payload = { ...snapshot, frontend_events: clientDiagnosticSnapshot() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `resumeforge-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success("已导出脱敏诊断信息，可连同截图提交排查");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出诊断信息失败");
    } finally {
      setBusy(null);
    }
  }, [message]);





  const handleLiveToggle = useCallback(async () => {
    setBusy("live");
    try {
      setSessionActive(true);
      const next = live?.running
        ? await setWebFormLiveEnabled(!liveEnabled)
        : await startWebFormLive(aiOn);
      setLive(next ?? null);
      setLiveOptOut(false);
      message.success(
        (next?.enabled ?? next?.running)
          ? "已开启。回到浏览器窗口，点到哪个框就在旁边给你要填的值"
          : "已关闭，悬浮球保留为灰色，页面不会再显示提示卡",
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "切换点击填表失败");
    } finally {
      setBusy(null);
    }
  }, [aiOn, live?.running, liveEnabled, message]);

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

      <BrowserControlCard
        targetUrl={targetUrl}
        onChangeTargetUrl={setTargetUrl}
        urlHistory={urlHistory}
        onDeleteHistory={(item) => void handleDeleteUrlHistory(item)}
        busy={busy}
        running={running}
        sessionActive={sessionActive}
        liveRunning={live?.running}
        browserLoading={browser.loading}
        browserHasData={Boolean(browser.data)}
        browserState={browser.data?.state}
        onStart={handleStart}
        onStop={handleStop}
        onOpenUrl={handleOpenUrl}
        onOpenBrowserSettings={() => setBrowserSettingsOpen(true)}
        onRefreshStatus={handleRefreshStatus}
        onExportDiagnostics={handleExportDiagnostics}
        onEndSession={handleEndSession}
      />
      {/* AI 兜底：规则能确定就不调用模型，只有认不出的框才问一次。 */}
      <AiAssistCard
        aiOn={aiOn}
        aiAvailable={aiAvailable}
        liveRunning={live?.running}
        onAiEnabledChange={setAiEnabled}
      />

      {/* 「智能逐项填表」：与上面的「读取当前表单 → 批量填」并存，不是替代。
          它不做预先快照——点到哪个框才现场匹配，所以不存在"页面一联动序号就失效"。 */}
      <LiveModeCard
        live={live}
        liveEnabled={liveEnabled}
        running={running}
        busy={busy}
        rememberPending={rememberPending}
        alternatives={alternatives}
        onToggle={handleLiveToggle}
        onRequestMemoryDialog={() => setMemoryDialogOpen(true)}
      />

      <ReadSnapshotCard
        step={step}
        running={running}
        busy={busy}
        snapshot={snapshot}
        onRead={handleRead}
      />

      {preview ? (
        <PreviewCard
          preview={preview}
          selected={selected}
          values={values}
          aiSuggestions={aiSuggestions}
          busy={busy}
          running={running}
          onSelectAiSuggestions={selectAiSuggestions}
          onFill={handleFill}
          onToggle={toggle}
          onValueChange={changeValue}
        />
      ) : null}

      {result ? (
        <FillResultCard result={result} />
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
