// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");

async function proxyChild() {
  const urls = [];
  const proxy = http.createServer((request, response) => {
    urls.push(request.url);
    response.end("synthetic proxied response");
  });
  const direct = http.createServer((_request, response) => response.end("direct response"));
  await Promise.all([proxy, direct].map((server) =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));
  try {
    process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
    process.env.GLOBAL_AGENT_NO_PROXY = "127.0.0.1";
    const builderRoot = path.dirname(require.resolve("app-builder-lib/package.json"));
    const get = require(require.resolve("@electron/get", { paths: [builderRoot] }));
    get.initializeProxy();
    assert.ok(global.GLOBAL_AGENT, "the old downloader's bootstrap API must still work");
    const read = (url) => new Promise((resolve, reject) => {
      http.get(url, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve(body));
      }).on("error", reject);
    });
    assert.equal(await read("http://proxy-fixture.invalid/message"), "synthetic proxied response");
    assert.equal(await read(`http://127.0.0.1:${direct.address().port}/`), "direct response");
    assert.deepEqual(urls, ["http://proxy-fixture.invalid/message"]);
  } finally {
    await Promise.all([proxy, direct].map((server) =>
      new Promise((resolve) => server.close(resolve))));
  }
}

if (process.argv.includes("--proxy-child")) {
  proxyChild().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  // The override is declared in pnpm-workspace.yaml, but the guard must assert the
  // RESOLVED tree, not the configuration text: "the override is written down" and
  // "the override was applied" are different claims, and only the second one keeps
  // the vulnerable global-agent -> roarr -> sprintf-js logging chain out of the build.
  // The lockfile is read as text on purpose -- this repo must not grow a YAML parser
  // (see the "No new npm dependencies" note at the top of package.json).
  test("the scoped proxy override actually removes the vulnerable logging chain", () => {
    const lock = fs.readFileSync(path.join(DESKTOP, "pnpm-lock.yaml"), "utf8");
    // Two YAML documents, each with its own `packages:` section, so an entry can
    // legitimately appear twice. The gate cares about the resolved version SET.
    const versionsOf = (name) => [
      ...new Set(
        [...lock.matchAll(
          new RegExp(`^  '?${name.replace(/[/@.]/g, (c) => "\\" + c)}@([^:']+)'?:$`, "gm"),
        )].map((match) => match[1]),
      ),
    ];

    assert.deepEqual(versionsOf("global-agent"), ["4.1.3"],
      "global-agent must resolve to 4.1.3 only (the pinned override)");
    assert.deepEqual(versionsOf("roarr"), [],
      "global-agent 4.x drops the roarr dependency; its presence means the override did not apply");
    assert.deepEqual(versionsOf("sprintf-js"), [],
      "sprintf-js is pulled in only via roarr; its presence means the override did not apply");
  });

  test("the builder downloader still supports HTTP proxy and NO_PROXY in an isolated child", () => {
    const child = spawnSync(process.execPath, [__filename, "--proxy-child"], {
      cwd: DESKTOP, encoding: "utf8", timeout: 30_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}
