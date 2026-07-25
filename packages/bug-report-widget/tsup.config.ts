import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    client: "src/client.tsx",
    server: "src/server.ts",
    next: "src/next.ts",
    cli: "src/cli.ts"
  },
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  external: ["react", "react/jsx-runtime", "server-only"]
});
