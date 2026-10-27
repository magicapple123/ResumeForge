// SPDX-License-Identifier: Apache-2.0
/**
 * 错误态（RF-12 固化的通用模式之一）。
 *
 * 与 EmptyState 的分工：错误是**暂时的、可重试的**，必须（a）与"确实没有数据"
 * 区分开，（b）给用户一条出路（重试），（c）对读屏器可感知——外层 role="alert"
 * 让错误出现时即被播报，不依赖用户恰好看着这一块。
 */
import { Button, Empty } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function ErrorState({
  description,
  onRetry,
  retrying = false,
  retryLabel,
}: {
  /** 说明出了什么事、用户能做什么（接口错误信息或一句人话）。 */
  description: ReactNode;
  /** 提供即渲染重试按钮；不提供则只展示错误说明。 */
  onRetry?: () => void;
  /** 重试请求进行中，按钮转圈并禁用。 */
  retrying?: boolean;
  retryLabel?: string;
}) {
  useLocale();
  return (
    <div role="alert" className="rf-state rf-state--error">
      <Empty
        image={<ExclamationCircleOutlined className="rf-state-error-icon" />}
        description={description}
      >
        {onRetry ? (
          <Button onClick={onRetry} loading={retrying}>
            {retryLabel ?? t("common.retry")}
          </Button>
        ) : null}
      </Empty>
    </div>
  );
}
