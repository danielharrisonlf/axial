import { Module } from "@nestjs/common";
import { InfrastructureModule } from "./infra/infra.module.js";
import { ProjectsModule } from "./modules/projects.module.js";

@Module({ imports: [InfrastructureModule, ProjectsModule] })
export class AppModule {}
