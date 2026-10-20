// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Spin } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { initializeDatasetScope } from "../api/datasetScope";

/** Mount editable pages only after their initial dataset identity has been frozen. */
export default function DatasetScopeBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void initializeDatasetScope(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, []);
  if (state === "loading") return <Spin fullscreen description="正在连接本地工作台" />;
  if (state === "error")
    return (
      <Alert
        type="error"
        showIcon
        title="无法连接本地工作台"
        description="数据尚未加载，请确认服务已启动后刷新。"
        action={<Button onClick={() => window.location.reload()}>刷新</Button>}
      />
    );
  return children;
}
