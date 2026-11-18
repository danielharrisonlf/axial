-- Optional project color as a six digit hex value; existing projects keep no color.
ALTER TABLE "projects"."Project" ADD COLUMN "color" VARCHAR(7);
ALTER TABLE "projects"."Project" ADD CONSTRAINT "Project_color" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$');
