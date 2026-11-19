# B original implementada · checkpoint visual

## Base y alcance

Rama local `codex/dashfort-mobile-b-continuation-20261119`, derivada de `7f068daf10e8e2b78f81bdc4c953887352d39587` (laboratorio), que conserva `f3f467abb7640ec13ffba590bc5dad91bc5cfd77` (Offline). El propietario aprobó expresamente B y sustituyó la congelación visual solo para sus ajustes. No se mezcló main. Backend separado en `562a8b386b7f0d0df9292406167357aa988fd4d0`, intacto y sin arrancar.

## Implementación exacta

Valores de `src/theme/refinement-b.ts` comprobados automáticamente contra el perfil B original. Título modular 24/30 Inter 500, mínimo 52; iconos 21/trazo 1.8, blanco táctil 48×48; selector 52 total, radios 26/24, padding 2 y opción 48, letra 13.5; filtros 32 visual, padding 12, gap 6, letra 12.5. Nombres/vistas previas en filas de Bandeja y Contactos 15.5/13.5, con líneas originales. Paleta original íntegra.

`ui.tsx` acepta refinamiento opcional. `ModuleUi.tsx` activa B explícitamente. Solo Bandeja, CrmView e iconos de ConversationScreen optan a estos componentes. Las galerías, formularios de acceso, burbujas, avatares, etiquetas de etapa, tarjetas y navegación conservan sus estilos. El selector local de CRM sigue siendo Pipeline/Contactos/Biblioteca; solo adopta la letra 13.5 visible en su referencia B. No se añade el selector de Clientes/Equipo/Mi número a otras pantallas. La tipografía global no se modifica.

## Verificación

- TypeScript estricto: pasa.
- 207 pruebas existentes: pasan; dos pruebas adicionales del contrato visual y conservación de tokens: pasan.
- 32 capturas de anterior/implementada: Bandeja, Contactos, Pipeline y Chat × claro/oscuro × 390×844/360×640.
- 38 capturas adicionales de los 19 IDs CRM previos, ambos temas. Se montan `CrmScreen`, `CrmView`, `CrmOverlay`, InboxProvider, ChatProvider, ContactProvider y LayerProvider reales. Las capas no se dibujan a mano.
- Comprobaciones de navegador: buscar en Bandeja y abrir ConversationScreen, buscar/ficha/editar contacto con modal real, aislamiento del asesor y blancos táctiles del selector >=48.
- Cero errores JavaScript y cero solicitudes de red. Sin servidor HTTP.
- Bandeja coincide **píxel por píxel** con las cuatro capturas originales B. Pipeline coincide a 390×844 en ambos temas. Contactos tiene hasta cuatro píxeles distintos por suavizado de un borde del selector local, sin desplazamiento de geometría.

Regresión encontrada en el primer host de QA: faltaba un contenedor raíz flexible, por lo que controles flotantes quedaban fuera del viewport. Se corrigió el host, se regeneraron todas las capturas y se repitieron sus recorridos. No fue necesario modificar esos controles en la aplicación.

El QA es integrado a nivel de módulo React Native Web, con sesión/tema/almacenamiento/router de pruebas. No equivale a arrancar Expo completo ni al QA nativo de los 19 IDs. Teclado Android/iOS, gestos, TalkBack/VoiceOver, escalado de fuente y conservación de scroll tras terminar el proceso siguen pendientes en dispositivo. El chat conserva su título y burbujas; solo sus IconButton adoptan 21.

## APK y conservación

La configuración prepara **0.1.3 / versionCode 4**, ID `com.demfort.dashfort.dev`, ARM64 como receta de compilación. **No existe una APK 0.1.3 compilada en este checkpoint.**

El SDK Platform 37 y Build Tools 37 están presentes; Java por defecto es 21. La clave experimental existe fuera de Git y su certificado público SHA-256 coincide con 0.1.2: `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b`. No se copia ni respalda la clave privada.

Bloqueo concreto: unos 160 MB libres, frente a los 15 GB recomendados por la receta local. No se inicia Gradle ni se elimina ningún artefacto anterior para intentar compilar con ese margen. Antes de compilar habrá que habilitar espacio local suficiente y verificar un JDK completo compatible; no se activa EAS, Actions ni otro servicio.

APK 0.1.2 conservada, SHA-256 `36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a`. Se comprobó que la firma existente es compatible; no se afirma haber generado ni instalado el binario nuevo.

### Procedimiento de compilación futura y actualización

Usar una copia móvil aislada del commit que se quiera compilar, sin reutilizar un proyecto Android generado con configuración anterior. Definir ANDROID_HOME, un JDK completo compatible, MOBILE_SIGNING_KEY apuntando a la clave experimental existente, MOBILE_ANDROID_ABIS=arm64-v8a, MOBILE_ANDROID_LEAN=1 y MOBILE_APK_OUTPUT con una ruta nueva. Ejecutar `npm run apk:local`. El script rechaza salidas existentes y proyectos nativos con huella distinta; no quitar esa protección. Verificar con `scripts/verify-apk.py` y el certificado público anterior.

Solo después de tener y verificar una APK real: copiarla al Motorola e instalar como **Actualizar** Dashfort Dev, sin desinstalar 0.1.2 ni tocar la TWA. Comprobar Bandeja/Chat/Contactos/Pipeline, teclado, scroll, selección, retorno y avisos locales con permisos concedidos/denegados. No se promete funcionamiento de un binario que todavía no existe.

## Evidencias y siguiente trabajo autorizado

`scripts/refinement-b-qa.mjs` reproduce las capturas sin red; `scripts/refinement-b-delivery.py` ensambla el HTML/ZIP y verifica píxeles de B original. `evidence/` conserva resultados y las 70 capturas en Git local. Para comparar, abrir el HTML autónomo de `artifacts/refinement-b/Dashfort-B-Implementada-Evidencias.zip`.

Esta fase no añade IDs: se conservan 61 implementados y 97 pendientes al terminar B. Los 19 de CRM ya tienen QA integrado de módulo en RN Web; nativo sigue pendiente. La continuación autorizada es un lote funcional de pantallas restantes con sus propias maquetas, datos ficticios y commits locales, sin depender de la compilación bloqueada.

Sin cambios en backend, PostgreSQL, CRM web, TWA, infraestructura o producción. Sin push, PR, merge, releases, distribución de APK ni servicios externos. El expediente de Claude se preparará al llegar a una operación real de riesgo; no se inicia autenticación real.
