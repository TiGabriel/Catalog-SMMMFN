import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { db } from "@/server/db/client";
import { DEMO_PASSWORD } from "../scripts/demo-data";

export const ORIGIN = "http://localhost:3000";
export { DEMO_PASSWORD };

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type CallOptions = {
  cookie?: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  origin?: string | null;
  contentType?: string;
};

export async function call(handler: Handler, method: string, path: string, opts: CallOptions = {}) {
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers({ "user-agent": "vitest" });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin !== null && method !== "GET") headers.set("origin", opts.origin ?? ORIGIN);
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  const req = new NextRequest(url, { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text, headers: res.headers };
}

export function sessionCookieFrom(setCookie: string | null): string {
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0]!;
}

export async function login(username: string, password = DEMO_PASSWORD) {
  const res = await call(loginRoute, "POST", "/api/auth/login", { body: { username, password } });
  return res;
}

export async function loginCookie(username: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await login(username, password);
  expect(res.status, `login ${username}: ${res.text}`).toBe(200);
  return sessionCookieFrom(res.headers.get("set-cookie"));
}

/** Fixture ids, looked up by stable natural keys. */
export async function fixtures() {
  const year = await db.academicYear.findFirstOrThrow({ where: { status: "ACTIVE" } });
  const cls = async (code: string) =>
    (await db.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: year.id, code } } })).id;
  const user = async (username: string) => (await db.user.findUniqueOrThrow({ where: { username } })).id;
  const subject = async (code: string) => (await db.subject.findUniqueOrThrow({ where: { code } })).id;
  const student = async (registryNumber: string) => (await db.student.findUniqueOrThrow({ where: { registryNumber } })).id;
  const reason = async (code: string) => (await db.gradeReason.findUniqueOrThrow({ where: { code } })).id;
  return {
    yearId: year.id,
    yearStart: year.startDate.toISOString().slice(0, 10),
    classes: { c111: await cls("111"), c112: await cls("112"), c113: await cls("113"), c211: await cls("211") },
    users: {
      admin: await user("admin.demo"),
      comandant: await user("comandant.demo"),
      popescu: await user("prof.popescu"),
      ionescu: await user("prof.ionescu"),
      georgescu: await user("prof.georgescu"),
      inactiv: await user("prof.inactiv"),
      elevMarin: await user("elev.marin"),
    },
    subjects: {
      mat: await subject("MAT"),
      eng: await subject("ENG"),
      nav: await subject("NAV"),
      practica: await subject("INSTR_PRACTICA"),
      purtare: await subject("PURTARE"),
    },
    students: {
      marin: await student("M-0001"),
      stan: await student("M-0002"),
      dobre: await student("M-0003"),
      vasile: await student("M-0004"),
      petre: await student("M-0005"),
    },
    reasons: { testare: await reason("TESTARE"), purtare: await reason("NOTA_PURTARE") },
    moduleId: (await db.module.findFirstOrThrow({ where: { academicYearId: year.id, yearOfStudy: 1, order: 1 } })).id,
  };
}

export type Fixtures = Awaited<ReturnType<typeof fixtures>>;

export const randomId = () => randomUUID();

export function uniqueName(prefix: string) {
  return `${prefix}.${Math.random().toString(36).slice(2, 8)}`;
}
