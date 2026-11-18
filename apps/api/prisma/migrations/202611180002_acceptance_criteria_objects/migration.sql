-- Acceptance criteria become [{ "text": string, "done": boolean }]. Legacy TEXT[] values are
-- converted in order to { text, done: false }; NULL or empty arrays become [].
-- A subquery is not allowed in ALTER COLUMN ... USING, so the value is copied into a new column.
ALTER TABLE "projects"."Task" ADD COLUMN "acceptanceCriteria_objects" JSONB NOT NULL DEFAULT '[]';

UPDATE "projects"."Task" AS t
SET "acceptanceCriteria_objects" = (
  SELECT jsonb_agg(jsonb_build_object('text', c.value, 'done', false) ORDER BY c.position)
  FROM unnest(t."acceptanceCriteria") WITH ORDINALITY AS c(value, position)
)
WHERE cardinality(t."acceptanceCriteria") > 0;

ALTER TABLE "projects"."Task" DROP COLUMN "acceptanceCriteria";
ALTER TABLE "projects"."Task" RENAME COLUMN "acceptanceCriteria_objects" TO "acceptanceCriteria";
ALTER TABLE "projects"."Task" ADD CONSTRAINT "Task_acceptanceCriteria" CHECK (jsonb_typeof("acceptanceCriteria") = 'array');
