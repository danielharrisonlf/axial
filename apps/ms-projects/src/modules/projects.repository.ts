import type { AuthContext, DomainEventType } from "@axial/contracts";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Project } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../infra/database/prisma.service.js";

export type Transaction = Prisma.TransactionClient;
export const isManager = (actor: AuthContext) => actor.role === "ADMIN" || actor.role === "PROJECT_MANAGER";

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(PrismaService) readonly db: PrismaService) {}

  scope(actor: AuthContext): Prisma.ProjectWhereInput {
    return {
      organizationId: actor.organizationId,
      ...(isManager(actor)
        ? {}
        : { OR: [{ id: { in: actor.projectIds } }, { teamIds: { hasSome: actor.teamIds } }] }),
    };
  }

  async project(actor: AuthContext, id: string, tx: Transaction = this.db): Promise<Project> {
    const project = await tx.project.findFirst({ where: { ...this.scope(actor), id } });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  async mutate<T>(
    actor: AuthContext,
    projectId: string,
    operation: (tx: Transaction, project: Project) => Promise<T>,
    allowArchived = false,
  ): Promise<T> {
    return this.transaction(async (tx) => {
      // The tenant-scoped lock serializes aggregate validation and writes (including dependencies).
      await tx.$queryRaw`SELECT "id" FROM "projects"."Project" WHERE "id" = ${projectId}::uuid AND "organizationId" = ${actor.organizationId}::uuid FOR UPDATE`;
      const project = await this.project(actor, projectId, tx);
      if (project.archivedAt && !allowArchived)
        throw new ConflictException("Archived projects are read only");
      return operation(tx, project);
    });
  }

  async transaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.$transaction(operation, { maxWait: 10000, timeout: 20000 });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002")
          throw new ConflictException("A unique value or active sprint already exists");
        if (error.code === "P2003") throw new ConflictException("Resource is still referenced");
        if (error.code === "P2025") throw new NotFoundException("Resource not found");
      }
      throw error;
    }
  }

  async event(
    tx: Transaction,
    actor: AuthContext,
    projectId: string,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    eventType: DomainEventType,
    before: unknown,
    after: unknown,
  ) {
    await tx.outboxEvent.create({
      data: {
        organizationId: actor.organizationId,
        projectId,
        aggregateType,
        aggregateId,
        aggregateVersion,
        eventType,
        actorId: actor.userId,
        source: actor.source,
        correlationId: actor.correlationId,
        payload: JSON.parse(JSON.stringify({ before, after })) as Prisma.InputJsonObject,
      },
    });
  }
}
