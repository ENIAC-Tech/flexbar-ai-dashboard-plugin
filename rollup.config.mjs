import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import json from "@rollup/plugin-json";

const isWatching = !!process.env.ROLLUP_WATCH;
const flexPlugin = "com.aspen.flexbar-ai-dashboard.plugin";

function listUiVueFiles(uiDir) {
  if (!fs.existsSync(uiDir)) return [];
  return fs.readdirSync(uiDir)
    .filter((name) => name.endsWith(".vue"))
    .map((name) => path.join(uiDir, name));
}

/** @param {import("rollup").RollupLog} warning */
function suppressKnownRollupWarnings(warning) {
  if (warning.code === "CIRCULAR_DEPENDENCY") {
    const cycle = warning.ids?.join("/") || "";
    if (
      cycle.includes("readable-stream/") ||
      cycle.includes("async/") ||
      cycle.includes("winston/")
    ) {
      return;
    }
  }

  if (
    warning.code === "THIS_IS_UNDEFINED" &&
    warning.id?.includes("@eniac/flexdesigner/dist/transport.js")
  ) {
    return;
  }

  console.warn(warning.message);
}

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
  input: "src/plugin.js",
  onwarn: suppressKnownRollupWarnings,
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
        for (const file of listUiVueFiles(path.join(flexPlugin, "ui"))) {
          this.addWatchFile(file);
        }
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
