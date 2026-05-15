import { z } from "zod";

export const LocatorSchema = z.object({
  kind: z.enum(["role", "label", "placeholder", "testId", "text", "css"]),
  role: z
    .enum([
      "button",
      "link",
      "textbox",
      "heading",
      "checkbox",
      "combobox",
      "tab",
    ])
    .optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  exact: z.boolean().optional(),
});

export const TestStepSchema = z.object({
  action: z.enum([
    "goto",
    "fill",
    "click",
    "check",
    "select",
    "expectVisible",
    "expectText",
    "expectUrl",
  ]),
  target: z.string().optional(),
  locator: LocatorSchema.optional(),
  value: z.string().optional(),
  valueKey: z.string().optional(),
  expectedText: z.string().optional(),
  expectedTextKey: z.string().optional(),
  url: z.string().optional(),
});

export const TestCaseInputSchema = z.object({
  featureName: z.string().min(2),
  testId: z.string().optional(),
  title: z.string().min(3),
  description: z.string().optional(),
  expectedResult: z.string().optional(),
  testData: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  steps: z.array(TestStepSchema).min(1),
  options: z
    .object({
      dryRun: z.boolean().default(false),
      overwrite: z.boolean().default(false),
      updateFixtures: z.boolean().default(true),
    })
    .default({ dryRun: false, overwrite: false, updateFixtures: true }),
});

export type LocatorInput = z.infer<typeof LocatorSchema>;
export type TestStepInput = z.infer<typeof TestStepSchema>;
export type TestCaseInput = z.infer<typeof TestCaseInputSchema>;
