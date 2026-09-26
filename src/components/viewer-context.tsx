"use client";

import { createContext, useContext, useMemo } from "react";
import { can, roleLabel, type Permission } from "@/lib/auth/permissions";

/**
 * 020 — Quién está mirando la pantalla: su rol y su id, para esconder lo que
 * no puede usar. Es SOLO cosmético: cada ruta de la API valida el permiso en
 * el servidor, y un botón escondido no protege nada.
 */
export type Viewer = {
  userId: string;
  role: string;
  roleLabel: string;
  can: (permission: Permission) => boolean;
};

const ViewerContext = createContext<Viewer>({
  userId: "",
  role: "",
  roleLabel: "",
  can: () => false,
});

export function ViewerProvider({
  userId,
  role,
  grants = NO_GRANTS,
  children,
}: {
  userId: string;
  role: string;
  /** 025 — delegaciones de la organización (p. ej. el Coordinador crea grupos). */
  grants?: readonly Permission[];
  children: React.ReactNode;
}) {
  const value = useMemo<Viewer>(
    () => ({
      userId,
      role,
      roleLabel: roleLabel(role),
      can: (permission) => can({ role, grants }, permission),
    }),
    [userId, role, grants]
  );
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

const NO_GRANTS: readonly Permission[] = [];

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
