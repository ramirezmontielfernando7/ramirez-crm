# Ahorro de cuota en cada hilo

Verificado el 2026-11-14.

1. **CLAUDE.md recortado** (76 KB → ~17 KB, unos 15 mil tokens menos en CADA hilo). El detalle completo de cada área está en [mapa-del-codigo.md](mapa-del-codigo.md), sin recortes: se abre solo cuando se toca esa área (`grep -n "palabra" docs/mapa-del-codigo.md`).
2. **context7** (documentación al día de librerías): ya viene en `.mcp.json` (paquete `@upstash/context7-mcp` de Upstash, MIT, versión fijada 4.5.1, publicada hace más de 2 semanas). Sin llaves ni cuenta.
3. **rtk** (resume la salida de comandos de pruebas/build; Apache-2.0, organización `rtk-ai`, ~85 mil ★). NO se instala solo: cada sesión de la nube empieza limpia. Para usarlo en un hilo largo con pruebas o builds:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o /tmp/rtk-install.sh   # revisarlo
   RTK_EDITION=oss sh /tmp/rtk-install.sh   # edición Apache-2.0 sin el motor BUSL
   rtk init -g                              # engancha Bash; reiniciar la sesión
   ```
   Nunca activar `rtk telemetry enable` (privacidad). Probar en un hilo antes de generalizar; no se pudo probar en la sesión que lo preparó (el clasificador bloqueó la instalación).
4. **Serena**: no se activa. Es GPL-3.0, pide Python 3.13 + uv + servidores de lenguaje en cada sesión efímera, y la ganancia sobre grep/Read con el mapa nuevo es pequeña. Reconsiderar si el repo crece mucho.
