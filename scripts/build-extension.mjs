import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist/extension");
const allUrls = process.argv.includes("--all-urls");
const watch = process.argv.includes("--watch");

const define = { "process.env.NODE_ENV": JSON.stringify("production") };

function config(entry, outFile) {
  return {
    configFile: false,
    root,
    logLevel: "warn",
    define,
    build: {
      outDir,
      emptyOutDir: false,
      target: "chrome116",
      minify: !watch,
      sourcemap: false,
      ...(watch ? { watch: {} } : {}),
      rollupOptions: {
        input: resolve(root, entry),
        output: {
          format: "iife",
          entryFileNames: outFile,
        },
      },
    },
    plugins: [react()],
  };
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(root, "src/extension/manifest.json"), "utf8"));
if (allUrls) {
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), "<all_urls>"])];
  manifest.content_scripts[0].matches = [
    ...new Set([...manifest.content_scripts[0].matches, "<all_urls>"]),
  ];
}
await writeFile(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

await Promise.all([
  build(config("src/extension/content/index.tsx", "content.js")),
  build(config("src/extension/background.ts", "background.js")),
]);

if (!watch) {
  console.log(`[site-inspector] extension built → ${outDir}${allUrls ? " (all_urls)" : ""}`);
}
