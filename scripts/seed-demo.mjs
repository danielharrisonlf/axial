import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm db:seed:demo`: the fictional Vetor Labs/Atlas scenario (packages/demo-fixtures) in every
// service that owns part of it. Order matters: identity → projects → audit. Each step writes only
// its own schema, is insert only and idempotent, and refuses production and non *_dev databases.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const steps = [
  // TODO(identity): add the ms-identity demo seed here, first, once it exists
  // (organizations, users, members, teams, team_members and project_assignments from @axial/demo-fixtures).
  ["projects", ["--filter", "@axial/ms-projects", "db:seed"]],
  ["audit", ["--filter", "@axial/ms-audit", "db:seed"]],
];
for (const [name, args] of steps) {
  console.log(`[seed] ${name}`);
  const result = spawnSync(pnpm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`Demo seed step ${name} failed (exit ${result.status})`);
}
