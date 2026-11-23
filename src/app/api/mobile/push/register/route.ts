import { withAuth } from "@/lib/api";
import { mobilePushRegistration } from "@/server/mobile-push/http";

export const dynamic = "force-dynamic";
export const POST = withAuth((session, req: Request) => mobilePushRegistration(session, req, true));
