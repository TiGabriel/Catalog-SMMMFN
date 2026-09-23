import "server-only";
import { z } from "zod";
import { db } from "@/server/db/client";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { Errors } from "@/server/errors";

/**
 * Whitelisted runtime settings. Each key has a schema and a default; unknown
 * keys are rejected. Security floors (password length, session timeouts) stay
 * in code (`SECURITY`) and are deliberately not configurable here.
 */
export const SETTING_DEFINITIONS = {
  "grades.allowDecimals": {
    schema: z.boolean(),
    default: false,
    description: "Permite note cu zecimale (ex. la examene).",
  },
  "grades.editWindowDays": {
    schema: z.number().int().min(0).max(365),
    default: 7,
    description: "Numărul de zile în care profesorul își poate modifica/șterge propriile note.",
  },
  "features.studentAccounts": {
    schema: z.boolean(),
    default: false,
    description: "Activează conturile de elev (autentificare elevi).",
  },
  "rollover.mode": {
    schema: z.enum(["MANUAL_CONFIRM", "AUTO"]),
    default: "AUTO",
    description: "Trecerea în noul an școlar: automat la 1 septembrie (implicit) sau doar la confirmarea administratorului.",
  },
  "school.classSuffixes": {
    schema: z.array(z.string().regex(/^[0-9]{2}$/)).min(1).max(30),
    default: ["11", "12", "13", "14", "15", "24", "25"],
    description: "Sufixele claselor (anul I: 1xx, anul II: 2xx).",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]["schema"]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const def = SETTING_DEFINITIONS[key];
  const row = await db.systemSetting.findUnique({ where: { key } });
  if (row) {
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) return parsed.data as SettingValue<K>;
    console.error(`[settings] invalid stored value for ${key}; using default`);
  }
  return def.default as SettingValue<K>;
}

export async function listSettings(actor: Actor) {
  await assertPermission(actor, "config.read");
  const rows = await db.systemSetting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFINITIONS[key];
    const row = stored.get(key);
    const parsed = row ? def.schema.safeParse(row.value) : undefined;
    return {
      key,
      description: def.description,
      value: parsed?.success ? parsed.data : def.default,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function updateSetting(actor: Actor, key: string, value: unknown) {
  await assertPermission(actor, "config.manage");
  if (!isSettingKey(key)) throw Errors.notFound();
  const def = SETTING_DEFINITIONS[key];
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) throw Errors.validation({ value: ["Valoare invalidă pentru această setare."] });
  const before = await getSetting(key);
  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as never, description: def.description, updatedById: actor.userId },
      update: { value: parsed.data as never, updatedById: actor.userId },
    });
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.CONFIG_UPDATE,
      entityType: "SystemSetting",
      entityId: key,
      before: { value: before },
      after: { value: parsed.data },
    });
  });
  return { key, value: parsed.data };
}
