import { eventTypes } from "@axial/contracts";
import { z } from "zod";
export const eventSchema = z.object({
  id: z.uuid(),
  type: z.enum(eventTypes),
  version: z.literal(1),
  occurredAt: z.iso.datetime(),
  organizationId: z.uuid(),
  projectId: z.uuid(),
  aggregate: z.object({
    type: z.string().min(1).max(100),
    id: z.uuid(),
    version: z.number().int().positive(),
  }),
});
export type Event = z.infer<typeof eventSchema>;
export const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticate"), token: z.string().min(1).max(16384) }).strict(),
  z.object({ type: z.literal("subscribe"), projectId: z.uuid() }).strict(),
  z.object({ type: z.literal("unsubscribe"), projectId: z.uuid() }).strict(),
]);
