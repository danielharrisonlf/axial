# Axial

Independent workspace: `C:/Users/daniellima/code/projetos/axial`.

- Use only GPT-6.1 Sol (`gpt-6.1-sol`) with `high` reasoning for delegated planning, implementation, testing, review and repository operations, per the user's instruction. No automatic model substitution.
- Read README.md and docs/architecture.md before changing public behavior. The final ProjectFlow presentation is the source for architecture; see docs/requirements.md.
- pnpm workspace + Turborepo, NestJS ESM, strict TypeScript, Prisma/PostgreSQL, shared Zod contracts, Biome and Vitest.
- `apps/api` contains the NestJS ms-projects service; `apps/web` contains the React/Vite Workspace authorized by the user. Preserve the supplied prototype's visual system and interactions. Identity, notifications, audit, realtime, MCP, gateway and Insights remain external boundaries.
- The web demonstration is explicitly fictional and persists separately from the original prototype. Never silently substitute demo data after a live API error or expose development private keys in web assets.
- Every service owns its schema. `ms-projects` accesses only `projects`; do not query another service's tables.
- Derive organization, subject, role and identity references from a verified signed JWT. Never authorize using arbitrary client headers/body fields.
- Scope all reads and related IDs to organization and authorized project. Validate references before mutation.
- Commit each mutation and its outbox events in one transaction. Use required resource versions and project row locking for concurrent writes.
- Keep one writer per subsystem. Do not overwrite other agents' changes. No explicit `any` or silent error fallback.
- Never commit `.env`, private keys, tokens or generated Prisma source. Local keys and seeded records are explicitly development fixtures.
- Integration/E2E writes require a database name ending in `_test`; never reset a non-test database.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:web:e2e` and validate migrations for relevant changes. Inspect browser screenshots for visual fidelity; build success does not establish fidelity.
- Root documents actual verification and remaining boundaries in docs/relatorio-ms-projects.md. External integration code is not proof of downstream delivery.
