// SPDX-License-Identifier: Apache-2.0
/**
 * F17 发音词表：三项映射、最长匹配、词边界（`MySQL2` 不替换）、大小写敏感、幂等。
 *
 * 守的是"读错"这件事——`MySQL` 被逐字母念成 "my S Q L" 时用户立刻能听出来，
 * 而 `MySQL2` 被改成 "my sequel 2" 则是另一种错。
 */
import { describe, expect, it } from "vitest";
import { applyPronunciation } from "./speechPronunciation";

describe("applyPronunciation", () => {
  it("三条术语映射各自生效", () => {
    expect(applyPronunciation("MySQL")).toBe("my sequel");
    expect(applyPronunciation("PostgreSQL")).toBe("postgres sequel");
    expect(applyPronunciation("SQLite")).toBe("sequel lite");
    expect(applyPronunciation("SQL")).toBe("sequel");
  });

  it("最长匹配优先：长词不会被短词先吃掉", () => {
    expect(applyPronunciation("PostgreSQL 和 SQLite 都用 SQL")).toBe(
      "postgres sequel 和 sequel lite 都用 sequel",
    );
  });

  it("词边界：后面紧跟数字或字母时不替换", () => {
    expect(applyPronunciation("MySQL2")).toBe("MySQL2");
    expect(applyPronunciation("MySQLX")).toBe("MySQLX");
    expect(applyPronunciation("xSQLite")).toBe("xSQLite");
  });

  it("大小写敏感：全小写的写法是代码片段，保持原样", () => {
    expect(applyPronunciation("mysql")).toBe("mysql");
    expect(applyPronunciation("sqlite3")).toBe("sqlite3");
  });

  it("中文夹着术语、术语被标点包住，都按词边界替换", () => {
    expect(applyPronunciation("用MySQL存数据")).toBe("用my sequel存数据");
    expect(applyPronunciation("（MySQL）")).toBe("（my sequel）");
  });

  it("幂等：替换结果不会再命中，重复调用不累积", () => {
    const once = applyPronunciation("MySQL 与 PostgreSQL");
    expect(applyPronunciation(once)).toBe(once);
  });

  it("空文本原样返回", () => {
    expect(applyPronunciation("")).toBe("");
  });
});
