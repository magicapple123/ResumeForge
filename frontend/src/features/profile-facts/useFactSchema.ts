// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置（schema）的数据 hook：加载九类定义、条件保存单类、恢复默认。
 *
 * 与 `useProfileFacts` 分开的原因：事实列表与字段设置的生命周期不同——字段设置在
 * 「字段设置」视图里改，改完立即影响编辑器的可见字段与自定义字段；事实列表不需要
 * 跟着重新请求。拆开后两者各自失败、各自重试，不会互相拖垮。
 *
 * 归一化：PUT/reset 的响应契约写"返回完整 schema"，为兼容后端"整份 / 单类"两种实现，
 * 这里统一成 `ProfileFactSchema` 并写回 `schemaRef`（调用方要拿到刚保存的那一类）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { getProfileFactSchema, resetProfileFactKindSchema, saveProfileFactKindSchema } from "./api";
import { errorDetail } from "./errors";
import { fallbackKindSchema, fallbackSchema } from "./factFieldSchema";
import type {
  FactKind,
  ProfileFactKindSchema,
  ProfileFactKindSchemaUpdate,
  ProfileFactSchema,
  ProfileFactSchemaResponse,
} from "./types";

function normalizeSchema(
  previous: ProfileFactSchema | null,
  response: ProfileFactSchemaResponse,
): ProfileFactSchema {
  if ("kinds" in response) return response;
  const base = previous ?? fallbackSchema();
  let replaced = false;
  const kinds = base.kinds.map((item) => {
    if (item.kind !== response.kind) return item;
    replaced = true;
    return response;
  });
  if (!replaced) kinds.push(response);
  return { ...base, kinds };
}

export interface UseFactSchemaResult {
  schema: ProfileFactSchema | null;
  loading: boolean;
  /** 首次加载失败的原因；null 表示无错误。区块会按"全部默认字段可见"降级显示。 */
  error: string | null;
  reload: () => Promise<ProfileFactSchema | null>;
  saveKind: (kind: FactKind, input: ProfileFactKindSchemaUpdate) => Promise<ProfileFactKindSchema>;
  resetKind: (kind: FactKind, expectedRevision: number) => Promise<ProfileFactKindSchema>;
}

export function useFactSchema(): UseFactSchemaResult {
  const [schema, setSchema] = useState<ProfileFactSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const schemaRef = useRef<ProfileFactSchema | null>(null);
  const requestId = useRef(0);

  const adopt = useCallback((next: ProfileFactSchema) => {
    schemaRef.current = next;
    setSchema(next);
  }, []);

  const reload = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const loaded = await getProfileFactSchema();
      if (current !== requestId.current) return null;
      adopt(loaded);
      setError(null);
      return loaded;
    } catch (caught) {
      if (current !== requestId.current) return null;
      setError(errorDetail(caught) || t("profileFacts.error.unknown"));
      return null;
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    // 与 facts 列表同一写法：effect 内不直接 setState，用 microtask 起首屏加载。
    queueMicrotask(() => void reload());
  }, [reload]);

  const applyResponse = useCallback(
    (kind: FactKind, response: ProfileFactSchemaResponse): ProfileFactKindSchema => {
      const normalized = normalizeSchema(schemaRef.current, response);
      adopt(normalized);
      setError(null);
      return normalized.kinds.find((item) => item.kind === kind) ?? fallbackKindSchema(kind);
    },
    [adopt],
  );

  const saveKind = useCallback(
    async (kind: FactKind, input: ProfileFactKindSchemaUpdate) => {
      const response = await saveProfileFactKindSchema(kind, input);
      return applyResponse(kind, response);
    },
    [applyResponse],
  );

  const resetKind = useCallback(
    async (kind: FactKind, expectedRevision: number) => {
      const response = await resetProfileFactKindSchema(kind, {
        expected_revision: expectedRevision,
      });
      return applyResponse(kind, response);
    },
    [applyResponse],
  );

  return { schema, loading, error, reload, saveKind, resetKind };
}
