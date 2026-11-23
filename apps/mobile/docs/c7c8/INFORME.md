# Dashfort Mobile · C7+C8

Rama `codex/dashfort-mobile-c7c8-20261122`, base C6 `f2beadba413a93c6f4285fd034bf56635849cb95`. Versión 0.2.0, versionCode 11, paquete `com.demfort.dashfort.dev`. El binario futuro debe conservar la firma experimental. Servidor comprobado en `main` `b89dd5fc1ad0b7baba94039fbdc30dc5ae42a124`.

## Funciones

- **Adjuntos.** Bandeja usa los adjuntos del historial web. Las miniaturas raster, la vista ampliada y la reproducción de audio y video usan archivos privados. PDF y documentos compatibles se abren mediante una acción expresa. En Android se abre el visor con un permiso temporal de lectura. En iOS se abre el selector del sistema. El visor nunca recibe un token ni una URL del CRM.
- **Envío de archivos.** Selector de fotos del sistema, cámara de fotos y selector de documentos. Vista previa, confirmación, indicador de preparación y subida, cancelación, bloqueo de doble toque y conciliación en caso incierto. El multipart contiene solo `file`, con MIME y nombre validados. La descarga valida tanto el tamaño declarado como los bytes reales. La caché propia y las copias temporales de los selectores se limpian al iniciar o cerrar una sesión y al expirar.
- **Pipeline.** Una etapa a la vez, tarjetas paginadas, detalle y acceso al chat. El asesor puede mover solo los leads que el servidor le permite ver. Entrar en Perdido pide un motivo activo. Tras un fallo de escritura, se vuelve a consultar el tablero.
- **IA.** El chat muestra el estado de IA y atención humana. Pausar, activar o reactivar un handoff usa el PATCH web. El asistente pide una reescritura del borrador tras un toque explícito y ofrece insertarla en el campo editable. Agentes muestra nombre y estado para quien tenga el permiso web.
- **Resultados.** Ventas, IA, origen, seguimiento y equipo con las rutas web. El rango inclusivo admite hasta 366 días y usa la zona del negocio. El `main` vigente devuelve 403 a Asesor para Resultados. El módulo se oculta a ese rol. Mostrarle un informe propio requeriría un cambio de permisos en el servidor.
- **Campañas.** Lista, estado y métricas. Los botones Crear y Enviar indican «Disponible en la versión web». El transporte bloquea acciones de campaña aunque el flag de escritura esté activo.
- **Ajustes.** Tema y orden de la barra B guardados en el dispositivo. Las entradas de módulos se validan con las rutas y permisos del CRM. Equipo es de lectura. Nombre de perfil, contraseña y 2FA remiten a la web. El login móvil solo devuelve sesión y vencimiento, y la probeta confirmó que `/api/auth/get-session` no devuelve el perfil con ese Bearer. Push queda en Demo. Equipo de chat, Mi número, edición de agentes y conocimiento, facturación y plataforma se indican como disponibles en la web.

## Rutas

| Método y ruta | Uso y forma |
| --- | --- |
| GET `/api/media/{assetId}` | Descarga binaria autenticada, ID de hasta 64 caracteres y sin consulta |
| POST `/api/conversations/{id}/messages/media` | Multipart con un único campo `file` |
| GET `/api/pipeline/board?take=50` | Tablero, con `&stageId={id}&offset={n}` solo para paginar la etapa |
| GET `/api/pipeline/loss-reasons` | Motivos activos |
| PATCH `/api/pipeline/leads/{id}` | `{stageId,lossReason?}` |
| PATCH `/api/conversations/{id}` | Ruta existente. IA usa `{aiEnabled:boolean}` o `{reactivate:true}`. Marcar leído conserva su cuerpo |
| GET `/api/writing-assist` | Disponibilidad del asistente |
| POST `/api/writing-assist` | `{action:"improve",text}`, hasta 4 000 caracteres |
| GET `/api/lab/agents` | Nombre y estado, con permiso `agent.manage` |
| GET `/api/analytics/{sales,bot,ads,team}` | Rango opcional exacto `?from=AAAA-MM-DD&to=AAAA-MM-DD` |
| GET `/api/analytics/hygiene` | Estado actual sin rango |
| GET `/api/campaigns` | Lista y métricas de entrega por campaña |
| GET `/api/campaigns/metrics` | Métricas generales con el mismo rango opcional |

Se mantienen las rutas de C3–C6, incluido el equipo en `GET /api/settings/team`. Toda escritura conectada conserva el requisito `EXPO_PUBLIC_ALLOW_SEND=true`. El login y la revocación conservan sus reglas anteriores. El Bearer se envía solo en cabecera, sin cookies ni redirecciones. El token permanece en SecureStore.

## Dependencias nativas

| Paquete fijado a la versión del SDK Expo 58 | Función |
| --- | --- |
| `expo-file-system@58.0.13` | Caché privada y lectura por bloques |
| `expo-image-picker@58.0.10` | Selector de fotos y cámara |
| `expo-document-picker@58.0.5` | Selector de documentos y copia controlada para preparar el envío |
| `expo-audio@58.0.12` | Reproducción local de audio |
| `expo-video@58.0.14` | Reproducción local de video |
| `expo-intent-launcher@58.0.3` | Abrir visor de documentos en Android |
| `expo-sharing@58.0.23` | Selector de apertura del sistema en iOS |

Se solicita cámara al tomar una foto. No se solicita acceso a toda la galería ni permiso de grabación de audio. La inspección de Expo corroboró versión, paquete y configuración. La revisión del manifiesto combinado y de los diálogos nativos queda para el binario.

## Verificación

- TypeScript, Prettier, inventario 158/158 y 692 pruebas móviles. Incluyen el perímetro HTTP, multipart decodificado con nombre/MIME/binario exactos, límites, cancelación antes y durante el envío, 401, suspensión, permiso, 404, 429, ventana cerrada, cuota simulada y ausencia de envío por el asistente.
- 31 pruebas de servidor con PostgreSQL local y RLS. Verificaron Bearer, CSRF de peticiones nativas, asesor restringido, propietario, acceso entre organizaciones, etapa inválida, motivo de pérdida, pausa y reactivación de IA y los permisos de agentes, campañas y resultados. La probeta registró un solo envío de PDF en wa-mock y devolvió 404 al descargarlo como otra organización. El primer intento de la probeta asumía acceso de Asesor a Resultados. Se corrigió la expectativa al verificar el 403 del servidor y se ocultó el acceso correspondiente.
- RN Web offline con transporte y APIs nativas simuladas. Pasaron navegación y cambio de Pipeline, Campañas de lectura, Resultados y permiso, Agentes y Ajustes, PDF y audio, pausa IA, sugerencia como borrador, cancelación y limpieza de caché. También pasó la regresión C6 de plantillas, respuestas rápidas, SSE y ciclo de vida. Cero solicitudes externas.
- [Probeta de los handlers](./PROBETA-MAIN.txt). Copiarla a `tests/db/c78-mobile-probe.test.ts` en un checkout descartable del SHA indicado. Usar una base PostgreSQL local nueva con sufijo `_test`, RLS y el directorio `MEDIA_DIR` privado. Configurar `APP_BASE_URL=http://localhost:3000`, `WA_MOCK_ENABLED=true` y `META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph`. Ejecutar con el config `vitest.db.config.ts` junto a `rls`, `mobile-session`, `pipeline-paginado` y `roles`.

## Límites, reversión y prueba física

- No se compiló APK ni se probó en dispositivo, CRM real, Meta o proveedor de IA. El porcentaje mide preparación local. Durante la transferencia se ve un indicador sin porcentaje de red porque el `expo/fetch` fijado no expone bytes enviados. En archivos cercanos a 100 MB, validar memoria, tiempo de subida y degradación bajo red lenta. Tras transmitir una parte, cancelar no garantiza que el servidor haya descartado la petición.
- Los topes del móvil reflejan los de WhatsApp, con hasta 100 MB para documentos y conversión de medios grandes a documento. Se excluyen documentos activos y ejecutables. La app interpreta 507/cuota cuando el servidor lo indica. El handler existente limita tamaño y concurrencia, pero no expone un prechequeo específico de cuota por organización. Un visor externo puede conservar su propia copia después de la apertura autorizada.
- Al retirar el flag de compilación, quedan bloqueados los envíos, movimientos, cambios de IA y solicitudes de sugerencias. Para revertir C7+C8, usar C6 o revertir los commits de esta rama. Para reemplazar una 0.2.0 instalada, conservar paquete y firma y subir versionCode.
- En el Motorola, actualizar sobre 0.1.9 cuando Claude apruebe la rama. Con un chat propio y archivos de prueba, verificar foto de galería, cámara con permiso permitido y denegado, PDF, audio y video. Confirmar una sola entrega, probar modo avión y cancelación, y revisar el historial antes de repetir. Cerrar sesión y verificar que los adjuntos anteriores ya no se puedan abrir desde la app.
- Comprobar Pipeline con Asesor y Propietario, etapa Perdido, pausa/reactivación de IA y edición del borrador sin envío. Revisar Resultados y Campañas con un rol autorizado, comprobar que los botones masivos son informativos y validar tema, barra y cierre de sesión. Los componentes de C6 conservan SSE en primer plano.
