# Checkpoint 111 · catálogos y Agenda

Rama `codex/dashfort-mobile-b-continuation-20261119`. Base exacta `fef438776b1d25166abb61464c7f33b9aaa82f86`. **111/158 IDs implementados, 47 pendientes**. No se repitieron implementaciones anteriores ni se mezcló main.

| Lote | Nuevos IDs | Pruebas acumuladas | Capturas nuevas / referencias |
|---|---|---:|---:|
| 14 · Catálogos | SET-05/05A, SET-07 | 436 | 21 / 6 |
| 15 · Agenda y conectores | SET-08 | 448 | 11 / 2 |

Inventario completo en docs/cobertura.csv y evidence/inventory-111.json, con los 47 IDs restantes. Más e índice Ajustes siguen incompletos: no se contabilizan por tener enlaces parciales. El acceso a los ajustes implementados es provisional por el laboratorio de demostración aprobado.

## Resultado verificable

448 pruebas de lógica aprobadas (41 nuevas), TypeScript y formato aprobados. 32 capturas reales nuevas en claro/oscuro, 390×844/360×640, ocho referencias originales. Galerías en evidence/catalog y evidence/calendar-settings; once comprobaciones web agrupadas nuevas. Sin imágenes conceptuales ni dependencias añadidas.

Regresiones: 70 capturas CRM/Contactos/Bandeja/Chat y cinco comprobaciones; Asistente (ocho), Agenda (ocho) y Tareas/Notas (diez). Informes JSON en evidence/regression-111. Sin errores de página ni solicitudes de red; no se arrancó listener HTTP/Metro. La QA usa componentes y proveedores RN reales, con dobles de router, sesión y almacenamiento. No acredita teclado, animación, accesibilidad, rendimiento o scroll nativos ni Expo Router completo.

## Correcciones importantes

- IDs estables y alias históricos resuelven renombres/fusiones/borrados de etiquetas. Filtros y opciones se actualizan en los módulos compartidos; no reviven nombres borrados. Otro permanece fijo.
- Las razones de pérdida nuevas están unificadas entre Pipeline y detalle de Chat; las antiguas conservan su texto al renombrar/desactivar motivos.
- Un motivo desactivado durante un guardado no puede instalarse como una nueva pérdida: se revalida después de escribir y se revierte. Catálogo no recuperado bloquea escrituras antes de tocar almacenamiento.
- Se conserva origen histórico aunque se borre la etiqueta Facebook Ads; un contacto orgánico nuevo no cambia de origen por etiquetarlo.
- Se corrigieron una actualización inicial innecesaria y una lectura tardía que podía reemplazar cambios recientes; se conservaron sus pruebas anteriores.
- Los conteos de etiquetas se memoizan sobre los contactos accesibles y los colores conservan contraste 4.5:1. Perfil B, tokens y componentes globales intactos.
- Agenda ya no ofrece enlace de reunión si el conector ficticio está apagado. Desconectar conserva citas; bloques manuales privados no se restringen al horario comercial.

## Límites que permanecen

Catálogos y conectores persisten localmente por organización; no hay CAS de servidor ni sincronización entre teléfonos. Las asignaciones de conversaciones de Inbox/CRM de sesión siguen siendo de sesión. Los detalles de Contacto guardados se restauran y normalizan; la compatibilidad v1 de la organización original se conserva y otras organizaciones ficticias usan v2 separado. Contadores indican registros ficticios accesibles, no la cifra decorativa de la maqueta. La automática de la muestra del contacto 3 sigue hidratándose al abrirlo, como antes.

Sonido de SET-14 sigue siendo preferencia persistida sin audio en demo. T-M5B mantiene su laboratorio silencioso; push remoto no está activo. No se han creado cuentas, invitaciones reales, conectores reales, IA o mensajes de WhatsApp.

## Conservación y APK

Commits por lotes: c6c46db (catálogos), e81eb35 (guardas y concurrencia), más el commit final de SET-08/documentación registrado en el manifiesto. Bundle de 110 y bundle final acumulativo verificados. Ambos requieren conservar la base Offline `f3f467abb7640ec13ffba590bc5dad91bc5cfd77`; no son repositorios completos autónomos. Restaurar hacia una rama NUEVA en una copia que contenga esa base; nunca reset/main o un árbol con cambios.

ZIP nuevo local con galerías, documentos, inventario y un único bundle final para evitar duplicación dentro del paquete. No borra respaldos anteriores ni se sube automáticamente a Drive/GitHub. Los 26 artefactos protegidos se comprobaron por SHA-256 sin cambios (evidence/protected-111.json), incluida APK 0.1.2 y firma experimental. No se incluye clave privada en ZIP/Git.

Configuración 0.1.3/versionCode 4/com.demfort.dashfort.dev preparada y conservada. No hay APK nueva: ~1.2 GiB libres tras evidencias y respaldos, muy inferior al margen conservador de 15 GiB. No se ejecutó Gradle, borró evidencia ni usó build remoto. Se requiere entorno con almacenamiento suficiente antes de compilar y probar Android/iOS.

Cambios exclusivamente apps/mobile. Backend reservado permanece en 562a8b386b7f0d0df9292406167357aa988fd4d0 sin cambios/arranque. Sin PostgreSQL, servidores, workers, migraciones, autenticación/HTTP real, WhatsApp, IA, campañas, pagos, proveedores, producción, Coolify o Hetzner. Sin push, PR, merge, tags, releases, despliegue o costos.

## Siguiente lote exacto

**SET-03, SET-03A y SET-03B: equipo, invitación y edición de persona ficticia.** Primero unificar el catálogo compartido de personas con asignaciones de Chat/Contactos/Pipeline, Tareas, Agenda y Uso; no duplicar miembros contradictorios. Roles ficticios, límite de personas, enlaces de un solo uso puramente locales, protección del último propietario, permisos y desactivación; no enviar correo ni crear sesiones o credenciales reales. Después EQP-01/02/06/03/04/05 y SET-09 según sus dependencias. No contar SET-01/MORE-01 hasta completar destinos y estados.

Reanudar verificando SHA del manifiesto, rama, árbol limpio y 111 IDs. No hacen falta aprobaciones individuales para lotes locales simulados. Claude y autorización explícita siguen siendo necesarios antes de activar backend, BD, infraestructura, autenticación/conexiones reales, migraciones o despliegues.
