// SPDX-License-Identifier: Apache-2.0
/**
 * 统一检查弹窗（W11）：问题清单 / 机器读正文（D11）/ 格式能力矩阵三块。
 *
 * 挂载由 shell 完成（发过接入单）；本组件自带请求编排（usePreflight）与三个只读视图，
 * **不渲染第二层容器**（弹窗内不再开 Modal.confirm；修复动作交回宿主既有入口）。
 */
import { Modal, Tabs } from "antd";
import { useEffect, useMemo } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { runPreflight } from "../../../features/resume-preflight/preflightApi";
import type {
  CheckFix,
  CheckFixAction,
  PreflightRequest,
} from "../../../features/resume-preflight/types";
import { usePreflight } from "../../../features/resume-preflight/usePreflight";
import CapabilitiesTable from "./CapabilitiesTable";
import CheckPanel from "./CheckPanel";
import ScannerReadView from "./ScannerReadView";

interface Props {
  open: boolean;
  onClose: () => void;
  resumeId?: number | null;
  /**
   * 当前草稿的客户端指纹（内容签名 + 版式关键参数）；用于丢弃过时回包与
   * "结果基于上一版"提示。null = 暂时不能检查。
   */
  currentKey: string | null;
  /** 构造请求体（未保存正文/版式草稿/浏览器测量值由 shell 提供）。 */
  buildRequest: () => PreflightRequest | null;
  /** 修复动作分派到宿主既有入口；不传 = 不渲染任何修复按钮。 */
  onFix?: (fix: CheckFix) => void;
  availableFixActions?: ReadonlySet<CheckFixAction>;
  onOpenAts?: () => void;
  /** 测试注入：默认走真实 `POST /resumes/{id}/preflight`。 */
  fetcher?: typeof runPreflight;
}

export default function PreflightModal({
  open,
  onClose,
  resumeId,
  currentKey,
  buildRequest,
  onFix,
  availableFixActions,
  onOpenAts,
  fetcher,
}: Props) {
  const locale = useLocale();
  const preflight = usePreflight({
    resumeId: open ? resumeId : null,
    currentKey,
    buildRequest,
    fetcher,
  });
  const { clear } = preflight;

  // 关掉面板就清空结果：下次打开是"新的一次检查"，不展示上一轮（可能已过时）的清单。
  useEffect(() => {
    if (!open) clear();
  }, [clear, open]);

  const items = useMemo(
    () => [
      {
        key: "issues",
        label: t("preflight.tab.issues"),
        children: (
          <CheckPanel
            status={preflight.status}
            result={preflight.result}
            error={preflight.error}
            stale={preflight.stale}
            running={preflight.running}
            onRun={() => void preflight.run()}
            onCancel={preflight.cancel}
            onFix={onFix}
            availableFixActions={availableFixActions}
            onOpenAts={onOpenAts}
          />
        ),
      },
      {
        key: "scanner",
        label: t("preflight.tab.scanner"),
        children: (
          <ScannerReadView
            pages={preflight.result?.machine_text}
            diffs={preflight.result?.order_diffs}
          />
        ),
      },
      {
        key: "capabilities",
        label: t("preflight.tab.capabilities"),
        children: <CapabilitiesTable capabilities={preflight.result?.capabilities} />,
      },
    ],
    [
      availableFixActions,
      onFix,
      onOpenAts,
      preflight.cancel,
      preflight.error,
      preflight.result,
      preflight.running,
      preflight.run,
      preflight.stale,
      preflight.status,
      locale,
    ],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t("preflight.title")}
      footer={null}
      width={920}
      destroyOnHidden
    >
      <Tabs items={items} />
    </Modal>
  );
}
