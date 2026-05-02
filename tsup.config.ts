import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // CLI is invoked via the `bin` shim, never imported. Single ESM build is
  // enough — drop CJS to keep `dist/` lean.
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node18",
  minify: false,
  splitting: false,
  shims: false,
  // Keep `propline` and `commander` as runtime deps so installing
  // propline-cli pulls them in via npm rather than baking copies into
  // the bundle. propline is on a semver caret so SDK updates flow
  // through without a CLI republish.
  external: ["propline", "commander"],
  banner: { js: "#!/usr/bin/env node" },
});
