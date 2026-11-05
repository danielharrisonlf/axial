-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "projects";

-- CreateTable
CREATE TABLE "projects"."Project" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" VARCHAR(12) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "leadId" UUID,
    "teamIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "startDate" TIMESTAMPTZ(3),
    "endDate" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "taskSequence" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."Epic" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "ownerId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."Sprint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" TIMESTAMPTZ(3) NOT NULL,
    "endDate" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."Task" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "ref" VARCHAR(32) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'task',
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigneeId" UUID,
    "teamId" UUID,
    "epicId" UUID,
    "sprintId" UUID,
    "parentId" UUID,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimate" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMPTZ(3),
    "dueDate" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."TaskDependency" (
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "projects"."Comment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."Milestone" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects"."OutboxEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "actorId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "lockToken" UUID,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_organizationId_archivedAt_createdAt_idx" ON "projects"."Project"("organizationId", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_key_key" ON "projects"."Project"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_organizationId_key" ON "projects"."Project"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Epic_organizationId_projectId_createdAt_idx" ON "projects"."Epic"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_id_organizationId_projectId_key" ON "projects"."Epic"("id", "organizationId", "projectId");

-- CreateIndex
CREATE INDEX "Sprint_organizationId_projectId_status_idx" ON "projects"."Sprint"("organizationId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_id_organizationId_projectId_key" ON "projects"."Sprint"("id", "organizationId", "projectId");

-- CreateIndex
CREATE INDEX "Task_organizationId_projectId_status_position_idx" ON "projects"."Task"("organizationId", "projectId", "status", "position");

-- CreateIndex
CREATE INDEX "Task_organizationId_assigneeId_status_idx" ON "projects"."Task"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_organizationId_sprintId_idx" ON "projects"."Task"("organizationId", "sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_projectId_number_key" ON "projects"."Task"("organizationId", "projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_ref_key" ON "projects"."Task"("organizationId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_organizationId_projectId_key" ON "projects"."Task"("id", "organizationId", "projectId");

-- CreateIndex
CREATE INDEX "TaskDependency_organizationId_projectId_idx" ON "projects"."TaskDependency"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "Comment_organizationId_taskId_createdAt_idx" ON "projects"."Comment"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Milestone_organizationId_projectId_date_idx" ON "projects"."Milestone"("organizationId", "projectId", "date");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_availableAt_lockedUntil_idx" ON "projects"."OutboxEvent"("publishedAt", "availableAt", "lockedUntil");

-- CreateIndex
CREATE INDEX "OutboxEvent_organizationId_aggregateId_occurredAt_idx" ON "projects"."OutboxEvent"("organizationId", "aggregateId", "occurredAt");

-- AddForeignKey
ALTER TABLE "projects"."Epic" ADD CONSTRAINT "Epic_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"."Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Sprint" ADD CONSTRAINT "Sprint_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"."Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"."Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_epicId_organizationId_projectId_fkey" FOREIGN KEY ("epicId", "organizationId", "projectId") REFERENCES "projects"."Epic"("id", "organizationId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_sprintId_organizationId_projectId_fkey" FOREIGN KEY ("sprintId", "organizationId", "projectId") REFERENCES "projects"."Sprint"("id", "organizationId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_parentId_organizationId_projectId_fkey" FOREIGN KEY ("parentId", "organizationId", "projectId") REFERENCES "projects"."Task"("id", "organizationId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_organizationId_projectId_fkey" FOREIGN KEY ("taskId", "organizationId", "projectId") REFERENCES "projects"."Task"("id", "organizationId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_organizationId_projectId_fkey" FOREIGN KEY ("dependsOnId", "organizationId", "projectId") REFERENCES "projects"."Task"("id", "organizationId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Comment" ADD CONSTRAINT "Comment_taskId_organizationId_projectId_fkey" FOREIGN KEY ("taskId", "organizationId", "projectId") REFERENCES "projects"."Task"("id", "organizationId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects"."Milestone" ADD CONSTRAINT "Milestone_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "projects"."Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants remain enforced for concurrent writers and direct database clients.
CREATE UNIQUE INDEX "Sprint_one_active_per_project" ON "projects"."Sprint" ("organizationId", "projectId") WHERE "status" = 'active';
ALTER TABLE "projects"."Project" ADD CONSTRAINT "Project_dates" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
ALTER TABLE "projects"."Project" ADD CONSTRAINT "Project_status" CHECK ("status" IN ('active', 'paused', 'done'));
ALTER TABLE "projects"."Project" ADD CONSTRAINT "Project_version" CHECK ("version" > 0 AND "taskSequence" >= 0);
ALTER TABLE "projects"."Sprint" ADD CONSTRAINT "Sprint_dates" CHECK ("startDate" < "endDate");
ALTER TABLE "projects"."Sprint" ADD CONSTRAINT "Sprint_status" CHECK ("status" IN ('planned', 'active', 'done'));
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_status" CHECK ("status" IN ('backlog', 'todo', 'in_progress', 'in_review', 'done'));
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_type_parent" CHECK (("type" = 'subtask') = ("parentId" IS NOT NULL) AND "type" IN ('task', 'bug', 'subtask'));
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_dates" CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "startDate" <= "dueDate");
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_numbers" CHECK ("number" > 0 AND "version" > 0 AND "position" >= 0 AND ("estimate" IS NULL OR "estimate" >= 0));
ALTER TABLE "projects"."TaskDependency" ADD CONSTRAINT "TaskDependency_no_self" CHECK ("taskId" <> "dependsOnId");
ALTER TABLE "projects"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_version" CHECK ("eventVersion" > 0 AND "aggregateVersion" > 0 AND "attempts" >= 0);
