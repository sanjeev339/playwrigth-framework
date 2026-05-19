import { z } from "zod";

export const ArtifactScenarioListInputSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  automationSuitability: z
    .enum(["Yes", "No", "Partial", "All"])
    .default("All")
    .optional(),
  limit: z.number().int().positive().max(200).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});

export const ArtifactInputSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  scenarioId: z.string().min(1),
  baseUrl: z.string().optional(),
  featureName: z.string().optional(),
  testData: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({})
    .optional(),
  loginBefore: z.boolean().optional(),
  options: z
    .object({
      dryRun: z.boolean().default(true),
      overwrite: z.boolean().default(false),
      updateFixtures: z.boolean().default(true),
    })
    .default({ dryRun: true, overwrite: false, updateFixtures: true }),
});

export type ArtifactScenarioListInput = z.infer<
  typeof ArtifactScenarioListInputSchema
>;
export type ArtifactInput = z.infer<typeof ArtifactInputSchema>;
