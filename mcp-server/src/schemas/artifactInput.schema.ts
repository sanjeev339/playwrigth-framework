import { z } from "zod";

export const ArtifactInputSchema = z.object({
  scenariosCsvPath: z.string().min(1),
  testDataJsonPath: z.string().min(1),
  scenarioId: z.string().min(1),
  baseUrl: z.string().optional(),
  featureName: z.string().optional(),
  options: z
    .object({
      dryRun: z.boolean().default(true),
      overwrite: z.boolean().default(false),
      updateFixtures: z.boolean().default(true),
    })
    .default({ dryRun: true, overwrite: false, updateFixtures: true }),
});

export type ArtifactInput = z.infer<typeof ArtifactInputSchema>;
