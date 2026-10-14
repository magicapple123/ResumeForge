"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("splash only chooses controlled icon paths and falls back to packaged extraResources", () => {
  const source = fs.readFileSync(path.join(__dirname, "../splash.html"), "utf8");
  const script = source.split("<script>")[1].split("</script>")[0];
  const listeners = new Map();
  const element = { style: {}, classList: { add() {}, remove() {} } };
  const logo = {
    src: null,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  vm.runInNewContext(script, {
    document: { getElementById: (name) => name === "logo" ? logo : element },
    window: { splash: { onStage() {} } },
    location: { search: "?icon=javascript:synthetic-untrusted" },
  });
  assert.equal(logo.src, "icon.png");
  assert.equal(typeof listeners.get("error"), "function");
  listeners.get("error")();
  assert.equal(logo.src, "../icon.png", "the controlled extraResources asset exists outside app.asar");
  assert.equal(listeners.has("error"), false, "a missing extra resource must not cause an error loop");
});
