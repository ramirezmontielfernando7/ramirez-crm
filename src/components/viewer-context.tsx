"use client";

import { createContext, useContext, useMemo } from "react";
import { can, roleLabel, type Permission } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/registry";

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
  /**
   * 030 (PR 4) — ¿Existe este módulo para la organización? Igual de cosmético:
   * apagado, sus rutas ya responden 404 en el servidor.
   */
  hasModule: (key: ModuleKey) => boolean;
  /** Mi número (046) — ¿quien mira tiene su propio número? (la pestaña de la Bandeja). */
  hasMyNumber: boolean;
  /** Mi número (046, PR 7) — ¿supervisa números del equipo? (Propietario o Coordinador, y hay alguno). */
  seesTeamNumbers: boolean;
};

const ViewerContext = createContext<Viewer>({
  userId: "",
  role: "",
  roleLabel: "",
  can: () => false,
  hasModule: () => true,
  hasMyNumber: false,
  seesTeamNumbers: false,
});

export function ViewerProvider({
  userId,
  role,
  grants = NO_GRANTS,
  modules,
  myNumber = false,
  teamNumbers = false,
  children,
}: {
  userId: string;
  role: string;
  /** 025 — delegaciones de la organización (p. ej. el Coordinador crea grupos). */
  grants?: readonly Permission[];
  /** 030 (PR 4) — módulos encendidos de la organización; sin la lista, todos. */
  modules?: readonly ModuleKey[];
  /** Mi número (046) — lo decide el servidor (complemento y número vivo). */
  myNumber?: boolean;
  /** Mi número (046, PR 7) — lo decide el servidor (permiso y números del equipo). */
  teamNumbers?: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<Viewer>(
    () => ({
      userId,
      role,
      roleLabel: roleLabel(role),
      can: (permission) => can({ role, grants }, permission),
      hasModule: (key) => !modules || modules.includes(key),
      hasMyNumber: myNumber,
      seesTeamNumbers: teamNumbers,
    }),
    [userId, role, grants, modules, myNumber, teamNumbers]
  );
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

const NO_GRANTS: readonly Permission[] = [];

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
