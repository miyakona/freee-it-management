#!/usr/bin/env node

// Keep a stable executable entrypoint for npx/npm global installs.
// Actual implementation lives in the compiled output.
await import("../dist/cli.js");

