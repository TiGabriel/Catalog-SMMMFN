import { z } from "zod";

/**
 * Averaging rule definition. The official rules are NOT final: every choice is
 * a parameter/strategy here, stored in a versioned `AveragingRuleSet`, so the
 * school can change them without code changes to the catalog itself. New
 * strategies are added in engine.ts and referenced by name.
 */
export const ruleDefinitionSchema = z.strictObject({
  rounding: z.strictObject({
    decimals: z.number().int().min(0).max(3),
    mode: z.enum(["HALF_UP", "TRUNCATE"]),
  }),
  subjectFinal: z.strictObject({
    /** MEAN_CURRENT: mean of current grades; WEIGHTED_WITH_EXAM: combined with the module exam where the subject has one. */
    strategy: z.enum(["MEAN_CURRENT", "WEIGHTED_WITH_EXAM"]),
    /** Weight of the exam grade (0–1) for WEIGHTED_WITH_EXAM. */
    examWeight: z.number().min(0).max(1),
    /** Minimum number of current grades needed for a final grade. */
    minCurrentGrades: z.number().int().min(0).max(20),
    /** Round the subject average before combining it with the exam. */
    roundCurrentMean: z.boolean(),
  }),
  conduct: z.strictObject({
    strategy: z.enum(["LAST", "MEAN"]),
    includeInModuleAverage: z.boolean(),
  }),
  practicalTraining: z.strictObject({
    includeInModuleAverage: z.boolean(),
  }),
  moduleAverage: z.strictObject({
    strategy: z.enum(["MEAN_OF_FINALS", "WEIGHTED_BY_MODULE_SUBJECT"]),
  }),
  /** Annual average from module averages (optional for rule sets created before it existed). */
  annualAverage: z
    .strictObject({ strategy: z.enum(["MEAN_OF_MODULES"]), requireAllModules: z.boolean() })
    .default({ strategy: "MEAN_OF_MODULES", requireAllModules: true }),
});

export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

/** Provisional defaults – clearly marked as such in the UI until the school confirms the official rules. */
export const PROVISIONAL_RULES: RuleDefinition = {
  rounding: { decimals: 2, mode: "HALF_UP" },
  subjectFinal: { strategy: "WEIGHTED_WITH_EXAM", examWeight: 0.5, minCurrentGrades: 1, roundCurrentMean: false },
  conduct: { strategy: "LAST", includeInModuleAverage: false },
  practicalTraining: { includeInModuleAverage: true },
  moduleAverage: { strategy: "MEAN_OF_FINALS" },
  annualAverage: { strategy: "MEAN_OF_MODULES", requireAllModules: true },
};

export const PROVISIONAL_RULESET_NAME = "Reguli provizorii";
