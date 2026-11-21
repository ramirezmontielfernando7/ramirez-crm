# C1-A2 · sesión móvil y lecturas del CRM

| Entrega | Rama | Fuente |
| --- | --- | --- |
| Backend | `codex/backend-mobile-auth-20261121` | `e13daa08139c8de440c3e7c12a92d8ae5d4ffcd6`, desde el main remoto `2d2b9e61daf55195219a17b7cf3b08a847dd2b5d` |
| App | `codex/dashfort-mobile-c1-conexion-20261121` | Desde `b1526069`, descendiente de `c765ca6`. Versión 0.1.5, versionCode 6, paquete `com.demfort.dashfort.dev` |

## Backend

`POST /api/mobile/session` rechaza solicitudes con `Origin`, `Sec-Fetch-Site` o cookie y delega el login a `getAuth().api.signInEmail`. Reutiliza el límite FR-062 y la validación de organización. Extrae el valor firmado de la cookie emitida por Better Auth y lee la caducidad de esa sesión. La respuesta móvil contiene `token` y `expiresAt` con `Cache-Control: no-store`, sin cabeceras de credenciales. Se conserva el 429 aunque el hook del límite lance una excepción en la llamada directa.

El Bearer se convierte internamente en la cookie que espera Better Auth 1.7.19, incluido el prefijo `__Secure-` en HTTPS. Una cookie de sesión recibida conserva la precedencia. Better Auth verifica la firma y el estado de sesión. La organización activa y los permisos se siguen resolviendo con la membresía y las políticas del CRM. `POST /api/mobile/session/revoke` llama `signOut` y comprueba que la sesión ya no resuelve antes de confirmar éxito.

Se conservaron los archivos del login web, la configuración de Better Auth y el middleware CSRF. El registro sigue sujeto a las reglas existentes. La autenticación de MCP y la API de servicio del Bot conserva sus propios validadores. Los handlers nuevos están registrados en el inventario de permisos. El cambio usa el esquema y dependencias existentes.

## App

El modo predeterminado conserva la app demo del diseño B, incluida la prueba de `ux-lab`. El modo staging reutiliza el formulario B, el selector de tres posiciones fijas y la barra inferior de radio 24. Mantiene las filas cargadas al volver del chat. Clientes usa los endpoints existentes de Bandeja con cursor e historial de solo lectura. Se puede actualizar al entrar, al volver al primer plano o al deslizar para refrescar. Equipo, Mi número, CRM, Estudio IA y Marketing indican su carácter demo. Las funciones demo completas siguen accesibles en un build configurado en modo demo. Los proveedores demo quedan fuera de la sesión de staging.

En modo staging, el token se guarda en SecureStore, vinculado al origen configurado. Se excluye SecureStore de los respaldos en la nube y transferencias de Android. El transporte usa `expo/fetch` con cookies omitidas y redirecciones deshabilitadas. Se permite HTTPS y HTTP para loopback o emulador local. La app bloquea el modo staging en web y rechaza un origen vacío, `dash.demfort.com`, subdominios de ese host y URLs con credenciales, ruta o query. Los 403 de organización suspendida muestran el mensaje de suspensión, mientras el 401 genérico pide volver a iniciar sesión.

## Resultados

- Backend con dependencias instaladas desde el lockfile congelado. `pnpm typecheck && pnpm lint && pnpm test` pasó bajo Node 22.23.5. 222 archivos, 2.565 pruebas aprobadas y una omitida. Node 24 reprodujo un rechazo de stream en `tests/unit/upload-limits.test.ts` también sobre el checkout limpio de main. La misma prueba pasó en Node 22, que es la línea de CI.
- Postgres 17.12 local, base desechable, roles `vocero_app` sin BYPASSRLS y `vocero_system`, modo estricto. Se aplicaron dos veces las migraciones existentes para preparar la base. Pasaron 34 pruebas de sesión móvil, RLS, MCP y Bot en la configuración HTTP de prueba. Pasaron también las 8 pruebas de sesión con el origen configurado en HTTPS, incluido el prefijo de cookie.
- La suite sirve como prueba automatizada del probe web. Llama al handler web real y comprueba estado 200, cookie HttpOnly y ausencia de las cabeceras que motivaron la parada anterior. Prueba el rechazo del navegador y el CSRF cruzado. También cubre firmas inválidas, caducidad, revocación, límite de intentos y los tres momentos de suspensión. Dos páginas con cursor y el historial comparan las respuestas completas de web y móvil en dos organizaciones. Comprueba 404 para chats de un compañero y de otra organización.
- App con TypeScript, formato, 614 pruebas y trazabilidad de 158 IDs aprobados. Se probaron el transporte por cabecera, el bloqueo de origen, el almacenamiento vinculado al entorno, la paginación, la gestión de errores y el cierre sin red con fixtures del cliente. Regresión de diseño B en Chromium con 70 capturas locales, ambos temas, sin errores ni solicitudes externas. El export web de Expo abrió Bandeja desde el login demo en un servidor local. Expo introspect confirmó 0.1.5/6, el paquete correcto y ambas referencias a reglas de respaldo de SecureStore.

## Límites y reversión

Las pruebas de backend ejercitaron los handlers y datos de Postgres con las cabeceras de Next inyectadas en el entorno de pruebas. La instalación, el flujo de red nativo desde el teléfono, el proxy HTTPS y el reposo/reapertura en un dispositivo quedan para staging. El Bearer conserva los permisos web de la cuenta en las rutas que usan la sesión común. Solo lectura es una propiedad del cliente C1-A2. El token tiene la sensibilidad de una cookie de sesión firmada. Sin red, se borra la credencial local y se avisa si el servidor no pudo confirmar la revocación.

Para revertir en una fase futura, restaurar el backend al commit base o revertir el commit de autenticación móvil. Volver a una build demo o desactivar la selección de staging para la app. Aplicar el procedimiento de revocación de sesiones de prueba antes de retirar las rutas si se necesita invalidarlas. No hay cambios de esquema que revertir.

## Puerta C1-B

1. Claude audita ambas ramas, en particular el transporte de la cookie firmada, el límite FR-062 tras el proxy, las reglas de sesión y el alcance de rutas protegidas.
2. Fer aprueba expresamente el despliegue y confirma hostname, aislamiento de la BD y credenciales exclusivamente de staging. Preparar dos organizaciones de pruebas y un asesor con chats propios, chats asignados a otro asesor y datos ficticios de una segunda organización.
3. Desplegar únicamente el SHA aprobado del backend a staging. Compilar la app aprobada para staging con `EXPO_PUBLIC_MODE=staging` y `EXPO_PUBLIC_API_URL` igual al origen HTTPS confirmado por Fer. Estas variables son públicas dentro de la app.
4. En el Motorola, comprobar login, mensajes, cursor, regreso del chat, suspensión, caducidad y revocación. Verificar el diseño B y el teclado, y repetir el control de aislamiento usando la cuenta restringida.

Durante C1-A2 no se desplegó ningún entorno ni se compiló una APK.
