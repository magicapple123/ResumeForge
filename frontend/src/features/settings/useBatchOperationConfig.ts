// SPDX-License-Identifier: Apache-2.0
/**
 * 批量操作参数的读取与「必须先配置」守卫。
 *
 * 两套参数各自判断：批量生成看 `generation`，批量导出看 `export`。两个动作都在**点击时**
 * 重新读一次——用户很可能刚在设置里改完就切回来，缓存一份"没配置"只会让他再点一次。
 *
 * 守卫只做提示与跳转；真正的拒绝在后端（未配置时批量导出接口返回 409），前端拦不住
 * 脚本调用。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getBatchOperationConfig,
  type BatchExportConfigOut,
  type BatchGenerationConfigOut,
  type BatchOperationConfigOut,
  type BatchSection,
} from "../../api/settingsBatch";
import { t } from "../../i18n";

export function useBatchOperationConfig() {
  const [data, setData] = useState<BatchOperationConfigOut | null>(null);

  const refresh = useCallback(async (): Promise<BatchOperationConfigOut | null> => {
    try {
      const next = await getBatchOperationConfig();
      setData(next);
      return next;
    } catch {
      // 读不到（老后端 / 临时故障）按"未配置"处理：宁可让用户去设置确认一次，
      // 也不要在参数不明的情况下批量产出文件。
      setData(null);
      return null;
    }
  }, []);

  return { data, refresh };
}

interface GuardState<T> {
  data: BatchOperationConfigOut | null;
  refresh: () => Promise<BatchOperationConfigOut | null>;
  /** 已配置时返回该节参数（供动作直接使用），否则弹"去设置"并返回 null。 */
  ensure: () => Promise<T | null>;
}

export function useBatchOperationGuard(kind: "generation"): GuardState<BatchGenerationConfigOut>;
export function useBatchOperationGuard(kind: "export"): GuardState<BatchExportConfigOut>;
export function useBatchOperationGuard(kind: BatchSection): GuardState<unknown> {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const config = useBatchOperationConfig();
  const { refresh } = config;

  const ensure = useCallback(async (): Promise<unknown | null> => {
    const latest = await refresh();
    const section = latest ? latest[kind] : null;
    if (section?.configured) return section;
    modal.confirm({
      title: t("batchOperation.guard.title"),
      content: t(
        kind === "generation"
          ? "batchOperation.guard.body.generation"
          : "batchOperation.guard.body.export",
      ),
      okText: t("batchOperation.guard.go"),
      cancelText: t("common.action.cancel"),
      onOk: () => navigate("/settings?tab=appearance#batch-operation"),
    });
    return null;
  }, [kind, modal, navigate, refresh]);

  return { ...config, ensure };
}
