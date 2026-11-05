import type {
  AuthContext,
  CreateComment,
  CreateEpic,
  CreateMilestone,
  CreateProject,
  CreateSprint,
  CreateTask,
  MoveTask,
  Pagination,
  ProjectList,
  TaskList,
  UpdateComment,
  UpdateEpic,
  UpdateMilestone,
  UpdateProject,
  UpdateSprint,
  UpdateTask,
} from "@axial/contracts";
import {
  createCommentSchema,
  createEpicSchema,
  createMilestoneSchema,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
  moveTaskSchema,
  paginationSchema,
  projectListSchema,
  taskListSchema,
  updateCommentSchema,
  updateEpicSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateSprintSchema,
  updateTaskSchema,
  versionSchema,
} from "@axial/contracts";
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentActor } from "../common/auth/current-actor.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

type BodySchema = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>["schema"];
const input = (schema: z.ZodType) => ApiBody({ schema: z.toJSONSchema(schema) as BodySchema });
const filters = (schema: z.ZodObject) => {
  const properties = z.toJSONSchema(schema).properties ?? {};
  return applyDecorators(
    ...Object.entries(properties).map(([name, field]) =>
      ApiQuery({ name, required: false, schema: field as BodySchema }),
    ),
  );
};
const deleteVersion = z.object({ version: z.coerce.number().int().positive() }).strict();
type Version = z.infer<typeof versionSchema>;

@ApiTags("Projects")
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly service: ProjectsService) {}

  @Get("projects")
  @filters(projectListSchema)
  @ApiOperation({ summary: "List accessible projects with pagination and archive/status/search filters" })
  listProjects(
    @CurrentActor() actor: AuthContext,
    @Query(new ZodValidationPipe(projectListSchema)) query: ProjectList,
  ) {
    return this.service.listProjects(actor, query);
  }

  @Post("projects")
  @ApiOperation({ summary: "Create a project with an immutable project key" })
  @input(createProjectSchema)
  createProject(
    @CurrentActor() actor: AuthContext,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject,
  ) {
    return this.service.createProject(actor, body);
  }

  @Get("projects/:id")
  @ApiOperation({ summary: "Get an accessible project" })
  getProject(@CurrentActor() actor: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.getProject(actor, id);
  }

  @Patch("projects/:id")
  @ApiOperation({ summary: "Update a project using its current version" })
  @input(updateProjectSchema)
  updateProject(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProject,
  ) {
    return this.service.updateProject(actor, id, body);
  }

  @Post("projects/:id/archive")
  @ApiOperation({ summary: "Archive a project and prevent further writes" })
  @input(versionSchema)
  archiveProject(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(versionSchema)) body: Version,
  ) {
    return this.service.archiveProject(actor, id, body.version);
  }

  @Post("projects/:id/restore")
  @ApiOperation({ summary: "Restore an archived project" })
  @input(versionSchema)
  restoreProject(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(versionSchema)) body: Version,
  ) {
    return this.service.archiveProject(actor, id, body.version, true);
  }

  @Get("projects/:projectId/epics")
  @filters(paginationSchema)
  @ApiOperation({ summary: "List project epics with pagination" })
  listEpics(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(paginationSchema.strict())) query: Pagination,
  ) {
    return this.service.listEpics(actor, projectId, query);
  }

  @Post("projects/:projectId/epics")
  @ApiOperation({ summary: "Create a project epic" })
  @input(createEpicSchema)
  createEpic(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createEpicSchema)) body: CreateEpic,
  ) {
    return this.service.createEpic(actor, projectId, body);
  }

  @Get("epics/:id")
  @ApiOperation({ summary: "Get an epic" })
  getEpic(@CurrentActor() actor: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.getEpic(actor, id);
  }

  @Patch("epics/:id")
  @ApiOperation({ summary: "Update an epic" })
  @input(updateEpicSchema)
  updateEpic(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEpicSchema)) body: UpdateEpic,
  ) {
    return this.service.updateEpic(actor, id, body);
  }

  @Delete("epics/:id")
  @ApiOperation({ summary: "Delete an unreferenced epic" })
  @ApiQuery({ name: "version", type: Number, required: true })
  deleteEpic(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteVersion)) query: Version,
  ) {
    return this.service.deleteEpic(actor, id, query.version);
  }

  @Get("projects/:projectId/tasks")
  @filters(taskListSchema)
  @ApiOperation({ summary: "List and filter project tasks with pagination" })
  listTasks(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(taskListSchema)) query: TaskList,
  ) {
    return this.service.listTasks(actor, projectId, query);
  }

  @Post("projects/:projectId/tasks")
  @ApiOperation({ summary: "Create a task, bug or one-level subtask" })
  @input(createTaskSchema)
  createTask(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTask,
  ) {
    return this.service.createTask(actor, projectId, body);
  }

  @Get("tasks/:id")
  @ApiOperation({ summary: "Get a task and its blocking dependency IDs" })
  getTask(@CurrentActor() actor: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.getTask(actor, id);
  }

  @Patch("tasks/:id")
  @ApiOperation({ summary: "Update permitted task fields using optimistic concurrency" })
  @input(updateTaskSchema)
  updateTask(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTask,
  ) {
    return this.service.updateTask(actor, id, body);
  }

  @Patch("tasks/:id/status")
  @ApiOperation({ summary: "Move a task between Kanban columns and optionally reorder it" })
  @input(moveTaskSchema)
  moveTask(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveTaskSchema)) body: MoveTask,
  ) {
    return this.service.updateTask(actor, id, body, true);
  }

  @Delete("tasks/:id")
  @ApiOperation({ summary: "Delete a task without subtasks, comments or dependents" })
  @ApiQuery({ name: "version", type: Number, required: true })
  deleteTask(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteVersion)) query: Version,
  ) {
    return this.service.deleteTask(actor, id, query.version);
  }

  @Get("projects/:projectId/board")
  @filters(taskListSchema)
  @ApiOperation({ summary: "Read Kanban columns; page/pageSize apply separately to each filtered column" })
  board(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(taskListSchema)) query: TaskList,
  ) {
    return this.service.board(actor, projectId, query);
  }

  @Get("projects/:projectId/backlog")
  @filters(taskListSchema)
  @ApiOperation({ summary: "List unfinished tasks without a sprint, regardless of task status" })
  backlog(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(taskListSchema)) query: TaskList,
  ) {
    return this.service.listTasks(actor, projectId, query, true);
  }

  @Get("projects/:projectId/timeline")
  @filters(paginationSchema)
  @ApiOperation({
    summary: "Read dated tasks, sprints and milestones; each collection is independently paginated",
  })
  timeline(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(paginationSchema.strict())) query: Pagination,
  ) {
    return this.service.timeline(actor, projectId, query);
  }

  @Get("projects/:projectId/summary")
  @ApiOperation({
    summary: "Read task progress, overdue counts and estimates; subtasks excluded from all metrics",
  })
  summary(@CurrentActor() actor: AuthContext, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.service.summary(actor, projectId);
  }

  @Get("projects/:projectId/sprints")
  @filters(paginationSchema)
  @ApiOperation({ summary: "List project sprints with pagination" })
  listSprints(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(paginationSchema.strict())) query: Pagination,
  ) {
    return this.service.listSprints(actor, projectId, query);
  }

  @Post("projects/:projectId/sprints")
  @ApiOperation({ summary: "Create a planned sprint" })
  @input(createSprintSchema)
  createSprint(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createSprintSchema)) body: CreateSprint,
  ) {
    return this.service.createSprint(actor, projectId, body);
  }

  @Get("sprints/:id")
  @ApiOperation({ summary: "Get a sprint" })
  getSprint(@CurrentActor() actor: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.getSprint(actor, id);
  }

  @Patch("sprints/:id")
  @ApiOperation({ summary: "Update a planned or active sprint" })
  @input(updateSprintSchema)
  updateSprint(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSprintSchema)) body: UpdateSprint,
  ) {
    return this.service.updateSprint(actor, id, body);
  }

  @Post("sprints/:id/start")
  @ApiOperation({ summary: "Start a planned sprint; only one active sprint is allowed per project" })
  @input(versionSchema)
  startSprint(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(versionSchema)) body: Version,
  ) {
    return this.service.startSprint(actor, id, body.version);
  }

  @Post("sprints/:id/complete")
  @ApiOperation({
    summary:
      "Complete an active sprint and atomically return unfinished tasks to backlog status without a sprint",
  })
  @input(versionSchema)
  completeSprint(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(versionSchema)) body: Version,
  ) {
    return this.service.completeSprint(actor, id, body.version);
  }

  @Delete("sprints/:id")
  @ApiOperation({ summary: "Delete an empty planned sprint" })
  @ApiQuery({ name: "version", type: Number, required: true })
  deleteSprint(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteVersion)) query: Version,
  ) {
    return this.service.deleteSprint(actor, id, query.version);
  }

  @Get("tasks/:taskId/comments")
  @filters(paginationSchema)
  @ApiOperation({ summary: "List task comments with pagination" })
  listComments(
    @CurrentActor() actor: AuthContext,
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Query(new ZodValidationPipe(paginationSchema.strict())) query: Pagination,
  ) {
    return this.service.listComments(actor, taskId, query);
  }

  @Post("tasks/:taskId/comments")
  @ApiOperation({ summary: "Add a comment as a nonviewer project member" })
  @input(createCommentSchema)
  createComment(
    @CurrentActor() actor: AuthContext,
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateComment,
  ) {
    return this.service.createComment(actor, taskId, body);
  }

  @Patch("comments/:id")
  @ApiOperation({ summary: "Edit a comment as its author or a manager" })
  @input(updateCommentSchema)
  updateComment(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCommentSchema)) body: UpdateComment,
  ) {
    return this.service.updateComment(actor, id, body);
  }

  @Delete("comments/:id")
  @ApiOperation({ summary: "Delete a comment as its author or a manager" })
  @ApiQuery({ name: "version", type: Number, required: true })
  deleteComment(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteVersion)) query: Version,
  ) {
    return this.service.deleteComment(actor, id, query.version);
  }

  @Get("projects/:projectId/milestones")
  @filters(paginationSchema)
  @ApiOperation({ summary: "List dated project milestones with pagination" })
  listMilestones(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(paginationSchema.strict())) query: Pagination,
  ) {
    return this.service.listMilestones(actor, projectId, query);
  }

  @Post("projects/:projectId/milestones")
  @ApiOperation({ summary: "Create a project milestone" })
  @input(createMilestoneSchema)
  createMilestone(
    @CurrentActor() actor: AuthContext,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createMilestoneSchema)) body: CreateMilestone,
  ) {
    return this.service.createMilestone(actor, projectId, body);
  }

  @Get("milestones/:id")
  @ApiOperation({ summary: "Get a project milestone" })
  getMilestone(@CurrentActor() actor: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.getMilestone(actor, id);
  }

  @Patch("milestones/:id")
  @ApiOperation({ summary: "Update or complete a milestone" })
  @input(updateMilestoneSchema)
  updateMilestone(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) body: UpdateMilestone,
  ) {
    return this.service.updateMilestone(actor, id, body);
  }

  @Delete("milestones/:id")
  @ApiOperation({ summary: "Delete a project milestone" })
  @ApiQuery({ name: "version", type: Number, required: true })
  deleteMilestone(
    @CurrentActor() actor: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteVersion)) query: Version,
  ) {
    return this.service.deleteMilestone(actor, id, query.version);
  }
}
