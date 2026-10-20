// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板目录的唯一加载入口。
 *
 * 为什么要有这个 hook：P2 把版式控件拆成"结构类"与"度量类"两组后，两组不再由同一个壳
 * 渲染（工具栏按两个插槽分别渲染）。若两组各自 `useApi(fetchResumeTemplates)`，宿主就会
 * 发**两个**目录请求——`hooks/useApi` 没有跨实例缓存，拆组就会悄悄把请求数翻倍。
 *
 * 约定：**一个宿主调一次**，把 `catalog` 同时传给两组。目前三个宿主（`ResumeLayoutControls`
 * 壳、`ResumeDetailPreview`、`ResumeZoomModal`）各自恰好一次，与拆分前持平。
 */
import { fetchResumeTemplates } from "../api/resumes";
import { useApi } from "./useApi";
import type { ResumeTemplateCatalog } from "../types";

/** 目录尚未返回时是 `undefined`（两组控件都按"缺省"处理，不阻塞渲染）。 */
export function useResumeTemplateCatalog(): { catalog: ResumeTemplateCatalog | undefined } {
  const { data } = useApi(fetchResumeTemplates, []);
  return { catalog: data };
}
