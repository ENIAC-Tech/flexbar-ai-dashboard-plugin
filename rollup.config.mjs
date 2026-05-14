import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import json from '@rollup/plugin-json';
import { glob } from 'glob'
const isWatching = !!process.env.ROLLUP_WATCH;
const flexPlugin = "com.aspen.flexbar-ai-dashboard.plugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
  input: "src/plugin.js",
  output: {
    file: `${flexPlugin}/backend/plugin.cjs`,
    format: "cjs",
    sourcemap: isWatching,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
    },
  },
  plugins: [
    json(),
    {
      name: "watch-externals",
      buildStart: function () {
        this.addWatchFile(`${flexPlugin}/manifest.json`);
        const vueFiles = glob.sync(`${flexPlugin}/ui/*.vue`);
        vueFiles.forEach((file) => {
          this.addWatchFile(file);
        });
      },
    },
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true
    }),
    commonjs(),
    patchFlexdesignerTransportRetry(),
    !isWatching && terser(),
    {
      name: "copy-native-canvas",
      generateBundle() {
        copyPackageToBackend("@napi-rs/canvas");
        const nativePackage = nativeCanvasPackage();
        if (nativePackage) copyPackageToBackend(nativePackage);
      }
    },
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
      }
    }
  ],
  external: id => id.endsWith('.node')
};

function copyPackageToBackend(packageName) {
  const source = path.join("node_modules", ...packageName.split("/"));
  if (!fs.existsSync(source)) return;

  const destination = path.join(flexPlugin, "backend", "node_modules", ...packageName.split("/"));
  const canReuseLockedCanvasPackage = isCanvasPackage(packageName) && fs.existsSync(destination);
  try {
    fs.rmSync(destination, { recursive: true, force: true });
  } catch (error) {
    if (canReuseLockedCanvasPackage && error && error.code === "EPERM") return;
    throw error;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function isCanvasPackage(packageName) {
  return /^@napi-rs\/canvas(?:-|$)/.test(packageName);
}

function nativeCanvasPackage() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32" && arch === "x64") return "@napi-rs/canvas-win32-x64-msvc";
  if (platform === "darwin" && arch === "x64") return "@napi-rs/canvas-darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "@napi-rs/canvas-darwin-arm64";
  if (platform === "linux" && arch === "x64") return "@napi-rs/canvas-linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "@napi-rs/canvas-linux-arm64-gnu";
  if (platform === "linux" && arch === "arm") return "@napi-rs/canvas-linux-arm-gnueabihf";
  if (platform === "android" && arch === "arm64") return "@napi-rs/canvas-android-arm64";

  return null;
}

function patchFlexdesignerTransportRetry() {
  return {
    name: "patch-flexdesigner-transport-retry",
    transform(code, id) {
      const normalizedId = id.split(path.sep).join("/");
      if (!normalizedId.endsWith("/@eniac/flexdesigner/dist/transport.js")) return null;

      const unboundRetry = "setTimeout(this.start, 5000);";
      if (!code.includes(unboundRetry)) return null;

      return {
        code: code.replaceAll(unboundRetry, "setTimeout(() => this.start(), 5000);"),
        map: null,
      };
    },
  };
}

export default config;
