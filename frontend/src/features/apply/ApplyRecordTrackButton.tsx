// SPDX-License-Identifier: Apache-2.0
/**
 * 记录行的「更新进度 / 查看进度」（#14C 起，整改 #18 补闭环）。
 *
 * ## 为什么要有第二态
 *
 * 整改前：点完只弹一句「已更新求职进度里的这条投递」，行内观感没变；刷新后按钮仍写
 * 「更新进度」——用户会再点一次（后端查重兜住，但体验是空转），而 tooltip 里那句
 * "之后可在**那边**更新阶段"里的"那边"没有任何链接，链路就断在这。
 *
 * 现在三态，且**由数据驱动**（`record.track_id` 来自接口，不是"这次点成功了"这类内存
 * 状态——后者刷新一次就丢）：
 *
 * 1. 未记录（`track_id` 为空）→「更新进度」，点击写库；
 * 2. 已记录（`track_id` 有值）→「查看进度 ↗」，点击直接去 `/tracker?track=N`
 *    （深链用**那一条**的 id，不是 `?job_id=`：同一岗位可能有多条进度，按岗位筛不唯一）；
 * 3. 更新中 → 按钮 loading，挡住连点。
 *
 * 成功时除了按钮就地变「查看进度」，toast 里也带一个「查看」动作：用户可能不想跳走
 * （还要继续投递），给入口而不是强制跳转。
 */
import { FlagOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trackApplyRecord } from "../../api/applyExtras";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import type { ApplyRecord } from "../../types";

/** 深链目标：`/tracker?track=N`（与 `TrackerPage` 的解析函数逐字对应）。 */
function trackerDeepLink(trackId: number): string {
  return `/tracker?track=${trackId}`;
}

export default function ApplyRecordTrackButton({ record }: { record: ApplyRecord }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后按钮停在旧文案。
  useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // 本次会话内刚写进去的那条。与 `record.track_id` 取并集：接口给了就用接口的
  // （刷新后仍成立），刚写完接口还没重拉时用本地的（观感即时）。
  const [justLinked, setJustLinked] = useState<number | null>(null);
  const linkedTrackId = justLinked ?? record.track_id ?? null;

  const openTracker = (trackId: number) => {
    navigate(trackerDeepLink(trackId));
  };

  const run = async () => {
    setBusy(true);
    try {
      const result = await trackApplyRecord(record.id);
      setJustLinked(result.track_id);
      toast.success(
        t(result.created ? "applyRecords.toast.tracked" : "applyRecords.toast.trackUpdated"),
        {
          // 不自动跳走：用户可能还要继续投递。给一个明确入口。
          action: {
            label: t("applyRecords.track.view"),
            onClick: () => openTracker(result.track_id),
          },
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("applyRecords.error.trackFailed"));
    } finally {
      setBusy(false);
    }
  };

  // 岗位已删除的记录没有 job_id，后端也建不出求职进度条目（无法关联岗位）。
  const blocked = record.job_id == null;

  if (linkedTrackId !== null) {
    return (
      <Tooltip title={t("applyRecords.track.hintLinked")}>
        <Button
          size="small"
          icon={<RightOutlined />}
          className="apply-record-track-linked"
          onClick={() => openTracker(linkedTrackId)}
        >
          {t("applyRecords.action.viewTrack")}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={t("applyRecords.track.hint")}>
      <Button
        size="small"
        icon={<FlagOutlined />}
        loading={busy}
        disabled={blocked || undefined}
        onClick={() => void run()}
      >
        {t("applyRecords.action.track")}
      </Button>
    </Tooltip>
  );
}
