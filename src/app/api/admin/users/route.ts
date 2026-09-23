import { apiRoute, readJson } from "@/server/http/api";
import { createUser, listUsers } from "@/server/domain/users";
import { createUserSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "users.manage" }, async ({ actor }) => ({ users: await listUsers(actor) }));

export const POST = apiRoute({ permission: "users.manage" }, async ({ req, actor }) => {
  const body = await readJson(req, createUserSchema);
  return { user: await createUser(actor, body) };
});
