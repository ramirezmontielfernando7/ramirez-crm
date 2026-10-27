import { notFound, redirect } from "next/navigation";
import { MyAiClient } from "@/components/ai-connector/my-ai-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { orgHasConectorIa } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 047 PR 3 — Mi IA (cualquier rol; la API decide de quién por la sesión). Sin el complemento: 404. */
export default async function MyAiPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await orgHasConectorIa(session.organizationId))) notFound();
  return <MyAiClient />;
}
