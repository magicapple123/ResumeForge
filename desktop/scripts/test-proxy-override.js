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
  test("the scoped proxy override actually removes the vulnerable logging chain", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package-lock.json"), "utf8"));
    assert.equal(pkg.overrides["@electron/get@3.1.0"]["global-agent"], "4.1.3");
    const agents = Object.entries(lock.packages).filter(([name]) => name.endsWith("/global-agent"));
    assert.ok(agents.length > 0);
    assert.ok(agents.every(([, entry]) => entry.version === "4.1.3"));
    assert.ok(!Object.keys(lock.packages).some((name) => /\/(roarr|sprintf-js)$/.test(name)));
  });

  test("the builder downloader still supports HTTP proxy and NO_PROXY in an isolated child", () => {
    const child = spawnSync(process.execPath, [__filename, "--proxy-child"], {
      cwd: DESKTOP, encoding: "utf8", timeout: 30_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}
