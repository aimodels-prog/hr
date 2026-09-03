import { defineConfig, loadEnv } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: envDefine,
    css: { transformer: "lightningcss" },
    resolve: {
      tsconfigPaths: true,
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      // Server-only Start internals and spreadsheet parsers contain conditional package exports
      // that must be resolved by the SSR build, not pre-bundled into the browser dependency graph.
      exclude: [
        "@tanstack/react-start",
        "@tanstack/start-server-core",
        "read-excel-file",
        "csv-parse",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: 8080 },
    plugins: [
      ...(mode === "development"
        ? [
            devtools({
              logging: false,
              eventBusConfig: { enabled: false },
              enhancedLogs: { enabled: false },
              consolePiping: { enabled: false },
              removeDevtoolsOnBuild: false,
              injectSource: { enabled: true },
            }),
          ]
        : []),
      tailwindcss(),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
        server: { entry: "server" },
      }),
      // VIA HR System is deployed as a long-running Node service on Contabo.
      // Keep this explicit so a CI environment cannot silently select an edge preset.
      ...(command === "build"
        ? [
            nitro({
              defaultPreset: "node",
              // Nitro 3's current Vite/Rolldown chunk splitting can emit an SSR re-export
              // without its generated namespace declaration. A single server bundle avoids
              // that invalid cross-chunk export and is appropriate for VIA's long-running
              // Contabo Node process.
              rolldownConfig: { output: { inlineDynamicImports: true } },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
