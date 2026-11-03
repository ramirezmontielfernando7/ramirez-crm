# Imagen Docker en GHCR (para que Coolify solo la baje)

Cada fusión a `main` que pasa el CI publica la imagen en
`ghcr.io/ramirezmontielfernando7/ramirez-crm` con dos etiquetas:

- `main`: siempre la última.
- `sha-<commit completo>`: una versión exacta (sirve para volver atrás).

El despliegue actual de Coolify (construir desde el repositorio) **sigue
funcionando igual**; esto es opcional y no cambia nada hasta que se active.

## Activarlo en Coolify (una sola vez)

1. En GitHub → perfil → Packages → `ramirez-crm` → Package settings: o bien
   «Change visibility → Public» (lo más simple, el repo ya es público), o bien
   crear un token (classic) con permiso `read:packages` para Coolify.
2. En Coolify crea una aplicación nueva «Docker Image» (no toques la actual):
   imagen `ghcr.io/ramirezmontielfernando7/ramirez-crm`, etiqueta `main`.
   Copia las mismas variables de entorno, dominio y volumen `/data` de la
   aplicación actual. Si la imagen es privada, agrega el registro con el token.
3. Despliega, comprueba `/api/health` y que `commitVerified` sea `true`.
4. Cuando todo funcione, apaga el auto-deploy de la aplicación vieja.

Para que cada fusión se despliegue sola, en la app nueva activa el webhook de
Coolify para imágenes (o redespliega a mano). Para volver atrás: cambia la
etiqueta a `sha-<commit anterior>`.

Nota: la imagen sale de un `main` con CI verde, y además pasa el job de
apagado limpio y el de respaldos antes de publicarse.
