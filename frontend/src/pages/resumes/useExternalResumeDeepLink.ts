// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历的深链：`/resumes/external?resume=<id>` → 直接打开那一份的详情（T31 续）。
 *
 * ## 为什么这条参数一直没人读
 *
 * T13「提醒 → 关联简历」早就在产出这个链接（`features/tracker/reminderResumeLink.ts`），
 * 外部简历页却只读 `job_id` / `keyword` / `sort` / `order`，于是点过去只落在列表上，
 * 用户还得自己按名字找一遍。这里把读的一侧补上，**路径与参数名一个都不新造**。
 *
 * ## 三条必须一起成立的规则
 *
 * 1. **参数必须被消费掉**：打开详情后立刻从 URL 删掉（`replace`，不写历史）。留着的话
 *    用户关掉弹层会立刻被同一个参数再弹回来——关不掉，且从详情退回列表时 URL 还是脏的。
 * 2. **不存在的 id 不许静默**：`?resume=99999` 与"被删掉的那份"都必须给一条**可关**的
 *    提示，否则页面看起来就是"点了没反应"。提示由调用方渲染（本 hook 只报告事实），
 *    文案留在语言包里。
 * 3. **先校验再打开**：抽屉拿到不存在的 id 只会自己显示错误块，用户看到的是一个"坏掉的
 *    详情"；这里先用一次详情请求确认它还在，确认之后才开抽屉。
 *
 * ## 为什么用 ref 记住"这条参数处理过了"
 *
 * 删除参数会让 `searchParams` 变化 → 依赖数组变化 → effect 重跑。若在 cleanup 里
 * `cancelled = true`，那条**还没落地**的详情请求就会在 resolve 时被丢掉（抽屉永远不开）。
 * 所以：`handled` 记住已处理的原值（同一值只处理一次），`alive` 只在**卸载**时翻假。
 *
 * ## 兼容旧写法
 *
 * `?resume=` 是当前写法；同时接受 T29 的复合引用 `external:8`（`types/resumeRef.ts`），
 * 因为提醒 / 进度 / 投递台都在往 URL 里塞复合值，用户手动复制粘贴时会带过来。
 */
import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { getExternalResume } from "../../api/externalResumes";
import { decodeResumeRef } from "../../types/resumeRef";

/** URL 参数名（与 T13 的 `reminderResumeLink.ts` 逐字一致，不要另起一个）。 */
export const EXTERNAL_RESUME_PARAM = "resume";

/**
 * 把参数解析成外部简历 id；不合法一律 `null`。
 *
 * - `"8"` → `8`；
 * - `"external:8"` / `"e:8"` → `8`（复合引用，见 `types/resumeRef.ts`）；
 * - `"internal:8"` → `null`：内部简历的深链是 `/resumes?resume_id=`，在外部页里没有意义；
 * - 其余（空串、负数、小数、非数字）→ `null`。
 */
export function parseExternalResumeParam(raw: string | null): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  const ref = decodeResumeRef(text);
  return ref && ref.kind === "external" ? ref.id : null;
}

/** 调用方要提供的两个回调（都必须稳定，见 `useCallback`）。 */
export interface ExternalResumeDeepLinkHandlers {
  /** 参数合法且这条外部简历还在：打开它的详情。 */
  onOpen: (id: number) => void;
  /** 参数非法或该简历已不存在 / 已删除：给用户一条可关的提示。 */
  onMissing: () => void;
}

/**
 * 挂载即检查 `?resume=`，命中则打开对应详情并把参数消费掉。
 *
 * @param handlers `onOpen` / `onMissing`；必须是稳定引用（`useCallback`），
 *   否则每次渲染都会重跑一轮校验请求。
 */
export function useExternalResumeDeepLink(handlers: ExternalResumeDeepLinkHandlers): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(EXTERNAL_RESUME_PARAM);
  const { onOpen, onMissing } = handlers;
  /** 已经处理过的原值：删参数会让本 effect 重跑，靠它避免重复处理 / 重复提示。 */
  const handled = useRef<string | null>(null);
  /** 组件是否还活着：只有卸载才该丢弃在途结果。 */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 消费参数：`replace` 语义，且必须在打开详情**之前**就清掉（关掉抽屉不会再弹）。 */
  const consume = useCallback(() => {
    setSearchParams(
      (previous) => {
        if (!previous.has(EXTERNAL_RESUME_PARAM)) return previous;
        const next = new URLSearchParams(previous);
        next.delete(EXTERNAL_RESUME_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    if (raw === null || raw === handled.current) return;
    handled.current = raw;
    consume();
    const id = parseExternalResumeParam(raw);
    if (id === null) {
      onMissing();
      return;
    }
    getExternalResume(id)
      .then(() => {
        if (alive.current) onOpen(id);
      })
      .catch(() => {
        // 404（不存在 / 已进回收站）与网络错误在这条链路上对用户是同一件事：
        // 这份简历打不开。提示由调用方给，避免这里再写一份文案。
        if (alive.current) onMissing();
      });
  }, [consume, onMissing, onOpen, raw]);
}

export default useExternalResumeDeepLink;
