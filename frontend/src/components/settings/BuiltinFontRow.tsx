// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「简历字体」里的**内置字体**一行：思源黑体，按需下载 / 取消 / 删除。
 *
 * ## 为什么内置字体也要"按需下载"
 *
 * 一款完整的中文字体 30MB 上下。打进安装包会让所有用户为它付体积，而大部分人的系统字体
 * 已经够用。所以它随应用**登记**（永远出现在列表第 1 位），但文件在第一次用到时才下载。
 * 界面上必须把体积与来源写清楚——用户点「下载」前有权知道要拉多大、能不能商用。
 *
 * ## 轮询与"只设一次当前"都搬进了 `useBuiltinFontDownload`
 *
 * 2026-11 起制作台的字体下拉也能直接下载同一款字体，两处各写一份轮询迟早有一处漏清
 * 定时器、或者两处的"下完之后做什么"漂成两种行为。本组件现在只负责**设置页的策略**：
 *
 * - 下完只在"用户没有别的选择"时接管全局当前字体（`finishDownload`）；
 * - 已下载时给出「删除」，二次确认正文由 `fontDownload.deleteConfirmBody` 提供
 *   （直删、没有恢复入口，这句话必须出现在确认里）。
 */
import { CheckOutlined, DeleteOutlined, MoreOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Tag, Tooltip, Typography } from "antd";
import { useCallback, useState } from "react";
import {
  BUILTIN_FONT_FILE,
  activateResumeFont,
  listResumeFonts,
  type BuiltinFontStatus,
} from "../../api/fonts";
import { useBuiltinFontDownload } from "../../features/fonts/useBuiltinFontDownload";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import FontSampleModal from "./FontSampleModal";

/**
 * 内置字体下载后的**磁盘文件名**：与后端落盘的名字逐字一致。
 *
 * 权威定义在 `api/fonts.ts`；这里 re-export 只是为了保住既有的测试导入路径
 * （`import BuiltinFontRow, { BUILTIN_FONT_FILE } from "./BuiltinFontRow"`）。
 */
export { BUILTIN_FONT_FILE };

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
  /**
   * 设备上当前的字体文件名。用来决定删除成功的提示语：
   * 删掉的正是它 → 「已删除，简历字体已回到系统字体」，否则只说「已删除」。
   */
  activeName?: string | null;
}

export default function BuiltinFontRow({ status, onChanged, activeName = null }: Props) {
  useLocale();
  const { message, modal } = App.useApp();
  const [activating, setActivating] = useState(false);
  const [sampleOpen, setSampleOpen] = useState(false);

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
   * 本次下载刚完成时的收尾：**判断该不该接管"当前字体"，再设一次**。
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

  const {
    status: current,
    state,
    downloading,
    cancelling,
    downloaded,
    startError,
    busy,
    start,
    remove,
  } = useBuiltinFontDownload({
    initial: status,
    onDownloaded: finishDownload,
    onChanged,
  });

  /** 删除：二次确认写明"直删、没有恢复入口"，成功后才给反馈。 */
  const confirmRemove = useCallback(() => {
    modal.confirm({
      title: t("fontDownload.deleteConfirmTitle"),
      content: t("fontDownload.deleteConfirmBody"),
      okText: t("fontDownload.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.action.cancel"),
      onOk: async () => {
        const outcome = await remove();
        if (outcome === "failed") return; // 原因已由 hook 弹出；文件与状态都原样留着
        message.success(
          activeName === BUILTIN_FONT_FILE
            ? t("fontDownload.deletedAndResetToSystem")
            : t("fontDownload.deleted"),
        );
      },
    });
  }, [activeName, message, modal, remove]);

  // 没拿到状态整行不渲染：老后端没有这个接口时，设置页其余部分照常可用。
  if (!current) return null;

  const total = current.total_bytes > 0 ? current.total_bytes : current.size_total;
  // 预估体积（取整到 MB）用于"点了要下多大"，进度用精确值（见两个 formatter 的分工）。
  const sizeText = formatApproxSize(total);
  const name = current.label || t("fonts.builtin.name");
  const failureReason = startError || current.error;
  const failed = startError !== "" || state === "failed";
  // 当前正用着这一款：标签 + 按钮都要变，否则"点了「设为当前」什么都没动"（2026-10-24 用户反馈）。
  // `activeName` 由父组件在切换成功后立刻乐观更新，所以这里不需要第二份本地状态。
  const isActive = activeName === BUILTIN_FONT_FILE;

  const progressText =
    current.total_bytes > 0
      ? t("fonts.builtin.downloading-with-total", {
          done: formatSize(current.downloaded_bytes),
          total: sizeText,
        })
      : t("fonts.builtin.downloading", { done: formatSize(current.downloaded_bytes) });

  return (
    <div className={`settings-font-featured${isActive ? " is-active" : ""}`}>
      <div className="settings-font-featured-main">
        <div className="settings-font-title">
          {/* 点名字看样张：先确认字形，再去点「下载 / 设为当前」。 */}
          <Button
            type="link"
            className="table-text-link settings-font-name"
            onClick={() => {
              if (downloaded) setSampleOpen(true);
              else message.info(t("fontDownload.sampleNotDownloaded"));
            }}
          >
            {name}
          </Button>
          {isActive ? <Tag color="blue">{t("fonts.card.active-tag")}</Tag> : null}
          {downloaded && !downloading ? (
            <Tag color="green">{t("fonts.builtin.downloaded")}</Tag>
          ) : null}
        </div>
        <div className="settings-font-meta">
          <span>{t("fonts.builtin.approx-size", { size: sizeText })}</span>
          {downloading ? <span>{progressText}</span> : null}
          {isActive && !downloading ? <span>{t("fonts.card.active-hint")}</span> : null}
        </div>
      </div>
      <div className="settings-font-actions">
        {downloading ? (
          <Button size="small" loading disabled>
            {cancelling ? t("fontDownload.canceling") : progressText}
          </Button>
        ) : null}
        {!downloading && failed ? (
          <Button size="small" onClick={() => void start()}>
            {t("fonts.builtin.retry")}
          </Button>
        ) : null}
        {!downloading && !failed && downloaded ? (
          // 已经是当前字体：按钮置灰而不是消失——位置不变，用户不会以为"按钮跑掉了"；
          // 真正的"已生效"信号是名字旁边那枚「当前使用」标签（与历史列表同一套）。
          <Button
            size="small"
            disabled={isActive || undefined}
            loading={activating}
            icon={isActive ? <CheckOutlined /> : undefined}
            onClick={() => void activate(t("fonts.builtin.activate-ok"))}
          >
            {t("fonts.builtin.activate")}
          </Button>
        ) : null}
        {!downloading && !failed && downloaded ? (
          // 删除是低频且不可恢复的动作：收进「更多操作」，不与「设为当前」并排裸露。
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "delete",
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: t("fontDownload.delete"),
                  onClick: confirmRemove,
                },
              ],
            }}
          >
            <Button
              size="small"
              type="text"
              loading={busy}
              icon={<MoreOutlined />}
              aria-label={t("common.action.more")}
            />
          </Dropdown>
        ) : null}
        {!downloading && !failed && !downloaded ? (
          <Tooltip title={t("fonts.builtin.source-tooltip")}>
            <Button
              size="small"
              aria-label={t("fonts.builtin.download-aria", { size: sizeText })}
              onClick={() => void start()}
            >
              {t("fonts.builtin.download")}
            </Button>
          </Tooltip>
        ) : null}
      </div>
      {failed ? (
        <Typography.Paragraph type="danger" className="settings-font-error">
          {failureReason
            ? t("fonts.builtin.failed", { error: failureReason })
            : t("fonts.builtin.failed-unknown")}
        </Typography.Paragraph>
      ) : null}
      <FontSampleModal
        name={sampleOpen && downloaded ? BUILTIN_FONT_FILE : null}
        displayName={name}
        active={isActive}
        onActivate={() => void activate(t("fonts.builtin.activate-ok"))}
        onClose={() => setSampleOpen(false)}
      />
    </div>
  );
}
