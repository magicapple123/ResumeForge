// SPDX-License-Identifier: Apache-2.0
/**
 * 申请状态回读（R-15 C）的入口：一枚按钮 + 一个「每日自动」开关 + 一个结果抽屉。
 *
 * 为什么自己做分批而不是让后端一次跑完：抓门户是串行阻塞 IO（门户有限速），
 * 一次几十条会让请求挂到超时，失败时也说不清卡在哪一条。这里每批 8 条、
 * 最多 6 批，按钮上直接显示「正在回读 12/30」，中途失败只影响当前批。
 */
import { SyncOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProbeSettings,
  probeDaily,
  probePage,
  probeTracks,
  saveProbeSettings,
  type TrackProbeItem,
  type TrackProbeSettings,
} from "../../api/tracker";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { ACTIVE_TRACK_STATUSES, type Track } from "../../types/tracker";

/** 每批条数：与后端 `MAX_PROBE_PER_RUN` 一致。 */
const BATCH = 8;
/** 一次最多刷多少批（48 条）：再多的部分提示用户下次再刷，避免按钮转好几分钟。 */
const MAX_ROUNDS = 6;

type Outcome = TrackProbeItem["outcome"];

const OUTCOME_COLOR: Record<Outcome, string> = {
  changed: "green",
  unchanged: "default",
  skipped: "orange",
  failed: "red",
};

/** 结果标签用静态映射：`t()` 的键是字面量联合，拼出来的字符串过不了类型检查。 */
const OUTCOME_LABEL: Record<Outcome, () => string> = {
  changed: () => t("trackProbe.outcome.changed"),
  unchanged: () => t("trackProbe.outcome.unchanged"),
  skipped: () => t("trackProbe.outcome.skipped"),
  failed: () => t("trackProbe.outcome.failed"),
};

interface ProbeButtonProps {
  /** 当前列表里的记录：只挑「进行中」的去回读。 */
  tracks: Track[];
  /** 有记录真的变了才调用（刷新列表与统计）。 */
  onRefreshed: () => void;
}

export default function ProbeButton({ tracks, onRefreshed }: ProbeButtonProps) {
  useLocale();
  const { message } = App.useApp();
  const [settings, setSettings] = useState<TrackProbeSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [items, setItems] = useState<TrackProbeItem[]>([]);
  const [resultOpen, setResultOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieDraft, setCookieDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  /** 用户在「配置 Cookie」之前想做的事，保存后接着做。 */
  const pending = useRef<"manual" | "enable" | null>(null);
  const dailyTried = useRef(false);

  const activeIds = useMemo(
    () =>
      tracks.filter((track) => ACTIVE_TRACK_STATUSES.includes(track.status)).map((row) => row.id),
    [tracks],
  );

  useEffect(() => {
    void getProbeSettings()
      .then(setSettings)
      .catch(() => {
        // 设置读不到不影响手动回读，按钮仍然可用。
      });
  }, []);

  const openSettings = useCallback(() => {
    setPageDraft(settings?.page_url ?? "");
    setCookieOpen(true);
  }, [settings]);

  /**
   * 手动回读一批。
   *
   * `known` 是"刚保存完、state 还没重渲染"的设置；`force` 表示用户在看不懂
   * 登录态的情况下选择"先用公开页试一次"——两者都是为了不落回同一个弹层。
   */
  const runManual = useCallback(
    async (options: { known?: TrackProbeSettings; force?: boolean } = {}) => {
      if (running) return;
      if (activeIds.length === 0) {
        message.info(t("trackProbe.empty"));
        return;
      }
      const current = options.known ?? settings ?? (await getProbeSettings().catch(() => null));
      if (!options.force && current && !current.has_cookie) {
        pending.current = "manual";
        openSettings();
        return;
      }
      const targets = activeIds.slice(0, BATCH * MAX_ROUNDS);
      setRunning(true);
      setProgress({ done: 0, total: targets.length });
      const collected: TrackProbeItem[] = [];
      try {
        // 配了「投递记录页」就先读那一页：一次请求能覆盖所有公司。
        // 页面上没找到的（skipped）再逐条读岗位页——两条路互不替代。
        let remaining = targets;
        const pageUrl = (current?.page_url ?? "").trim();
        if (pageUrl) {
          const pageResult = await probePage(pageUrl, targets);
          collected.push(...pageResult.items);
          setProgress({ done: collected.length, total: targets.length });
          const settled = new Set(
            pageResult.items
              .filter((item) => item.outcome !== "skipped")
              .map((item) => item.track_id),
          );
          remaining = targets.filter((id) => !settled.has(id));
        }
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const slice = remaining.slice(round * BATCH, (round + 1) * BATCH);
          if (slice.length === 0) break;
          const result = await probeTracks(slice, BATCH);
          collected.push(...result.items);
          setProgress({ done: collected.length, total: targets.length });
          if (slice.length < BATCH) break;
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("trackProbe.failed"));
        // 已经读到的那部分照样给用户看：一半结果比一条都不给有用。
        if (collected.length > 0) {
          setItems(collected);
          setResultOpen(true);
        }
        setRunning(false);
        return;
      }
      setRunning(false);
      setItems(collected);
      setResultOpen(true);
      const changed = collected.filter((item) => item.outcome === "changed").length;
      if (changed > 0) {
        onRefreshed();
        message.success(t("trackProbe.done", { count: changed }));
      } else {
        message.info(t("trackProbe.noChange"));
      }
    },
    [activeIds, message, onRefreshed, openSettings, running, settings],
  );

  const toggleAuto = useCallback(
    async (checked: boolean, known?: TrackProbeSettings | null) => {
      const current = known ?? settings;
      if (checked && current && !current.has_cookie) {
        pending.current = "enable";
        openSettings();
        return;
      }
      try {
        setSettings(await saveProbeSettings({ enabled: checked }));
        message.success(checked ? t("trackProbe.autoOn") : t("trackProbe.autoOff"));
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("trackProbe.failed"));
      }
    },
    [message, openSettings, settings],
  );

  const submitSettings = useCallback(async () => {
    const payload: { cookie?: string; page_url?: string } = {};
    const cookie = cookieDraft.trim();
    // 只提交填了的 Cookie：空着表示"不动"，否则只改记录页也会把登录态清掉。
    if (cookie) payload.cookie = cookie;
    const pageUrl = pageDraft.trim();
    if (pageUrl !== (settings?.page_url ?? "")) payload.page_url = pageUrl;
    try {
      const next = await saveProbeSettings(payload);
      setSettings(next);
      setCookieOpen(false);
      setCookieDraft("");
      const action = pending.current;
      pending.current = null;
      if (action === "enable") await toggleAuto(true, next);
      if (action === "manual") await runManual({ known: next });
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("trackProbe.failed"));
    }
  }, [cookieDraft, message, pageDraft, runManual, settings, toggleAuto]);

  // 每日自动补算：后端只认「开关开 + 有 Cookie + 距上次超过间隔」，
  // 前端不再判断时间，打开进度页问一次即可（与今日简报同一套懒补算）。
  useEffect(() => {
    if (!settings || dailyTried.current) return;
    dailyTried.current = true;
    if (!settings.due) return;
    void (async () => {
      try {
        const result = await probeDaily();
        if (result.ran && result.changed > 0) {
          message.info(t("trackProbe.dailyChanged", { count: result.changed }));
          setItems(result.items);
          setResultOpen(true);
          onRefreshed();
        }
      } catch {
        // 自动补算失败不打扰：用户点一下按钮就能看到失败原因。
      }
    })();
  }, [message, onRefreshed, settings]);

  const failed = items.filter((item) => item.outcome === "failed").length;
  const skipped = activeIds.length - Math.min(activeIds.length, BATCH * MAX_ROUNDS);

  return (
    <>
      <Space size={6}>
        <Tooltip title={t("trackProbe.manualHint")}>
          <Button
            icon={<SyncOutlined spin={running} />}
            onClick={() => void runManual()}
            disabled={running}
          >
            {running
              ? t("trackProbe.running", { done: progress.done, total: progress.total })
              : t("trackProbe.action")}
          </Button>
        </Tooltip>
        <Tooltip title={t("trackProbe.autoHint", { hours: settings?.interval_hours ?? 20 })}>
          <Space size={4}>
            <Switch
              size="small"
              checked={Boolean(settings?.enabled)}
              onChange={(checked) => void toggleAuto(checked)}
              aria-label={t("trackProbe.auto")}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("trackProbe.auto")}
            </Typography.Text>
          </Space>
        </Tooltip>
      </Space>

      <Modal
        open={cookieOpen}
        width={520}
        title={t("trackProbe.settingsTitle")}
        onCancel={() => {
          pending.current = null;
          setCookieOpen(false);
        }}
        footer={[
          <Button
            key="public"
            onClick={() => {
              pending.current = null;
              setCookieOpen(false);
              void runManual({ force: true });
            }}
          >
            {t("trackProbe.cookieSkip")}
          </Button>,
          <Button
            key="cancel"
            onClick={() => {
              pending.current = null;
              setCookieOpen(false);
            }}
          >
            {t("common.action.cancel")}
          </Button>,
          <Button key="ok" type="primary" onClick={() => void submitSettings()}>
            {t("trackProbe.cookieSave")}
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t("trackProbe.pageUrlHint")}
        </Typography.Paragraph>
        <Input
          value={pageDraft}
          onChange={(event) => setPageDraft(event.target.value)}
          placeholder={t("trackProbe.pageUrlExample")}
          aria-label={t("trackProbe.pageUrl")}
          style={{ marginBottom: 12 }}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t("trackProbe.cookieHint")}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={cookieDraft}
          onChange={(event) => setCookieDraft(event.target.value)}
          placeholder={t("trackProbe.cookieExample")}
          aria-label={t("trackProbe.cookieTitle")}
        />
      </Modal>

      <Drawer
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        size="min(520px, 100vw)"
        title={t("trackProbe.resultTitle")}
      >
        <List
          size="small"
          dataSource={items}
          locale={{ emptyText: t("trackProbe.empty") }}
          renderItem={(item) => (
            <List.Item>
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                <Space size={6} wrap>
                  <Tag color={OUTCOME_COLOR[item.outcome]}>{OUTCOME_LABEL[item.outcome]()}</Tag>
                  <Typography.Text strong>
                    {item.company} · {item.title}
                  </Typography.Text>
                </Space>
                {item.outcome === "changed" ? (
                  <Space size={4}>
                    <Typography.Text delete type="secondary">
                      {item.before_label}
                    </Typography.Text>
                    <Typography.Text type="secondary">→</Typography.Text>
                    <Typography.Text strong>{item.after_label}</Typography.Text>
                  </Space>
                ) : null}
                {item.note ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.note}
                  </Typography.Text>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
        {skipped > 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            {t("trackProbe.partial", { rest: skipped })}
          </Typography.Paragraph>
        ) : null}
        {failed > 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            {t("trackProbe.failedHint", { count: failed })}
          </Typography.Paragraph>
        ) : null}
        {settings && !settings.has_cookie ? (
          <Button size="small" onClick={openSettings} style={{ marginTop: 8 }}>
            {t("trackProbe.cookieAction")}
          </Button>
        ) : null}
      </Drawer>
    </>
  );
}
