# C1-A · parada en la prueba de compatibilidad web

Base móvil c765ca6eac056b7a596758e8ab6ffb8d0a665736. Backend de referencia leído desde main 2d2b9e61daf55195219a17b7cf3b08a847dd2b5d. El árbol histórico de la rama móvil fija Better Auth 1.6.23 y carece del middleware CSRF vigente. El lockfile del backend vigente fija 1.7.19. Su sesión calcula chatView para asesores. Usar la raíz histórica para certificar paridad sería incorrecto.

## Resultado que impide activar el transporte

Se ejecutó Better Auth 1.7.19 temporalmente con su almacenamiento de prueba, sin listener, con solicitudes web de mismo origen al handler, un usuario ficticio y secretos efímeros. Para reproducir, copiar probe-web.mjs a un directorio temporal con better-auth@1.7.19 instalado y ejecutar node probe-web.mjs. Solo imprime estado y presencia de cabeceras.

| Configuración | Login | Set-Cookie | set-auth-token |
|---|---:|---:|---:|
| organization | 200 | sí | no |
| organization + bearer con requireSignature | 200 | sí | sí |

El hook posterior del plugin bearer también añade set-auth-token a Access-Control-Expose-Headers al emitir la cookie de sesión. Una integración global expondría la credencial firmada al JavaScript del navegador en esa respuesta. La prueba demuestra la diferencia en el plugin, no que Dashfort en producción tenga esa configuración. Por la condición del propietario se detuvo la implementación. El código inspeccionado de @better-auth/expo 1.7.19 guarda la cookie y la devuelve en la cabecera cookie incluso con credentials:omit. No cumple el requisito de Authorization como único transporte móvil. No se eligió ni activó un plugin. No hubo migraciones.

## Contratos del servidor que debe preservar el siguiente intento

- src/lib/auth/index.ts mantiene el registro cerrado, el límite de login por IP (10 por 10 minutos) y el hook que devuelve 403 ORGANIZATION_SUSPENDED al crear sesión.
- src/lib/auth/session.ts y src/lib/api.ts convierten la suspensión con sesión abierta en 401 unauthorized genérico. La interfaz no puede deducir la suspensión de ese 401. La suspensión detectada durante la operación produce 403 organization_suspended.
- src/lib/security/csrf.ts y src/middleware.ts protegen las escrituras web con cookie según el origen. /api/auth delega al control de Better Auth. La ausencia de Origin por sí sola no autentica al cliente.
- La lista usa limit, cursor y nextCursor. La lectura del historial verifica getConversation(session.access,id) y devuelve 404 para una conversación invisible. La revisión del código no valida los datos devueltos bajo RLS.

## Verificación y continuidad

En apps/mobile pasaron TypeScript, formato, 610 pruebas y el inventario de 158 IDs sobre el runtime 0.1.4. Los tres comandos de raíz no alcanzaron sus suites: faltan node_modules y el intento de pnpm de inicializar su almacén predeterminado falló con ENOENT. Esto no demuestra un fallo del CRM. La comparación aislada anterior sí se ejecutó, con dependencias en /tmp. No se probaron login móvil, revocación, rate limit, los tres casos de suspensión, paridad de permisos ni aislamiento real de filas entre organizaciones. P1 se conserva porque tests/premium-preview.test.ts importa sus tokens.

El siguiente intento debe partir del backend vigente y aislar la emisión de credenciales móviles del login web, manteniendo la misma instancia lógica de sesión, hooks, CSRF y autorización. Probar explícitamente que un navegador no obtiene la cabecera ni por añadir un marcador de cliente, y comparar los datos de dos organizaciones, incluyendo cursores y acceso directo. Mantener demo predeterminado hasta pasar los gates. El cambio de versión a 0.1.5/6 queda pendiente junto con el cliente.

C1-B queda bloqueada. Antes de desplegar, Claude debe auditar los resultados y Fer debe aprobar el staging exacto. Solo entonces preparar usuarios ficticios de dos organizaciones y un asesor con alcance restringido, y asignar EXPO_PUBLIC_API_URL al origen HTTPS verificado de ese staging. Aún no existe un backend C1 aprobado para desplegar ni una URL acreditada. Para descartar este checkpoint basta regresar a la rama móvil en c765ca6. No hubo cambios de runtime, APK, firma, infraestructura o datos.
