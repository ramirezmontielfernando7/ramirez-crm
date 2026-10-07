"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewer } from "@/components/viewer-context";
import type { ConversationDto } from "@/lib/types";
import { isArchived } from "@/lib/inbox-filters";
import { FloatingMenu, MenuItem, type MenuAnchor } from "./floating-menu";

/**
 * 034 — Archivar y eliminar un chat. Lo comparten el menú contextual de la
 * fila (clic derecho / pulsación larga) y el "⋯" del chat abierto: mismas
 * opciones, mismo diálogo, mismas llamadas.
 *
 * Eliminar solo se OFRECE a quien tiene `conversation.delete` (Propietario y
 * Coordinador). Es cosmético: la ruta lo valida de nuevo y responde 403.
 */

export const DELETE_WARNING =
  "Esta acción eliminará el chat y todos sus mensajes de forma permanente. No se puede deshacer.";

async function errorOf(res: Response | null, fallback: string): Promise<string> {
  if (!res) return "Sin conexión con el servidor";
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? fallback;
}

/** PATCH { archived }. Devuelve el mensaje de error, o null si salió bien. */
export async function setArchived(id: string, archived: boolean): Promise<string | null> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived }),
  }).catch(() => null);
  return res?.ok ? null : errorOf(res, archived ? "No se pudo archivar" : "No se pudo recuperar");
}

/** DELETE. Devuelve el mensaje de error, o null si salió bien. */
export async function deleteChat(id: string): Promise<string | null> {
  const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
  if (res?.ok) return null;
  if (res?.status === 403) return "No tienes permiso para eliminar chats";
  return errorOf(res, "No se pudo eliminar el chat");
}

/** Diálogo de confirmación de eliminar (rol `alertdialog`, foco en «Cancelar»). */
function DeleteDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancelar"
        tabIndex={-1}
        disabled={busy}
        onClick={onCancel}
        className="absolute inset-0 bg-overlay"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="eliminar-chat-titulo"
        aria-describedby="eliminar-chat-texto"
        className="relative w-full max-w-sm rounded-panel border bg-popover p-5 text-foreground shadow-pop"
      >
        <h2 id="eliminar-chat-titulo" className="text-[15px] font-semibold tracking-tight">
          ¿Eliminar este chat?
        </h2>
        <p id="eliminar-chat-texto" className="mt-2 text-[13px] leading-5 text-text-2">
          {DELETE_WARNING}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-danger-text">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* El foco empieza en «Cancelar»: Enter sin querer no elimina. */}
          <Button autoFocus variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? "Eliminando…" : "Eliminar permanentemente"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

type Target = Pick<ConversationDto, "id" | "archivedAt">;

/**
 * El estado de las acciones de UN lugar de la pantalla (la lista, o el
 * encabezado del chat): el menú abierto y el diálogo. `onDone` se llama tras
 * archivar, recuperar o eliminar para que la Bandeja se refresque (y suelte el
 * chat abierto si era ese).
 */
export function useConversationActions(onDone: (id: string, kind: "archive" | "restore" | "delete") => void) {
  const viewer = useViewer();
  const canDelete = viewer.can("conversation.delete");
  const [menu, setMenu] = useState<{ target: Target; anchor: MenuAnchor } | null>(null);
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un fallo de archivar se dice en una línea flotante; sin esto sería mudo.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((target: Target, anchor: MenuAnchor) => setMenu({ target, anchor }), []);

  const archive = useCallback(
    async (target: Target) => {
      setMenu(null);
      const restore = isArchived(target);
      const err = await setArchived(target.id, !restore);
      if (err) setNotice(err);
      else onDone(target.id, restore ? "restore" : "archive");
    },
    [onDone]
  );

  const requestDelete = useCallback((target: Target) => {
    setMenu(null);
    setError(null);
    setConfirm(target);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    const err = await deleteChat(confirm.id);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    const id = confirm.id;
    setConfirm(null);
    onDone(id, "delete");
  }, [confirm, onDone]);

  const element: ReactNode = (
    <>
      {menu && (
        <FloatingMenu anchor={menu.anchor} onClose={closeMenu} label="Opciones del chat">
          <MenuItem onSelect={() => void archive(menu.target)}>
            {isArchived(menu.target) ? (
              <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {isArchived(menu.target) ? "Recuperar" : "Archivar"}
          </MenuItem>
          {canDelete && (
            <MenuItem danger onSelect={() => requestDelete(menu.target)}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Eliminar
            </MenuItem>
          )}
        </FloatingMenu>
      )}
      {confirm && (
        <DeleteDialog
          busy={busy}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {notice && (
        <p
          role="status"
          className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-[12.5px] shadow-pop"
        >
          {notice}
        </p>
      )}
    </>
  );

  return { openMenu, element, canDelete };
}
