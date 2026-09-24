"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "@/lib/auth/permissions";

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles })],
});

export const { signIn, signUp, signOut, useSession } = authClient;
