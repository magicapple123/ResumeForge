/**
 * ResumeEditorModal 测试共用夹具：默认简历内容、内容构造器与视口 mock。
 *
 * 2026-10-19：文件行数预算（500 行）触顶后，把「条目级填入开关（entryFill）」那一组
 * 用例拆到 `ResumeEditorModal.entryFill.test.tsx`。`vi.mock` 不跨文件 hoist，所以
 * mock 注册仍在各测试文件内；**内容夹具**与**视口 mock** 只有一份实现——就是本文件。
 *
 * 文件名不带 `.test.`/`.spec.`，vitest 不会收集它；行数预算守卫把它当普通源码扫描，
 * 因此它自己也要守在 500 行以内。与 `src/test/profilePageHarness.tsx` 同类。
 */
import type { ResumeContent } from "../types";

/** 最小可编辑内容：只有姓名与求职意向，所有列表为空。 */
export const CONTENT: ResumeContent = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "产品运营专员",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

/**
 * 在默认夹具上覆盖若干字段（只覆盖传进来的键，其余保持默认）。
 *
 * 用它在用例里构造"带一条教育经历""带一个项目"这类内容，避免每个文件各写一份
 * 十六字段的字面量——后端加字段时会漏改。
 */
export function makeResumeContent(overrides: Partial<ResumeContent> = {}): ResumeContent {
  return { ...CONTENT, ...overrides };
}

/**
 * 把测试视口切成"宽屏"：`src/test/setup.ts` 的 matchMedia 一律返回 false，所以默认
 * 视口等价于窄屏。antd 的 `Grid.useBreakpoint` 在每次订阅时重新读 matchMedia，
 * 因此在 render 之前替换、之后还原即可（不需要动那个全局默认值）。
 *
 * @param minWidthPx 视口宽度（像素），`min-width: Npx` 查询在 N ≤ 该值时命中。
 * @returns 还原函数；务必在 `finally` 或 `afterEach` 里调用。
 */
export function mockWideViewport(minWidthPx = 992): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: minWidth ? Number(minWidth[1]) <= minWidthPx : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}
