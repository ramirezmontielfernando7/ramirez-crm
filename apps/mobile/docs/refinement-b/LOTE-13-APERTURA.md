# Lote 13 · Apertura AUTH-01

AUTH-01 implementada con la maqueta E original; **107/158 IDs, 51 pendientes, 407 pruebas de lógica** (7 nuevas). No se cambia el perfil B ni se añade un selector o una pantalla de acceso nueva.

Vista RN con marca de 84×84, radio 24, icono 46, título 26 y texto by Demfort según la referencia. Animación de escala con Animated nativo, 600 ms. Se solicita un presupuesto total de 800 ms desde el montaje, incluida lectura del indicador de primera apertura; al vencer continúa al destino de la sesión actual. «Reducir movimiento» omite la presentación y la espera. Las aperturas posteriores continúan inmediatamente tras leer el indicador local. No hay un botón Continuar necesario: en el HTML original ese botón solo permite recorrer el prototipo.

Un error de lectura salta la presentación; una escritura fallida o colgada nunca retrasa la redirección. Un resultado de lectura tardío o después del desmontaje no restaura la vista ni escribe. El indicador solo registra «seen», por instalación de demostración; no contiene identidad, credenciales ni información comercial. Si no se consigue guardar, puede repetirse en un arranque posterior. Los 800 ms son un límite solicitado al temporizador, no una garantía si el sistema suspende o bloquea el hilo JS. La carga previa de fuentes y sesión mantiene el comportamiento existente.

Siete pruebas con reloj controlado: primera apertura, repetición, movimiento reducido, fallos de lectura/escritura, almacenamiento sin respuesta y limpieza de lectura tardía. Cuatro capturas reales del componente RN en Chromium (movimiento reducido), dos referencias oficiales, ambos temas y tamaños. evidence/opening/comparacion.html. No se midió la animación real en navegador ni en teléfono; quedan primera instalación, relanzamiento, restauración y reducción de movimiento nativos pendientes.

Sin paquetes nativos nuevos ni cambios de compilación. La APK 0.1.2 no incluye estas pantallas nuevas: requiere futura 0.1.3 con recursos suficientes. No Gradle, servidores, backend, conexiones, push o servicios externos.
