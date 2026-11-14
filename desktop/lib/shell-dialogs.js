// SPDX-License-Identifier: Apache-2.0
"use strict";

// 主进程侧的原生对话框文案装配：旧数据迁移确认、迁移标记与库不一致的恢复、崩溃预算耗尽。
//
// 为什么单独一个模块：main.js 受 500 行预算约束（backend/tests/test_file_size_budget.py
// 的 desktop 扩面），而这一批要给每个对话框加"跟随应用内语言"的查表。文案与装配分开后，
// 文案表只在 lib/shell-locale.js 一处，本模块只把键拼成 Electron dialog 的参数。
//
// 不 require("electron")：dialog 由 main.js 注入，离线用例可以直接断言参数。

const { t } = require("./shell-locale");

/**
 * @param {object} deps
 * @param {object} deps.dialog Electron dialog（showMessageBox / showErrorBox）
 * @param {function(): ("zh" | "en")} [deps.getLocale] 当前壳层语言
 */
function createShellDialogs(deps) {
  const { dialog } = deps;
  const getLocale = typeof deps.getLocale === "function" ? deps.getLocale : () => "en";

  /**
   * ADR-0004 旧数据迁移确认框。
   *
   * @param {{from: string, to: string, reason: (string|null)}} details
   * @returns {Promise<boolean>} true = 用户同意迁移
   */
  function confirmDataMigration(details) {
    const locale = getLocale();
    // marker 在、数据库没了：说明上一次迁移被撤销或结果被移走，不能假装是"首次迁移"。
    const incomplete =
      details.reason === "marker-without-database"
        ? t(locale, "migration.confirm.repeatNote")
        : "";
    return dialog
      .showMessageBox({
        type: "question",
        title: t(locale, "app.name"),
        message: t(locale, "migration.confirm.message"),
        detail:
          t(locale, "migration.confirm.body") +
          incomplete +
          t(locale, "migration.confirm.locations", { from: details.from, to: details.to }),
        buttons: [
          t(locale, "migration.confirm.button.migrate"),
          t(locale, "migration.confirm.button.later"),
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => response === 0);
  }

  /**
   * 迁移标记在、数据库在哪都找不到：fail closed（RR-06）。
   *
   * 返回 true = 用户明确选择"创建全新数据库"；false = 先去恢复备份（调用方退出）。
   *
   * @param {string} message data-migration.js 给出的不一致说明
   * @returns {Promise<boolean>}
   */
  async function confirmFreshStart(message) {
    const locale = getLocale();
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: t(locale, "app.name"),
      message: t(locale, "migration.recovery.title"),
      detail: t(locale, "migration.recovery.detail", { message }),
      buttons: [
        t(locale, "migration.recovery.button.quit"),
        t(locale, "migration.recovery.button.createFresh"),
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response === 1;
  }

  /**
   * 崩溃预算耗尽：这条路没有可操作的下一步，用没有按钮的 showErrorBox 是对的。
   *
   * @param {{count: number, minutes: number, logHint: string}} info
   */
  function reportCrashBudgetExhausted({ count, minutes, logHint }) {
    const locale = getLocale();
    dialog.showErrorBox(
      t(locale, "app.name"),
      t(locale, "crashBudget.body", { count, minutes, logHint }),
    );
  }

  return { confirmDataMigration, confirmFreshStart, reportCrashBudgetExhausted };
}

module.exports = { createShellDialogs };
