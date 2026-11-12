// SPDX-License-Identifier: Apache-2.0
/**
 * 统一检查弹窗（W11）：问题清单 / 机器读正文（D11）/ 格式能力矩阵三块。
 *
 * 挂载由 shell 完成（发过接入单）；本组件自带请求编排（usePreflight）与三个只读视图，
 * **不渲染第二层容器**（弹窗内不再开 Modal.confirm；修复动作交回宿主既有入口）。
 *
 * **不自动跑检查**是刻意的：一次检查要渲染 PDF、抽文本、跑规则，代价远高于一次读取；
 * 而且用户可能只是打开面板看一眼就关掉。但这不等于"打开就得是空态"——结果由
 * `features/resume/preflight/preflightCache` 跨页面保留（22a）：关掉弹窗、退出制作台、
 * 再进同一份简历，面板直接显示上次的清单（内容改过则叠加「结果基于上一版」提示）。
 * 所以这里**不要**在关闭时 `clear()`：那会把缓存里的那份也删掉，回到"必须再点一次"。
 */
import { Modal, Tabs } from "antd";
import { useMemo } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { runPreflight } from "./preflightApi";
import type { CheckFix, CheckFixAction, PreflightRequest } from "./types";
import { usePreflight } from "./usePreflight";
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
  useLocale();
  // `resumeId` 不随 `open` 置空：缓存按简历身份存，关着的时候也要能认出"这是哪一份"。
  const preflight = usePreflight({
    resumeId,
    currentKey,
    buildRequest,
    fetcher,
  });

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
            highlights={preflight.result?.order_highlights}
          />
        ),
      },
      {
        key: "capabilities",
        label: t("preflight.tab.capabilities"),
        children: (
          <CapabilitiesTable
            capabilities={preflight.result?.capabilities}
            notes={preflight.result?.capability_notes}
          />
        ),
      },
    ],
    [availableFixActions, onFix, onOpenAts, preflight],
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
