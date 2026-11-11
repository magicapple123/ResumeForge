// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台：投递队列、自动采集、执行进度与投递记录。
 *
 * 页面只负责编排（谁在跑、把任务交给进度面板），具体交互拆在 `components/apply/` 下的子组件里。
 * 执行采用**轮询**模型：`useTaskPolling` 按 1.5s 拉取批次详情，任务进入终态后自动停止。
 */
import { InfoCircleOutlined, SettingOutlined } from "@ant-design/icons";
import { App, Button, Space, Tabs, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  getCollectTaskDetail,
  getCurrentTask,
  getTaskDetail,
  pauseTask,
  resumeTask,
  stopTask,
} from "../api/apply";
import ReferralPanel from "../components/ReferralPanel";
import ApplyProgressPanel from "../components/apply/ApplyProgressPanel";
import ApplyFunnelBar, { type FunnelDrill } from "../components/apply/ApplyFunnelBar";
import ApplyQueuePanel from "../components/apply/ApplyQueuePanel";
import ApplyRecordsPanel from "../components/apply/ApplyRecordsPanel";
import ApplySettingsModal from "../components/apply/ApplySettingsModal";
import BrowserStatusBar from "../components/apply/BrowserStatusBar";
import CollectPanel from "../components/apply/CollectPanel";
import CollectRecordsPanel from "../components/apply/CollectRecordsPanel";
import CurrentSiteBar from "../components/apply/CurrentSiteBar";
import { isActiveTaskStatus, useTaskPolling } from "../hooks/useTaskPolling";
import { formatErrorGuidance } from "../api/errorGuidance";
import type { ApplyTask } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 投递台的页签 key：URL ?tab= 的合法值域（白名单外回落 queue，不让 Tabs 激活态落空）。 */
const APPLY_TAB_KEYS = ["queue", "collect", "collect-records", "records", "referrals"];

export default function ApplyPage() {
  useLocale();
  const { message } = App.useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [task, setTask] = useState<ApplyTask | null>(null);
  const [busy, setBusy] = useState(false);

  // 页签 URL 状态化（与岗位广场的筛选/分页同模式）：采集结果里的「去投递队列查看」
  // navigate("/apply?tab=queue") 才能真正切页签——此前 tab 只在内存里，URL 参数无人解析，
  // 从采集结果点过去毫无反应。无 query 默认 queue（保持既有 URL 形态）；切页签用
  // replace 写回且只动 tab 参数，不把每次切换压进历史栈、也不误伤其它 query。
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = tabParam && APPLY_TAB_KEYS.includes(tabParam) ? tabParam : "queue";
  const setTab = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === "queue") nextParams.delete("tab");
          else nextParams.set("tab", next);
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // 首屏恢复：应用重启或切页回来时，若仍有进行中的投递任务，直接接着显示进度。
  useEffect(() => {
    let cancelled = false;
    void getCurrentTask()
      .then((current) => {
        if (!cancelled && current) setTask(current);
      })
      .catch(() => {
        /* 没有进行中的任务或接口不可用时静默即可，不打断页面 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDetail = useCallback(
    (taskId: number) =>
      task?.kind === "collect" ? getCollectTaskDetail(taskId) : getTaskDetail(taskId),
    [task?.kind],
  );

  const { detail, error, refresh, notFound } = useTaskPolling(fetchDetail, task?.id ?? null);

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const status = detail?.status ?? task?.status;
  const running = status ? isActiveTaskStatus(status) : false;
  const collectRefreshKey =
    task?.kind === "collect"
      ? `${task.id}-${detail?.status ?? task.status}-${detail?.finished_at ?? ""}`
      : "";

  const control = async (action: "pause" | "resume" | "stop") => {
    if (!task) return;
    setBusy(true);
    try {
      const handler = action === "pause" ? pauseTask : action === "resume" ? resumeTask : stopTask;
      const updated = await handler(task.id);
      setTask(updated);
      await refresh();
    } catch (err) {
      // 兜底不再是「操作失败」：暂停/继续/停止都是同一个入口，失败时统一给
      // 「原因 · 建议 · 编号」，用户能照「建议」重试（§4.6）。
      message.error(formatErrorGuidance(err, t("pagesMisc.applyPage.error.controlFailed")));
    } finally {
      setBusy(false);
    }
  };

  const adoptTask = (created: ApplyTask) => setTask(created);

  /**
   * #14F 漏斗下钻：三个执行量维度切到「投递记录」并带上结果筛选；「面试中」来自求职进度，
   * 没有对应的投递记录筛选，直接去 `/tracker`——不做一条点了没反应的假联动。
   */
  const [recordsPreset, setRecordsPreset] = useState<{ result: string; nonce: number }>({
    result: "",
    nonce: 0,
  });
  const navigate = useNavigate();
  const drillFunnel = (drill: FunnelDrill) => {
    if (drill === "interviewing") {
      navigate("/tracker");
      return;
    }
    const result = drill === "succeeded" ? "success" : drill === "failed" ? "failed" : "";
    setRecordsPreset((previous) => ({ result, nonce: previous.nonce + 1 }));
    setTab("records");
  };

  return (
    <div className="apply-page">
      {/* #14G 第二版：标题与副标题原先竖排成 90px（副标题两行），实测把首屏表格挤到 2 行。
          现在标题单行、副标题收进标题旁的「?」（真要读的人点一下就有），漏斗与设置同排。 */}
      <div className="apply-page-head">
        <Space size={6} align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("pagesMisc.applyPage.title")}
          </Typography.Title>
          <Tooltip title={t("pagesMisc.applyPage.subtitle")}>
            <Button
              type="text"
              size="small"
              icon={<InfoCircleOutlined />}
              aria-label={t("pagesMisc.applyPage.subtitleAria")}
            />
          </Tooltip>
        </Space>
        {/* 右侧一行：当前站点 + 最近 7 天执行量 + 设置。
            站点行原本是页头的兄弟块（再吃 22px + 4px 间距），并入同排后首屏多一行表格。 */}
        <Space size={12} align="center" wrap={false}>
          <CurrentSiteBar refreshKey={collectRefreshKey} />
          <ApplyFunnelBar onDrill={drillFunnel} />
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            {t("pagesMisc.applyPage.action.settings")}
          </Button>
        </Space>
      </div>

      <BrowserStatusBar />

      {/* 采集批次的状态卡放在「自动采集」页签里、紧挨本次采集结果（用户实测：分离在
          页面顶部时，正在跑的状态和结果离得太远）；投递批次保持在页面顶部。 */}
      {detail && task?.kind !== "collect" && (
        <ApplyProgressPanel
          task={detail}
          busy={busy}
          onPause={() => void control("pause")}
          onResume={() => void control("resume")}
          onStop={() => void control("stop")}
        />
      )}
      {!detail && task && !notFound && (
        <Typography.Paragraph type="secondary">
          {t("pagesMisc.applyPage.progress.loading")}
        </Typography.Paragraph>
      )}
      {/* 任务记录已经不存在（被清理 / 后端重启）时如实说明并给「重试」——否则这里会
          永远停在「正在读取任务进度…」，看起来像卡死。 */}
      {!detail && task && notFound && (
        <Space orientation="vertical" size={4} style={{ marginBottom: 8 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t("pagesMisc.applyPage.progress.notFound")}
          </Typography.Paragraph>
          <Button size="small" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </Space>
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "queue",
            label: t("pagesMisc.applyPage.tab.queue"),
            children: <ApplyQueuePanel disabled={running} onStarted={adoptTask} />,
          },
          {
            key: "collect",
            label: t("pagesMisc.applyPage.tab.collect"),
            // 进入应用就预渲染（并开始读采集配置与站点筛选清单）：等用户切到这个
            // 页签时筛选项已经就位，不会看到"筛选区还没加载出来"的空窗。
            forceRender: true,
            children: (
              <CollectPanel
                disabled={running}
                onStarted={adoptTask}
                collectTask={task?.kind === "collect" ? detail : null}
                progress={
                  detail && task?.kind === "collect" ? (
                    <ApplyProgressPanel
                      task={detail}
                      busy={busy}
                      onPause={() => void control("pause")}
                      onResume={() => void control("resume")}
                      onStop={() => void control("stop")}
                    />
                  ) : undefined
                }
              />
            ),
          },
          {
            key: "collect-records",
            label: t("pagesMisc.applyPage.tab.collectRecords"),
            // 刷新键拼上"完成时间"：采集一结束它就会变，于是记录页签自己重新拉一次，
            // 不必让用户手动刷新去看刚跑完的那一次。
            children: (
              <CollectRecordsPanel
                disabled={running}
                refreshKey={`${task?.id ?? 0}-${detail?.status ?? ""}-${detail?.finished_at ?? ""}`}
              />
            ),
          },
          {
            key: "records",
            label: t("pagesMisc.applyPage.tab.records"),
            children: (
              <ApplyRecordsPanel
                disabled={running}
                onRetried={adoptTask}
                presetResult={recordsPreset.result}
                presetNonce={recordsPreset.nonce}
              />
            ),
          },
          {
            key: "referrals",
            label: t("pagesMisc.applyPage.tab.referrals"),
            // 关联岗位/漏斗下拉由内推面板内部远程搜索（P0-1），页面不再预拉选项。
            children: <ReferralPanel />,
          },
        ]}
      />

      <ApplySettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
