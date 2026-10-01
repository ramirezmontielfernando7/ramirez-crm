/**
 * 015 — Si esta instancia tiene agenda o no.
 *
 * Misma decisión que los canales opcionales (ADR-001): el código del motor
 * viaja siempre en main, y lo que decide si EXISTE para el usuario es una
 * variable de despliegue. Una instancia normal (sin `AGENDA`) no ve la agenda
 * por ningún lado: ni pantalla de Citas, ni pestaña de Ajustes, ni rutas, ni
 * instrucciones de agendar en el prompt del agente — ni se le piden
 * credenciales de nadie.
 *
 * Se hace así, y no con una rama, porque una rama tiene que mantenerse
 * compatible con main Y con las demás features opcionales, y su cadena de
 * migraciones diverge sin arreglo posible. La prueba está en el repo: la rama
 * `004-motor-agenda` quedó irrescatable en 26 días.
 *
 * La migración se aplica siempre: unas tablas vacías son inertes, y a cambio
 * todas las instancias comparten la misma estructura.
 *
 * No se llama `CHANNELS` porque agendar no es un canal: mezclar las dos
 * taxonomías haría que el contrato de capacidades por canal dejara de
 * significar lo que dice.
 */

import { orgHasAgenda } from "@/server/modules";

export { parseAgendaFlag } from "@/server/modules/defaults";

/**
 * Fase 3, PR 3 — Por ORGANIZACIÓN (`organization_module`); la variable
 * `AGENDA` queda como valor por defecto (src/server/modules/). No pasa por
 * `getEnv()`: preguntar si una feature existe no puede depender de que TODO
 * el entorno valide.
 */
export async function agendaEnabled(organizationId: string): Promise<boolean> {
  return orgHasAgenda(organizationId);
}

/**
 * Respuesta para una superficie de agenda apagada. 404 y no 403 a propósito:
 * si la agenda no está encendida, ese endpoint no existe en esta instancia —
 * no hay nada que revelar sobre él.
 */
export function agendaDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
