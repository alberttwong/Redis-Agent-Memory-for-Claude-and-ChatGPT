import * as z from "zod/v4";

export const feedbackSchema = z.object({
  message: z.string().trim().min(1).max(4000).describe("The feedback the user explicitly asked to send. Omit secrets and personal information."),
  category: z.enum(["bug", "feature", "general"]).default("general"),
  rating: z.number().int().min(1).max(5).optional().describe("Optional satisfaction score, 1 (poor) to 5 (excellent)."),
});
export type Feedback = z.input<typeof feedbackSchema>;
