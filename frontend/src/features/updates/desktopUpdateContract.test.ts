// SPDX-License-Identifier: Apache-2.0
/**
 * 跨语言契约：失败原因从主进程一路走到弹窗，中间**三处**都不能断。
 *
 * 为什么需要一个读源码的用例（第 11 条的根因就是这条链断了、而没有任何一个测试发现）：
 * 主进程（`desktop/lib/desktop-update-session.js`）与渲染层（本目录）是两种语言、两套
 * 测试进程，谁也不 import 谁。上线的那个缺陷正是"主进程不再发布 `errorDetail`，渲染层
 * 还在等它"——主进程用例只测主进程的状态机、前端用例只喂手写的 state，两边都绿，
 * 用户看到的却是「检查更新失败」五个字。只有把两端放在**同一个用例**里断言，才可能变红。
 *
 * 与仓库里已有的两个先例同构：`features/desktop/desktopMenuContract.test.ts`（读
 * `desktop/lib/desktop-menu.js`）与 `i18n/shellLocaleBridge.test.tsx`（读
 * `desktop/lib/shell-locale.js`）。都只读不写，断言的字段名与函数调用，不锁格式细节。
 */
// 三处 node 内置模块：仓库未装 @types/node（与 features/desktop/desktopMenuContract.test.ts
// 同一写法），vitest 本身跑在 Node 里，所以只对类型检查器屏蔽这三行。
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { dirname, resolve } from "node:path";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(resolve(HERE, ...parts), "utf8");

const SESSION = read("../../../../desktop/lib/desktop-update-session.js");
const BRIDGE = read("./desktopUpdateBridge.ts");
const PROMPT = read("./DesktopUpdatePrompt.tsx");

/**
 * 截出工厂函数内部某一个函数的源码（本文件的两个函数都缩进两空格、并列声明）。
 *
 * 不追求完整解析：只要能把 `failed` 与 `check` 分开，断言就不会被邻居的代码蒙混过关。
 */
function bodyOf(name: string): string {
  const start = SESSION.indexOf(`function ${name}(`);
  expect(start, `主进程会话里找不到 ${name}()`).toBeGreaterThanOrEqual(0);
  const rest = SESSION.slice(start);
  const next = rest.indexOf("\n  function ");
  return next < 0 ? rest : rest.slice(0, next);
}

describe("errorDetail 的三段契约", () => {
  it("① 主进程 failed() 同批带出原文（只给 error 码，弹窗里就只剩固定文案）", () => {
    const failed = bodyOf("failed");
    // 阶段码与原文必须是**同一个** report 调用：分两次报会让渲染层看到中间态。
    expect(failed).toMatch(/report\(\{[^)]*errorDetail:\s*failureDetail\(err\)/);
    // 原文截断长度是契约的一部分（300 字，见本文件头的第 11 条）：撑破弹窗或丢证据都算回归。
    expect(SESSION).toMatch(/DETAIL_LIMIT\s*=\s*300/);
  });

  it("② 下一次检查开始与启动对账都清空，原文不会粘到别的结果上", () => {
    expect(bodyOf("check")).toMatch(/phase:\s*"checking"[\s\S]*?errorDetail:\s*""/);
    expect(bodyOf("interrupted")).toMatch(/errorDetail:\s*""/);
  });

  it("③ 渲染层声明同名字段、并且真的拿它去归因（不是只声明不读）", () => {
    expect(BRIDGE).toMatch(/errorDetail:\s*string;/);
    expect(PROMPT).toMatch(/describeUpdateFailure\(state\.errorDetail/);
    // 兜底不能吞掉原文：`|| undefined` 只用于"没有描述时不要渲染空行"，
    // 描述本身是 `describeUpdateFailure(...)` 的返回值（无法归类时就是原文）。
    expect(PROMPT).toMatch(/description=\{failureDetail \|\| undefined\}/);
  });
});
