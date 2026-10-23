// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「简历字体」里的**内置字体**一行：思源黑体，按需下载。
 *
 * ## 为什么内置字体也要"按需下载"
 *
 * 一款完整的中文字体 30MB 上下。打进安装包会让所有用户为它付体积，而大部分人的系统字体
 * 已经够用。所以它随应用**登记**（永远出现在列表第 1 位，用户删不掉），但文件在第一次用到
 * 时才下载。界面上必须把体积与来源写清楚——用户点「下载」前有权知道要拉多大、能不能商用。
 *
 * ## 四种状态，一个来源
 *
 * `state` 是唯一的状态源（`idle` / `downloading` / `failed` / `done`），`downloaded` 只是
 * 它的派生快照。`POST .../builtin/download` 是**异步启动**：立即返回 `downloading`，进度靠
 * 轮询这一行的 `GET .../builtin` 读 `downloaded_bytes / total_bytes`。轮询只在 `downloading`
 * 期间存在——定时器在卸载/状态离开下载中时**必须被清掉**，否则关掉设置页还在打接口。
 *
 * ## 只在这**一次**下载成功后自动设为当前
 *
 * 下完就要能用：如果让用户再去列表里找一次「设为当前」，多数人会以为没生效。但
 * "每次挂载都自动设一次"等于把用户后来手动换掉的字体默默改回来——所以只在
 * **本次点击触发的下载**走到 `done` 时设一次（`pendingRef` 就是这条一次性标记）。
 */
import { App, Button, Space, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateResumeFont,
  getBuiltinFont,
  listResumeFonts,
  startBuiltinFontDownload,
  type BuiltinFontStatus,
} from "../../api/settings";
import { t } from "../../i18n";

/**
 * 内置字体下载后的**磁盘文件名**：与后端落盘的名字逐字一致。
 *
 * 这个常量只在"下载完成后自动设为当前"用一次（`PUT /settings/fonts/active` 要的是文件名，
 * 不是 `id`）。后端改这个名字必须同步改这里，否则自动设当前会失败——所以它导出给测试钉住。
 */
export const BUILTIN_FONT_FILE = "SourceHanSansSC-Regular.otf";

/**
 * 轮询间隔。后端按块写文件，500ms 足以让进度看起来是连续的，又不会把设置页打成刷屏；
 * 下载 32MB 大约几秒到几十秒，这个频率下最多几十次请求。
 */
const POLL_INTERVAL_MS = 500;

/**
 * 字节 → 人类可读。与 `ResumeFontCard` 里那份**逐字相同**，但刻意各留一份：
 * 那个文件要 import 本组件，本组件再从它那里 import 工具函数就构成循环依赖。
 */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 「约 32 MB」这种**预估**体积：取整到 MB。
 *
 * 与 `formatSize` 分开：下载进度要精确到 0.1MB（31.9 / 32.0 的差别是"还在走"的证据），
 * 而"点了要下多大"这种预估只需要一个整数——写「约 31.9 MB」既不好读也假装精确。
 */
function formatApproxSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

interface Props {
  /** 内置字体当前状态；`null` = 没拿到（老后端没有这个接口），此时整行不渲染。 */
  status: BuiltinFontStatus | null;
  /** 状态变化后请父组件重拉字体清单（下载完成后列表里会多出这一款）。 */
  onChanged: () => void;
}

export default function BuiltinFontRow({ status, onChanged }: Props) {
  const { message } = App.useApp();
  /**
   * 本地覆盖值：轮询读到的状态放这里，`override ?? status` 就是当前值。
   *
   * 不用 effect 把 prop 同步进 state（那会在父组件每次重拉时多一轮渲染），也不把轮询结果
   * 直接写回父组件（父组件重拉的是字体清单，与"那个大文件下到哪了"不是一件事）。
   */
  const [override, setOverride] = useState<BuiltinFontStatus | null>(null);
  /** 本次下载是否还要"下载完成后自动设为当前"。只有用户点了「下载」/「重试」才置 true。 */
  const pendingRef = useRef(false);
  /** POST 直接失败（409 正在下载 / 507 磁盘满）的原因：此时 `state` 还停在 idle。 */
  const [startError, setStartError] = useState("");
  const [activating, setActivating] = useState(false);

  const current = override ?? status;

  /** 把一款内置字体设为**全局**当前字体（`PUT /settings/fonts/active`）。 */
  const activate = useCallback(
    async (successText: string) => {
      setActivating(true);
      try {
        await activateResumeFont(BUILTIN_FONT_FILE);
        message.success(successText);
      } catch (error) {
        message.error(error instanceof Error ? error.message : t("fonts.builtin.activate-failed"));
      } finally {
        setActivating(false);
        // 无论成没成都要重拉清单：失败时"当前字体"仍是旧的，界面得如实反映。
        onChanged();
      }
    },
    [message, onChanged],
  );

  /**
   * 本次下载刚刚完成时的收尾：**判断该不该接管"当前字体"，再设一次**。
   *
   * 为什么要先读一次清单：如果用户本来就用着自己导入的字体（`active` 是另一个文件名），
   * 那是他明确选过的偏好，一次下载把它换掉就是"我明明选了字体"。后端在
   * `_ensure_active` 里做了同一条判断，这里读清单是为了**界面与后端给出同一个结论**，
   * 也为了让成功提示说实话（"已设为当前" vs "已下载"）。
   *
   * 读不到清单（老后端/接口抖动）时按"没有别的选择"处理：下载完却什么也没生效，
   * 比多设一次当前更像故障。
   */
  const finishDownload = useCallback(async () => {
    let keptUserChoice: boolean;
    try {
      const fonts = await listResumeFonts();
      keptUserChoice = fonts.active !== null && fonts.active !== BUILTIN_FONT_FILE;
    } catch {
      keptUserChoice = false;
    }
    if (keptUserChoice) {
      message.success(t("fonts.builtin.download-success"));
      onChanged();
      return;
    }
    await activate(t("fonts.builtin.activate-success"));
  }, [activate, message, onChanged]);

  const downloadState = current?.state ?? "idle";

  // 轮询只在下载中存续。`clearInterval` 在清理函数里，卸载/关闭/切走都会停。
  useEffect(() => {
    if (downloadState !== "downloading") return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getBuiltinFont();
          if (cancelled) return;
          setOverride(next);
          // 这一次下载刚走到 done：自动设为当前，且**只设这一次**（清掉一次性标记）。
          if (next.state === "done" && pendingRef.current) {
            pendingRef.current = false;
            await finishDownload();
          }
        } catch {
          // 轮询偶发失败不打断下载：状态与进度原地不动，下一拍再读。
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [downloadState, finishDownload]);

  /** 启动下载（也用于失败后的「重试」：两条路径完全同一件事）。 */
  const start = useCallback(async () => {
    setStartError("");
    pendingRef.current = true;
    try {
      setOverride(await startBuiltinFontDownload());
    } catch (error) {
      // 409「字体正在下载中」/ 507「磁盘空间不足」都是"这次没开始"，把后端那句人话放进失败态，
      // 让用户看见原因而不是一个静默的按钮。
      pendingRef.current = false;
      setStartError(error instanceof Error ? error.message : "");
    }
  }, []);

  // 没拿到状态整行不渲染：老后端没有这个接口时，设置页其余部分照常可用。
  if (!current) return null;

  const total = current.total_bytes > 0 ? current.total_bytes : current.size_total;
  // 预估体积（取整到 MB）用于"点了要下多大"，进度用精确值（见两个 formatter 的分工）。
  const sizeText = formatApproxSize(total);
  const name = current.label || t("fonts.builtin.name");
  const downloading = downloadState === "downloading";
  const downloaded = downloadState === "done" || current.downloaded;
  const failureReason = startError || current.error;
  const failed = startError !== "" || downloadState === "failed";

  const progressText =
    current.total_bytes > 0
      ? t("fonts.builtin.downloading-with-total", {
          done: formatSize(current.downloaded_bytes),
          total: sizeText,
        })
      : t("fonts.builtin.downloading", { done: formatSize(current.downloaded_bytes) });

  return (
    <div style={{ marginBottom: 8 }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Space>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary">
            {t("fonts.builtin.approx-size", { size: sizeText })}
          </Typography.Text>
          {downloaded && !downloading ? (
            <Tag color="green">{t("fonts.builtin.downloaded")}</Tag>
          ) : null}
        </Space>
        {downloading ? (
          <Button size="small" loading disabled>
            {progressText}
          </Button>
        ) : failed ? (
          <Button size="small" onClick={() => void start()}>
            {t("fonts.builtin.retry")}
          </Button>
        ) : downloaded ? (
          <Button
            size="small"
            loading={activating}
            onClick={() => void activate(t("fonts.builtin.activate-ok"))}
          >
            {t("fonts.builtin.activate")}
          </Button>
        ) : (
          <Tooltip title={t("fonts.builtin.source-tooltip")}>
            <Button
              size="small"
              aria-label={t("fonts.builtin.download-aria", { size: sizeText })}
              onClick={() => void start()}
            >
              {t("fonts.builtin.download")}
            </Button>
          </Tooltip>
        )}
      </Space>
      {failed ? (
        <Typography.Paragraph type="danger" style={{ margin: "4px 0 0", fontSize: 12 }}>
          {failureReason
            ? t("fonts.builtin.failed", { error: failureReason })
            : t("fonts.builtin.failed-unknown")}
        </Typography.Paragraph>
      ) : null}
    </div>
  );
}
