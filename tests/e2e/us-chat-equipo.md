# E2E — 025 Chat de equipo

Automatizado en `scripts/e2e-chat-equipo.mjs` (`pnpm test:e2e:chat`) con la
app viva (`next dev`, `WA_MOCK_ENABLED=true`) y el servidor recién reiniciado
(límite de intentos de login).

## Guion

1. El Propietario da de alta a una coordinadora y tres asesores (A, B, C).
2. **Avisos**: todos lo ven; A no publica (403); la coordinadora sí; A
   reacciona; a todos les llega por SSE.
3. **Directo A ↔ B**: uno por par; B lo recibe en vivo; C y la coordinadora
   NO reciben ningún evento y leer/escribir les da 404; ningún evento trae la
   audiencia.
4. **Supervisión encendida**: el Propietario lo ve como supervisor, no
   escribe, no reacciona, no edita (403), no marca leído y no suma a su globo.
5. **No leídos**: a B le sube el contador; a A no le cuenta lo suyo; B lee y
   baja.
6. **Editar/borrar**: B no puede con lo de A (403); A edita (B lo ve en vivo)
   y borra (queda "eliminado" sin texto; editarlo después = 409).
7. **Historial**: 55 mensajes → página de 50 con `hasMore`; `before=` trae el
   resto sin repetir; `limit` fuera de rango, texto > 4000 o vacío → 422.
8. **Adjuntos**: SVG, HTML y HTML por extensión → 415; PDF se descarga como
   `attachment` + `nosniff`; C → 404; PNG en línea con `nosniff`.
9. **Grupos**: sin delegación la coordinadora recibe 403 (y el asesor, y en
   los ajustes); con la delegación crea el grupo; saca a B (404 para B);
   apagada otra vez, 403; el Propietario lo borra.
10. **Supervisión apagada**: el aviso deja de verse aunque su toggle siga
    encendido; el Propietario ya no ve el directo (404) ni recibe su evento.
11. **Conocimientos**: el Propietario comparte una entrada en Avisos; C no
    puede en un directo ajeno (404).
12. **Usuario removido**: con su SSE abierto, C deja de recibir eventos y sus
    peticiones responden 401.
13. **Navegador (dos personas)**: A envía; a B (en la Bandeja) se le enciende
    el globo del menú; B abre el hilo; el siguiente mensaje le llega sin
    recargar; emoji desde frimousse; B reacciona y A lo ve en vivo.
