// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历 id → 标题」的解析（#15D 用）。
 *
 * 为什么需要它：`resume-fit` 契约只回 id（`recommended_resume_id`），而界面要说
 * 「推荐简历：后端版（关键词覆盖 40% → 75%）」——名字必须显示出来，否则用户还得
 * 自己去简历中心按 id 对号。
 *
 * 取数口径：一次列表请求（简历总量是人量级，不需要按 id 逐个回查，省 N 次往返）。
 * **失败不抛错**：解析名字是"锦上添花"，算不出来时用 `简历 #{id}` 兜底，
 * 不能因为这一步失败就把「换用」按钮一起弄没了。
 */
import { listResumes } from "../../../api/resumes";
import { t } from "../../../i18n";

/**
 * 一次拉取的上限。
 *
 * 与 `remoteSearchOptions` 的 `page_size: 50` 不同：那里是"搜索下拉的一页"，
 * 这里是"名字对照表"，覆盖常见的简历库规模即可；超出部分退化为 `简历 #{id}`。
 */
export const RESUME_TITLE_PAGE_SIZE = 200;

/** 简历 id → 标题。请求失败返回空表（调用方用 `resumeTitleOf` 的兜底名）。 */
export async function fetchResumeTitles(): Promise<Record<number, string>> {
  try {
    const page = await listResumes({ page_size: RESUME_TITLE_PAGE_SIZE });
    const titles: Record<number, string> = {};
    for (const resume of page.items) titles[resume.id] = resume.title;
    return titles;
  } catch {
    return {};
  }
}

/** 取标题，缺省回退到语言包里的「简历 #{id}」（与简历下拉的兜底名同一句）。 */
export function resumeTitleOf(titles: Record<number, string>, resumeId: number): string {
  const title = titles[resumeId];
  return title && title.trim() ? title : t("hooksUi.option.resumeFallback", { id: resumeId });
}
