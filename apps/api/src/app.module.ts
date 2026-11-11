import { Module } from "@nestjs/common";
import { InfrastructureModule } from "./infra/infra.module.js";
import { observeModule } from "./infra/observe.js";
import { ProjectsModule } from "./modules/projects.module.js";

// The observability module is imported first so it shuts down last and still
// flushes the telemetry of requests that finish during shutdown.
@Module({ imports: [observeModule, InfrastructureModule, ProjectsModule] })
export class AppModule {}
