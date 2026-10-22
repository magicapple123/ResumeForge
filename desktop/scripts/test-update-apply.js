// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新原子化（任务 11）的文件系统用例。
//
// 关注点不是"能不能复制文件"，而是**失败语义**：
//   - 校验没过 -> 新版本目录被清掉，current 指针一动不动；
//   - 校验通过 -> 才切 current；
//   - 回滚能回到上一版，prune 只保留最近 N 个；
//   - 版本号是路径的一部分，必须拒绝 ".." 和路径分隔符。
//
// 这些约束在接线到真实安装流程之前先用测试钉住：等 NSIS 覆盖安装被替换成
// versions/ + current 时，回退能力已经是"被证明过"的。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const {
  applyVersion,
  compareVersions,
  currentPointerPath,
  listInstalledVersions,
  parseVersion,
  pruneVersions,
  readCurrent,
  rollback,
  versionDir,
  versionsRoot,
  writeCurrent,
} = require("../lib/update-apply");
const { makeTempRoot } = require("./testkit");

// 造一个"待安装目录"，内容能区分版本即可。
function makeStaging(root, label) {
  const dir = path.join(root, `staging-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "payload.txt"), label);
  return dir;
}

test("applyVersion：校验通过才切换 current，并留下完整的版本目录", async () => {
  const root = makeTempRoot("apply-ok");
  try {
    const runtimeDir = path.join(root, "runtime");
    assert.strictEqual(readCurrent(runtimeDir), null, "没有任何指针时返回 null");

    const result = await applyVersion({
      runtimeDir,
      version: "1.0.3",
      stagingDir: makeStaging(root, "v103"),
      verify: async (dir) => fs.readFileSync(path.join(dir, "payload.txt"), "utf-8") === "v103",
    });

    assert.strictEqual(result.version, "1.0.3");
    assert.strictEqual(result.dir, path.join(versionsRoot(runtimeDir), "1.0.3"));
    assert.strictEqual(
      fs.readFileSync(path.join(result.dir, "payload.txt"), "utf-8"),
      "v103",
      "版本目录里必须是这一版的完整内容",
    );
    assert.strictEqual(readCurrent(runtimeDir), "1.0.3", "校验通过后才切换指针");
    assert.strictEqual(
      fs.readFileSync(currentPointerPath(runtimeDir), "utf-8").trim(),
      "1.0.3",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applyVersion：verify 返回假值时 current 保持不变，新目录被清理", async () => {
  const root = makeTempRoot("apply-verify-false");
  try {
    const runtimeDir = path.join(root, "runtime");
    // 先装好一个可用的当前版本。
    await applyVersion({
      runtimeDir,
      version: "1.0.2",
      stagingDir: makeStaging(root, "v102"),
      verify: async () => true,
    });
    assert.strictEqual(readCurrent(runtimeDir), "1.0.2");

    await assert.rejects(
      applyVersion({
        runtimeDir,
        version: "1.0.3",
        stagingDir: makeStaging(root, "v103-broken"),
        verify: async () => false,
      }),
      /校验未通过/,
    );

    assert.strictEqual(readCurrent(runtimeDir), "1.0.2", "失败的版本绝不能切换指针");
    assert.strictEqual(
      fs.existsSync(versionDir(runtimeDir, "1.0.3")),
      false,
      "校验失败的版本目录必须删掉，不能留在 versions/ 里冒充可用版本",
    );
    assert.strictEqual(
      fs.existsSync(versionDir(runtimeDir, "1.0.2")),
      true,
      "当前版本不受影响",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applyVersion：verify 自己抛错同样不切换、不残留目录", async () => {
  const root = makeTempRoot("apply-verify-throw");
  try {
    const runtimeDir = path.join(root, "runtime");
    await assert.rejects(
      applyVersion({
        runtimeDir,
        version: "1.0.3",
        stagingDir: makeStaging(root, "v103"),
        verify: async () => {
          throw new Error("环境自检失败");
        },
      }),
      /环境自检失败/,
    );
    assert.strictEqual(readCurrent(runtimeDir), null);
    assert.strictEqual(fs.existsSync(versionDir(runtimeDir, "1.0.3")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applyVersion：待安装目录不存在时立刻失败（不留下空版本）", async () => {
  const root = makeTempRoot("apply-missing-staging");
  try {
    const runtimeDir = path.join(root, "runtime");
    await assert.rejects(
      applyVersion({ runtimeDir, version: "1.0.3", stagingDir: path.join(root, "nope") }),
      /待安装目录不存在/,
    );
    assert.strictEqual(readCurrent(runtimeDir), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rollback：切回上一个已安装版本，没有可回滚版本时抛错", async () => {
  const root = makeTempRoot("rollback");
  try {
    const runtimeDir = path.join(root, "runtime");
    for (const version of ["1.0.1", "1.0.2", "1.0.3"]) {
      await applyVersion({
        runtimeDir,
        version,
        stagingDir: makeStaging(root, version.replace(/\./g, "")),
        verify: async () => true,
      });
    }
    assert.strictEqual(readCurrent(runtimeDir), "1.0.3");

    const result = rollback({ runtimeDir, currentVersion: "1.0.3" });
    assert.strictEqual(result.version, "1.0.2", "回滚目标是当前版本之外最新的一个");
    assert.strictEqual(result.from, "1.0.3");
    assert.strictEqual(readCurrent(runtimeDir), "1.0.2", "指针必须真的切回去");

    // 只剩当前版本时没有可回滚的对象：抛错，绝不留一个指向空目录的指针。
    fs.rmSync(versionDir(runtimeDir, "1.0.1"), { recursive: true, force: true });
    fs.rmSync(versionDir(runtimeDir, "1.0.3"), { recursive: true, force: true });
    assert.throws(() => rollback({ runtimeDir }), /没有可回滚的版本/);
    assert.strictEqual(readCurrent(runtimeDir), "1.0.2");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pruneVersions：按 semver 保留最近 2 个，其余删除", async () => {
  const root = makeTempRoot("prune");
  try {
    const runtimeDir = path.join(root, "runtime");
    // 故意用非字典序的版本号：字符串排序会把 1.0.10 排在 1.0.9 前面。
    for (const version of ["1.0.9", "1.0.10", "1.0.2", "1.0.11"]) {
      await applyVersion({
        runtimeDir,
        version,
        stagingDir: makeStaging(root, version.replace(/\./g, "-")),
        verify: async () => true,
      });
    }
    assert.deepStrictEqual(listInstalledVersions(runtimeDir), ["1.0.11", "1.0.10", "1.0.9", "1.0.2"]);

    const result = pruneVersions({ runtimeDir, keep: 2 });
    assert.deepStrictEqual(result.kept, ["1.0.11", "1.0.10"]);
    assert.deepStrictEqual(result.removed.sort(), ["1.0.2", "1.0.9"]);
    assert.deepStrictEqual(listInstalledVersions(runtimeDir), ["1.0.11", "1.0.10"]);
    assert.strictEqual(fs.existsSync(versionDir(runtimeDir, "1.0.2")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("版本号是路径的一部分：拒绝 .. 与路径分隔符（目录穿越）", async () => {
  const root = makeTempRoot("version-validation");
  try {
    const runtimeDir = path.join(root, "runtime");
    const staging = makeStaging(root, "evil");
    for (const version of ["../evil", "1.0.3/../../evil", "..", "1.0", "v1.0.3", "1.0.3\\evil", ""]) {
      assert.strictEqual(parseVersion(version), null, `必须拒绝版本号 ${JSON.stringify(version)}`);
      await assert.rejects(
        applyVersion({ runtimeDir, version, stagingDir: staging, verify: async () => true }),
      );
    }
    assert.strictEqual(fs.existsSync(path.join(root, "evil")), false,
      "任何被拒绝的版本号都不能在 runtimeDir 之外留下目录");
    assert.strictEqual(readCurrent(runtimeDir), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writeCurrent / readCurrent：临时文件 + rename，坏指针读成 null", () => {
  const root = makeTempRoot("current-pointer");
  try {
    const runtimeDir = path.join(root, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    assert.throws(() => writeCurrent(runtimeDir, ".."), /非法版本号/);

    writeCurrent(runtimeDir, "2.0.0");
    assert.strictEqual(readCurrent(runtimeDir), "2.0.0");
    const leftovers = fs.readdirSync(runtimeDir).filter((name) => name.includes(".tmp-"));
    assert.deepStrictEqual(leftovers, [], "rename 之后不应残留临时文件");

    fs.writeFileSync(currentPointerPath(runtimeDir), "not-a-version\n");
    assert.strictEqual(readCurrent(runtimeDir), null, "坏指针按「未知版本」处理，不抛");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("compareVersions：正式版高于预发布版，构建元数据不参与比较", () => {
  assert.ok(compareVersions("1.0.10", "1.0.9") > 0);
  assert.ok(compareVersions("1.0.3-rc.1", "1.0.3") < 0);
  assert.strictEqual(compareVersions("1.0.3+build.7", "1.0.3"), 0);
});
