# Auto-Accept & Autonomous Execution Policy

## Core Directives
1. **Always Proceed**: Execute all necessary file reads, edits, creations, terminal commands, builds, typechecks, and tests proactively without stopping to ask for manual confirmation.
2. **Proactive Verification**: When making changes, automatically run verification commands (e.g., `npx tsc --noEmit`, `npm run build`, `node --check`) and fix any surfaced errors immediately.
3. **End-to-End Task Completion**: Complete multi-step workflows thoroughly, self-heal issues, and report the final status with clear summaries.
