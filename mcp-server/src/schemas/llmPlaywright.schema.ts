import { z } from "zod";

export const LlmPlaywrightArtifactSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  scenarioId: z.string().min(1),
});

export const LlmPlaywrightInputSchema = z
  .object({
    prompt: z.string().optional(),
    featureName: z.string().optional(),
    testId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    expectedResult: z.string().optional(),
    baseUrl: z.string().optional(),
    testData: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    artifact: LlmPlaywrightArtifactSchema.optional(),
    loginBefore: z.boolean().optional(),
    provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
    model: z.string().optional(),
    options: z
      .object({
        dryRun: z.boolean().default(true),
        overwrite: z.boolean().default(false),
        updateFixtures: z.boolean().default(true),
      })
      .default({ dryRun: true, overwrite: false, updateFixtures: true }),
  })
  .refine((input) => input.prompt || input.artifact, {
    message: "Provide either prompt or artifact input for LLM generation.",
  });

export type LlmPlaywrightInput = z.infer<typeof LlmPlaywrightInputSchema>;
