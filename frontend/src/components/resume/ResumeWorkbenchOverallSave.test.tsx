// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **一对**整体的保存 / 取消（2026-11 用户口径）。
 *
 * 用户原话："当简历制作台中有任何内容被修改时都可以选择取消或保存，只用有一个整体的
 * 保存和取消按钮就可以了，简历内容列不需要再单独有一个。"
 *
 * 这条需求的难点不在按钮，在**"有改动"的判据**：制作台里两种改动的性质完全不同——
 * 中栏内容是显式保存（`editorDirty`），左栏参数是即时生效、已经落库的。只认前者，
 * 用户拖完字号却发现顶部没有"取消"；只认后者，改了一句措辞同样没反应。所以这里三条
 * 都得钉住：
 *
 * 1. 中栏底部那对局部按钮**不渲染**（不是隐藏，是整行都没有）；
 * 2. **只改版式**也算有改动，顶部那对出现；
 * 3. 「取消」两件事都做——内容回填 + 版式回滚到打开制作台那一刻；
 * 4. 「保存」两件事都做——版式**落库**（`onCommitLayout` → `PATCH`）+ 内容提交。版式只重排
 *    不落库，这一句漏掉就是"用户以为存了、重开又变回去了"（QA 实测复现过的缺陷）。
 *
 * 断言文案一律走 `t()`（`cjkRatchet` 的 tests 口径逐文件卡中文），中文只在注释里。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readWorkbenchCss } from "../../test/workbenchStyles";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

// 目录只取一次（组件自己调 hook）；这里直接下发夹具，避免多一次网络桩。
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 右栏预览是真 iframe + 量高（`ResumePreview` 自有其用例），与这里的结构断言无关。
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

/** 打开时的版式：`format_config` 是空对象，点一次色板就能造出差异。 */
const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/**
 * 尽量贴近真宿主的接线：`onApplyLayout` 既是"通知宿主"，也真的把新 layout 回灌进来
 * （`ResumeDetailPreview` 就是这么做的——PATCH 之后 `setDetail` 再传下来）。
 * 不这么做，"版式快照"永远比不到差异，用例会假通过。
 *
 * `commitLayout` 让用例决定版式 PATCH 的成败：缺省成功（真宿主成功时返回 true）。
 * `withoutCommitLayout` 则**真的不传**这条通道（不是传 undefined 占位），用来钉住"只读宿主"
 * 那条退化路径。
 */
function renderWorkbench(
  options: { commitLayout?: () => Promise<boolean>; withoutCommitLayout?: boolean } = {},
) {
  const onApplyLayout = vi.fn<(next: ResumeLayout) => void>();
  const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
  const onCommitLayout = vi.fn(options.commitLayout ?? (async () => true));
  const onClose = vi.fn();

  function Harness() {
    const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={onClose}
          layout={layout}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={(next) => {
            onApplyLayout(next);
            setLayout(next);
          }}
          {...(options.withoutCommitLayout ? {} : { onCommitLayout })}
          onSaveContent={onSaveContent}
        />
      </AntdApp>
    );
  }

  render(<Harness />);
  return { onApplyLayout, onSaveContent, onCommitLayout, onClose };
}

/**
 * 中栏「姓名」输入框：改一个字就能造出 `editorDirty`（**只改内容、不动版式**）。
 *
 * 这条用例要的正是"版式干净、内容脏"这一态：此时版式通道在不在都不该影响内容保存。
 */
function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function topSave(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

function topCancel(): HTMLElement | null {
  return within(actionbar()).queryByRole("button", {
    name: new RegExp(t("workbench.action.cancel-changes")),
  });
}

/**
 * 点一次预设色板 = 改一处**版式**（即时生效、已经落库，但可以回滚）。
 *
 * 取第一行那一颗：四行颜色各有一块同名的色块（读屏名就是颜色名），所以按 role 查会命中
 * 四颗——这里要的只是"改一处版式"，改哪一行都一样。
 */
function pickSwatch(): void {
  fireEvent.click(screen.getAllByRole("button", { name: t("workbench.color.navy") })[0]);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 只剩一对整体动作", () => {
  it("中栏底部不再渲染「保存内容 / 放弃修改」，整行都不留", () => {
    renderWorkbench();

    // 不是"藏起来"：`.resume-wb-editor-actions` 这个容器本身不出现，底部不会留一条空白。
    expect(document.querySelector(".resume-wb-editor-actions")).toBeNull();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("workbench.action.save-content")) }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t("workbench.action.discard-edits") })).toBeNull();
    // 中栏本身还在（只是少了那排按钮）。
    expect(document.querySelector(".resume-wb-editor-body")).not.toBeNull();

    // 那一栏的 `padding: 16px 16px 0` 是"底部由动作条自己补"的写法：动作条没了就得用
    // `:has()` 把底边距补回来，否则最后一行贴着窗口边缘（jsdom 不求值 CSS，读原文钉住）。
    const css = readWorkbenchCss();
    expect(css).toMatch(
      /\.resume-wb-editor:not\(:has\(\.resume-wb-editor-actions\)\)\s+\.resume-wb-editor-body\s*\{[^}]*padding-bottom:\s*16px/,
    );
  });

  it("只改了版式（没碰内容）就有改动信号：顶部出现保存与取消", async () => {
    const { onApplyLayout } = renderWorkbench();
    expect(topSave()).toBeNull();

    pickSwatch();

    // 版式仍然是即时生效的（不改成"暂存待提交"：不 PATCH 就没有新纸面可看）。
    expect(onApplyLayout).toHaveBeenCalledTimes(1);
    expect(onApplyLayout.mock.calls[0][0].format_config).toEqual({ accent: "#1e3a8a" });
    await waitFor(() => expect(topSave()).not.toBeNull());
    expect(topCancel()).not.toBeNull();
  });
});

describe("制作台 · 取消 = 内容回填 + 版式回滚", () => {
  it("确认后版式退回打开制作台那一刻，且一次内容 PATCH 都没发", async () => {
    const { onApplyLayout, onSaveContent } = renderWorkbench();

    pickSwatch();
    await waitFor(() => expect(topCancel()).not.toBeNull());
    fireEvent.click(topCancel() as HTMLElement);

    // 确认条长在顶部动作条里，文案要交代"排版参数也会一起回滚"。
    const alert = await within(actionbar()).findByRole("alert");
    expect(alert).toHaveTextContent(t("workbench.actionbar.discard.body"));

    fireEvent.click(within(alert).getByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(onApplyLayout).toHaveBeenCalledTimes(2));
    const rolledBack = onApplyLayout.mock.calls[1][0];
    expect(rolledBack.format_config).toEqual({});
    // 回滚之后"有改动"这条信号必须消失（否则两颗按钮会一直挂着）。
    await waitFor(() => expect(topSave()).toBeNull());
    // 取消不等于保存：内容一次都没写回去。
    expect(onSaveContent).not.toHaveBeenCalled();
  });

  it("保存：只改版式时不发内容 PATCH，按钮随即收起", async () => {
    const { onSaveContent, onClose } = renderWorkbench();

    pickSwatch();
    await waitFor(() => expect(topSave()).not.toBeNull());
    fireEvent.click(topSave() as HTMLElement);

    // 版式早就落库了（`onApplyLayout` 就是那条链路），保存不该再写一次内容。
    expect(onSaveContent).not.toHaveBeenCalled();
    await waitFor(() => expect(topSave()).toBeNull());
    // 保存不关制作台：用户下一步往往是接着调参数。
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("制作台 · 保存把版式真正落库", () => {
  it("只改版式时保存：调一次 onCommitLayout，一次内容 PATCH 都不发", async () => {
    const { onCommitLayout, onSaveContent } = renderWorkbench();

    pickSwatch();
    await waitFor(() => expect(topSave()).not.toBeNull());
    fireEvent.click(topSave() as HTMLElement);

    // QA 抓到的那个缺陷：`onApplyLayout` 只重排不落库，所以保存必须另外走一次 PATCH。
    // 少了这一步，用户"保存"后重开制作台，字号又回到原样。
    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));
    expect(onSaveContent).not.toHaveBeenCalled();
    // 版式**确认落库**之后"有改动"才该消失（按钮收起 = 真的存进去了）。
    await waitFor(() => expect(topSave()).toBeNull());
  });

  it("版式落库失败：快照不对齐，保存按钮留在原地等重试", async () => {
    // 手动控制结算时机：失败之后才断言，才排得掉"断言跑在失败之前"那种假通过。
    let rejectCommit: (error: Error) => void = () => undefined;
    const commitLayout = () =>
      new Promise<boolean>((_resolve, reject) => {
        rejectCommit = reject;
      });
    const { onCommitLayout } = renderWorkbench({ commitLayout });

    pickSwatch();
    await waitFor(() => expect(topSave()).not.toBeNull());
    fireEvent.click(topSave() as HTMLElement);
    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectCommit(new Error("layout patch failed"));
    });
    // 没落库就不许对齐快照：对齐了等于告诉用户"存上了"，而按钮一收起来他连重试都没有。
    expect(topSave()).not.toBeNull();
  });

  it("只改版式时按 Esc：不关制作台，先出一张确认卡片并点名丢的是排版参数", async () => {
    const { onClose } = renderWorkbench();

    pickSwatch();
    await waitFor(() => expect(topSave()).not.toBeNull());

    // Esc 是 rc-dialog 挂在 window 上的全局监听：与用户真按键走同一个入口。
    fireEvent.keyDown(window, { key: "Escape" });

    // 2026-10-24 起确认卡片长在动作条最右那颗 × 上（不再塞进中栏底部）：
    // 用户按的是关闭，确认就该出现在他刚才点的地方。
    expect(
      await screen.findByText(t("workbench.actionbar.discard.close-layout")),
    ).toBeInTheDocument();
    // 只认内容脏时这里会直接关掉：版式改动静默消失，连一句提示都没有。
    expect(onClose).not.toHaveBeenCalled();
    // 制作台还开着：顶部动作条仍在（用户仍然可以保存）。
    expect(topSave()).not.toBeNull();
  });

  it("没传 onCommitLayout：保存不抛，内容照旧落库（退化成只存内容）", async () => {
    const { onSaveContent } = renderWorkbench({ withoutCommitLayout: true });

    // 只改内容、不动版式：这一态下"版式通道不存在"必须完全无感。
    fireEvent.change(nameInput(), { target: { value: "李四" } });
    await waitFor(() => expect(topSave()).not.toBeNull());

    // 保存是异步的：不用 `await act` 让它走完，崩在 Promise 里的 TypeError 会以未处理拒绝
    // 溜过去，用例假绿。点了之后必须等它真的落地。
    await act(async () => {
      fireEvent.click(topSave() as HTMLElement);
    });

    expect(onSaveContent).toHaveBeenCalledTimes(1);
    expect(onSaveContent.mock.calls[0][0].name).toBe("李四");
    // 退化的另一面：内容存完"有改动"就消失（按钮不会挂在那里），也没有多余的报错。
    await waitFor(() => expect(topSave()).toBeNull());
  });
});

/**
 * **内容与版式同时脏**才是「保存修改」的主路径，而上面 8 条用例恰好都绕开了它：
 *
 * - 只改版式 → `editorDirty=false`，压根不走内容保存；
 * - 只改内容 → `saveLayout` 在 `!layoutDirty` 时直接 `return true`，连 `setDetail` 都不发。
 *
 * 两条一起走才会踩到 QA 抓到的那条 P0：版式 PATCH 返回的 `detail.content` 是 JSON 重新解析
 * 出来的**新引用**（正文一个字节都没变）→ 编辑器的重同步守卫命中 → 表单被服务端旧正文覆盖
 * → 交出去的是旧值，界面还提示"已保存"。
 */
describe("制作台 · 内容 + 版式同时脏（主路径）", () => {
  it("内容 + 版式都脏时保存：用户改的正文必须原样落到 PATCH 里", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    function Harness() {
      const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
      // 关键：`onCommitLayout` 里把 content 换成**新对象引用**（正文值不变）——这正是
      // `PATCH /layout` 返回的 `detail.content` 的形态，也是旧实现丢正文的那个条件。
      const [content, setContent] = useState<ResumeContent>(CONTENT);
      return (
        <AntdApp>
          <ResumeZoomModal
            open
            html="<html></html>"
            warnings={[]}
            pages={1}
            onClose={vi.fn()}
            layout={layout}
            resumeId={42}
            content={content}
            onApplyLayout={(next) => setLayout(next)}
            onCommitLayout={async () => {
              setContent({ ...CONTENT });
              return true;
            }}
            onSaveContent={onSaveContent}
          />
        </AntdApp>
      );
    }

    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: "李四" } }); // 改内容
    pickSwatch(); // 改版式
    await waitFor(() => expect(topSave()).not.toBeNull());

    await act(async () => {
      fireEvent.click(topSave() as HTMLElement);
    });

    await waitFor(() => expect(onSaveContent).toHaveBeenCalledTimes(1));
    expect(onSaveContent.mock.calls[0][0].name).toBe("李四");
  });

  it("版式 PATCH 只换了正文引用（正文没变）：脏标记与用户输入都不被清掉", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    function Harness() {
      const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
      const [content, setContent] = useState<ResumeContent>(CONTENT);
      return (
        <AntdApp>
          <ResumeZoomModal
            open
            html="<html></html>"
            warnings={[]}
            pages={1}
            onClose={vi.fn()}
            layout={layout}
            resumeId={42}
            content={content}
            // 版式一改就顺手换一份 content：新引用、正文一模一样 = 宿主 `setDetail` 的形态。
            onApplyLayout={(next) => {
              setLayout(next);
              setContent({ ...CONTENT });
            }}
            onSaveContent={onSaveContent}
          />
        </AntdApp>
      );
    }

    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: "李四" } });
    await waitFor(() => expect(topSave()).not.toBeNull());

    await act(async () => {
      pickSwatch();
    });

    // 正文没变就不许回填：回填 = 把刚输入的"李四"换成服务端那份"Alex"。
    await waitFor(() => expect(nameInput().value).toBe("李四"));
    // 脏标记也不许被清：症状是顶部那一对收起、中栏状态条不再说"内容还没保存"。
    expect(topSave()).not.toBeNull();
    expect(screen.queryByText(t("workbench.status.unsaved"))).not.toBeNull();
  });
});

/**
 * **草稿**（0051）：这份记录还没被保存过，简历中心里看不到它。
 *
 * 这一组钉住的是"需求会卡住的那一格"：刚建出来的草稿内容与版式都是它被建出来时的样子，
 * 按"有改动才出现保存按钮"的判据就**没有保存入口**——用户只能关掉，草稿永远进不了简历
 * 中心。所以草稿必须让「保存」常驻，而且它做的事不是"保存修改"，是"让这份简历出现"。
 */
describe("制作台 · 草稿（0051）", () => {
  function DraftHarness({
    publish,
    onClose,
  }: {
    publish: () => Promise<boolean>;
    onClose: () => void;
  }) {
    const [draft, setDraft] = useState(true);
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={onClose}
          layout={OPENING_LAYOUT}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={vi.fn()}
          onCommitLayout={async () => true}
          onSaveContent={async () => undefined}
          isDraft={draft}
          onPublishDraft={async () => {
            const ok = await publish();
            // 与真宿主一致：发布成功后本地标志翻掉，按钮回到"脏了才出现"的形态。
            if (ok) setDraft(false);
            return ok;
          }}
        />
      </AntdApp>
    );
  }

  it("什么都没改也有「保存到简历中心」，点了只发一次发布请求", async () => {
    const publish = vi.fn(async () => true);
    render(<DraftHarness publish={publish} onClose={vi.fn()} />);

    // 按钮带图标，可访问名是"图标名 + 文案"，所以用正则匹配文案部分（与 `topSave` 同款）。
    const publishName = new RegExp(t("workbench.action.publish"));
    const publishButton = await screen.findByRole("button", { name: publishName });
    // 标题旁要说清"现在还看不见它"，否则用户以为保存已经发生。
    expect(screen.getByText(t("workbench.draft.hint"))).toBeInTheDocument();
    // 草稿且干净时没有"修改"可取消，多一颗只会制造"我取消了什么"的疑问。
    expect(topCancel()).toBeNull();

    await act(async () => {
      fireEvent.click(publishButton);
    });

    expect(publish).toHaveBeenCalledTimes(1);
    // 发布成功后按钮收起：它不再是草稿了，回到"有改动才出现"的判据。
    await waitFor(() => expect(screen.queryByRole("button", { name: publishName })).toBeNull());
  });

  it("草稿什么都没改就关：也要问一句，丢的是这份简历本身", async () => {
    const onClose = vi.fn();
    render(<DraftHarness publish={async () => true} onClose={onClose} />);

    await screen.findByRole("button", { name: new RegExp(t("workbench.action.publish")) });
    fireEvent.keyDown(window, { key: "Escape" });

    // 此时 `dirty === false`，只按脏值判断就会静默关掉——那份草稿就永远消失了。
    expect(await screen.findByText(t("workbench.close.body-draft"))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
