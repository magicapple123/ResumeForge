// SPDX-License-Identifier: Apache-2.0
/**
 * #19：「收藏当前要点」的**宿主接线**（头部快捷之外的第二个入口——编辑器右键菜单）。
 *
 * 头部快捷在 PhraseLibraryPanelV2 里走自己的 usePhraseLibrary.collect；编辑器右键在
 * DocumentEditor 内部，宿主拿不到那份 hook。为此在这里提供与头部完全一致的出口：
 * 同一个 collect API + 同一条 Toast + 递增 refreshToken 让资产库列表重载——
 * 避免两套收藏逻辑各写一遍提示与刷新，也保证「右键收藏」与「头部收藏」结果一致。
 */
import { useCallback, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { collectPhrase } from "./api";
import { at } from "./i18n";

export interface AssetCollectApi {
  collectAsset: (path: string) => Promise<void>;
  /** 每次收藏成功 +1；资产库面板据此重载列表（面板自己持有分页状态）。 */
  refreshToken: number;
}

export function useAssetCollect(resumeId: number | null | undefined): AssetCollectApi {
  const toast = useToast();
  const [refreshToken, setRefreshToken] = useState(0);
  const collectAsset = useCallback(
    async (path: string) => {
      if (!resumeId) return;
      try {
        await collectPhrase(resumeId, path);
        setRefreshToken((value) => value + 1);
        toast.success(at("assets.collect.done"));
      } catch {
        toast.error(at("assets.collect.failed"));
      }
    },
    [resumeId, toast],
  );
  return { collectAsset, refreshToken };
}
