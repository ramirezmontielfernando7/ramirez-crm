import { redirect } from "next/navigation";
import { ConsentCard } from "@/components/ai-connector/consent-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionOrNull } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { authorizeSchema, checkAuthorizeRequest, requestedScopes } from "@/server/ai-connector/oauth";
import { mayConnect } from "@/server/ai-connector/keys";

export const dynamic = "force-dynamic";

/**
 * 047 PR 3 — «Claude quiere actuar como tú en Dashfort»: la pantalla donde
 * la persona acepta o no que su IA entre al CRM. Sin sesión, primero inicia
 * sesión y regresa aquí. Una solicitud rota NO regresa a la app (la
 * dirección de regreso podría no ser suya): se explica aquí.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const session = await getSessionOrNull();
  if (!session) {
    const qs = new URLSearchParams(flat as Record<string, string>).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }
  const parsed = authorizeSchema.safeParse(flat);
  const check = parsed.success ? await checkAuthorizeRequest(parsed.data) : null;
  if (!parsed.success || !check?.ok) {
    return (
      <Problem text="La app de IA mandó una solicitud que Dashfort no reconoce. Vuelve a intentarlo desde la app; si sigue pasando, avisa a quien administra tu cuenta." />
    );
  }
  const allowed = await runWithOrganization(session.organizationId, () => mayConnect(session));
  if (!allowed) {
    return (
      <Problem text="Tu organización todavía no permite conectar una IA a tu cuenta. Pídeselo al Propietario: se enciende en Ajustes → IA conectada." />
    );
  }
  return (
    <ConsentCard
      params={parsed.data}
      clientName={check.client.clientName}
      clientHost={hostOf(check.client.redirectUris[0] ?? parsed.data.redirect_uri)}
      canWrite={requestedScopes(parsed.data).includes("write")}
    />
  );
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return "";
  }
}

function Problem({ text }: { text: string }) {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>No se puede conectar</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-text-2">{text}</p>
      </CardContent>
    </Card>
  );
}
