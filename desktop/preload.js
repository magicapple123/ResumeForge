"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splash", {
  onStage: (callback) =>
    ipcRenderer.on("splash:stage", (_event, payload) => callback(payload)),
});
