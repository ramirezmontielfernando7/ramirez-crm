# Conservación y límites de publicación

Repositorio inspeccionado: `ramirezmontielfernando7/ramirez-crm`.
Base: `main` en `95b7ea0b236b35ee29a1a288a55c315a050e3b6e`.
Rama local nueva: `codex/dashfort-mobile-tm1-20261110`.
La rama remota con ese nombre no existía al comprobarla (lectura con `git ls-remote`). No se hizo push, PR, merge, despliegue, tag, workflow dispatch ni llamada a producción.

`main` no tenía aplicación Expo. Se inspeccionó además, sin modificarla, la rama visible `codex/t2-mobile-classic`, que contiene implementación web y no `apps/mobile`/Expo. No se buscaron conversaciones ni entornos anteriores; se creó la nueva implementación aislada solicitada.

## Copias y recuperación

Se conserva un commit local con cambios solo en `apps/mobile`, más ZIP móvil independiente y un git bundle incremental con la rama y requisito del commit base. El ZIP excluye node_modules, cachés, binarios generados, .env, llaves y directorios nativos generados. Mantiene `package-lock.json`, código, pruebas, referencias documentales y evidencia web.

Para recuperar el bundle en un clon que ya tenga el commit base:

```bash
git bundle verify /ruta/dashfort-mobile-tm1.bundle
git fetch /ruta/dashfort-mobile-tm1.bundle refs/heads/codex/dashfort-mobile-tm1-20261110:refs/heads/codex/dashfort-mobile-tm1-20261110
git switch codex/dashfort-mobile-tm1-20261110
cd apps/mobile
npm ci
```

Si esa rama ya contiene trabajo, importar a otro nombre libre; no sobrescribirla. Para revisar o revertir esta etapa no hace falta modificar main: cambiar de rama en una copia con árbol limpio o restaurar el ZIP en otra carpeta. No se ejecutan operaciones destructivas.

## Push propuesto, todavía NO autorizado

Destino preparado: `origin`, únicamente `refs/heads/codex/dashfort-mobile-tm1-20261110`. Sin tags ni main.

Workflows leídos del commit base:

- `ci.yml`: pull requests y push a main.
- `imagen.yml`: pull requests, main y tags v*. La publicación de imagen se asocia a tags.
- `android.yml`: disparo manual; compila/publica la TWA, no este móvil.

Un push normal a esta rama no cumple esos disparadores de los workflows versionados. **No se pudo verificar la configuración externa de webhooks/Coolify/Hetzner con las herramientas y credenciales disponibles.** No asumir que está desactivada. Antes de pedir autorización definitiva de push, comprobar que ningún webhook o aplicación externa despliega esta rama. No modificar infraestructura para comprobarlo y no ejecutar el push mientras falte esa verificación y la autorización del propietario.
