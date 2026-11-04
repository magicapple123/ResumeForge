// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」深链：`/profile?section=<板块 key>&entry=<条目 key>`。
 *
 * 全局搜索（⌘K）命中资料条目后跳到本页，必须**真的落到那一条**，而不是只跳到页面：
 *
 * 1. 切成对应工作区（简历资料 / 网申资料）；
 * 2. 目标板块不在当前方案（参与清单）里 → 不静默失败，由页面显示提示与「显示」入口；
 * 3. 展开该板块（查看态的折叠按 key 记在 `collapsedSections`）→ 滚动到视口内并聚焦；
 * 4. 条目锚点找不到（已软删 / 已合并）→ **退化为板块级**，不报错。
 *
 * 编辑态下折叠本就不生效（`ProfileSectionStack` 的 `collapsed={!editing && …}`），
 * 这里不为此强行切出编辑态：按"已展开"处理即可。
 */
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProfileWorkspaceKey } from "../../components/profile/ProfileWorkspaceTabs";
import type { WorkspaceOut } from "../profile-library/types";

const SECTION_ATTR = "data-profile-section-key";
const ENTRY_ATTR = "data-profile-entry-key";
/** 命中高亮的类名（样式见 `styles/profile-card.css`）。 */
const HIGHLIGHT_CLASS = "is-deep-link-target";
/** 条目卡由 antd Form 回填后渲染，可能比板块外壳晚几帧；给它一小段重试窗口。 */
const ENTRY_RETRY_TIMES = 20;
const ENTRY_RETRY_DELAY_MS = 25;

/**
 * 网申板块的 key 前缀。网申资料目前存在独立的 `web_form_profile` 里、不产生
 * `ProfileEntry`，所以搜索命中的 `section_key` 只可能是简历资料板块；留这个判定是
 * 为了将来网申板块接进条目模型时不必再改一遍深链。
 */
export function isWebFormSectionKey(sectionKey: string): boolean {
  return sectionKey.startsWith("web_form:") || sectionKey.startsWith("webform:");
}

/** 按属性值找节点（值里可能有 `:`，不拼选择器就不会踩转义问题）。 */
function findByAttribute(attribute: string, value: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const node of Array.from(nodes)) {
    if (node.getAttribute(attribute) === value) return node;
  }
  return null;
}

interface Options {
  workspace: WorkspaceOut | null;
  loading: boolean;
  /** 当前方案参与清单（服务端解析后的有序 key）。 */
  participatingKeys: string[];
  sectionParam: string;
  entryParam: string;
  setActiveWorkspace: (key: ProfileWorkspaceKey) => void;
  /** 查看态的折叠集合；命中时把目标板块从集合里删掉（= 展开）。 */
  setCollapsedSections: Dispatch<SetStateAction<Set<string>>>;
}

export interface ProfileDeepLinkApi {
  /** 目标板块存在但不在当前方案里：页面据此显示提示与「显示」入口。 */
  missingSectionKey: string;
}

export function useProfileDeepLink({
  workspace,
  loading,
  participatingKeys,
  sectionParam,
  entryParam,
  setActiveWorkspace,
  setCollapsedSections,
}: Options): ProfileDeepLinkApi {
  // 派生值而不是 state：方案/参与清单一变（比如用户点了「显示该板块」）提示自动消失，
  // 不需要在 effect 里同步 setState。
  const sectionExists =
    workspace?.sections.some((section) => section.key === sectionParam) ?? false;
  const sectionInScheme = participatingKeys.includes(sectionParam);
  const missingSectionKey =
    sectionParam && !loading && sectionExists && !sectionInScheme ? sectionParam : "";
  const handledRef = useRef("");

  useEffect(() => {
    if (loading || !workspace || !sectionParam) return undefined;
    // 同一组参数只处理一次；"显示该板块"成功后参与状态翻转，signature 变化才会再跑。
    const signature = `${sectionParam}|${entryParam}|${sectionExists ? 1 : 0}|${
      sectionInScheme ? 1 : 0
    }`;
    if (handledRef.current === signature) return undefined;
    handledRef.current = signature;

    setActiveWorkspace(isWebFormSectionKey(sectionParam) ? "web-form" : "resume");
    // 板块定义本身已不存在（被删）或不在当前方案：无从定位，交给页面的提示处理。
    if (!sectionExists || !sectionInScheme) return undefined;

    setCollapsedSections((current) => {
      if (!current.has(sectionParam)) return current;
      const next = new Set(current);
      next.delete(sectionParam);
      return next;
    });

    // 等展开后的这次渲染提交完再定位。条目来自 antd Form 的 `setFieldsValue`（在
    // loading=false 的 effect 里），可能比板块外壳晚一两帧；先给条目一小段重试窗口，
    // 仍找不到（已软删/已合并）就退化为板块级。jsdom 没有 scrollIntoView，可选调用。
    let attempts = 0;
    let timer = 0;
    const locate = () => {
      attempts += 1;
      const sectionNode = findByAttribute(SECTION_ATTR, sectionParam);
      const entryNode = entryParam ? findByAttribute(ENTRY_ATTR, entryParam) : null;
      if (entryParam && !entryNode && attempts < ENTRY_RETRY_TIMES) {
        timer = window.setTimeout(locate, ENTRY_RETRY_DELAY_MS);
        return;
      }
      const target = entryNode ?? sectionNode;
      if (!target) return;
      target.classList.add(HIGHLIGHT_CLASS);
      target.scrollIntoView?.({ block: "center" });
      target.focus?.();
    };
    timer = window.setTimeout(locate, 0);
    return () => window.clearTimeout(timer);
  }, [
    entryParam,
    loading,
    sectionExists,
    sectionInScheme,
    sectionParam,
    setActiveWorkspace,
    setCollapsedSections,
    workspace,
  ]);

  return { missingSectionKey };
}
