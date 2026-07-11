import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    // The RLS integration test at tests/rls-website-creation.test.ts is a
    // standalone script (uses process.exit); run it with `bun run test:rls`.
    environment: "node",
    testTimeout: 20_000,
  },
});
