# Lote 08 · Asignación de agentes por etapas

Desde `407f95443d64ef29e6a42fa82626c8806b98fe5e`, misma rama B. **LAB-20/21 implementados: 92/158 IDs, 66 pendientes.**

La lista usa el catálogo del repositorio ficticio del Pipeline: mismos nombres, orden, identidades y colores. Se centralizan los seis colores existentes sin cambiar valores ni tokens. El catálogo notifica solo sus propios cambios; los mensajes nuevos no provocan eventos de catálogo.

La hoja ofrece el general como fallback y únicamente agentes publicados no generales. Reemplazar una asignación requiere confirmar; cancelar no escribe. Se validan revisiones de asignación, etapa actual, rol y elegibilidad. Un fallo conserva el vínculo anterior y permite reintentar. Se muestra el tono publicado, separado del borrador, y si el agente está en pausa. Una pausa deriva a persona en el enrutador ficticio.

Las etapas iniciales conservan IDs estables. Las personalizadas tienen identidad nueva al eliminarlas/recrearlas y un namespace de instancia para no reutilizar una asignación antigua al reiniciar el catálogo ficticio. **El catálogo personalizado del CRM todavía es de sesión**: esta etapa no finge persistirlo. Al restaurar, se conservan vínculos de etapas iniciales; los de etapas ausentes se ignoran y se limpian en la siguiente escritura de asignación. Si la etapa se elimina durante un guardado lento, la referencia puede quedar histórica en el documento, pero no participa del enrutamiento y la UI avisa al terminar. No hay una transacción de servidor ni base de datos.

## Verificación

- **327 pruebas de lógica aprobadas**: 12 nuevas; 315 anteriores conservadas. TypeScript y formato aprobados.
- Catálogo/color/orden compartidos; elegibilidad, fallback, idempotencia, reemplazo obsoleto, error/reintento, eliminación/recreación, nueva instancia, restauración, borrado durante escritura lenta, pausas, general, suscriptores y roles.
- **14 capturas reales**: dos IDs × dos temas × dos tamaños (8), cuatro estados, confirmación de reemplazo y error de escritura (6). **4 referencias**, galería `evidence/assignments/comparacion.html`.
- Cuatro comprobaciones agrupadas RN Web, incluyendo modelo Pipeline real compartido y eliminación/recreación. Cero errores/red.
- Regresión adicional de 19 IDs CRM, búsquedas y Bandeja→Chat con proveedores/capas reales: 70 capturas en `artifacts/continuation-assignments/regression`, cinco comprobaciones agrupadas; cero errores/red. Los resultados se conservan en este lote.

QA web offline con dobles de sesión/router/almacenamiento; no acredita Android/iOS ni Expo Router completo. Pendiente validación nativa, accesibilidad/teclado/scroll y persistencia real futura.

Solo apps/mobile. Sin nuevas dependencias, cambios de B, APK/firma, backend, autenticación/HTTP real, servidores/BD/workers, producción, IA, crédito, push o despliegues. No Gradle: continúa faltando espacio.

Siguiente lote: **LAB-30/31**, evaluaciones deterministas con snapshot de configuración, repetición trazable y arreglos únicamente en borrador. El destino «En el asistente» deberá conservar el contexto y funcionar; no se contará como resuelto un marcador pendiente.
