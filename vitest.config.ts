import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Most tests are pure unit; the RLS integration test hits the network and
    // is only included when SUPABASE creds + auth are present in env.
    environment: "node",
    testTimeout: 20_000,
  },
});
