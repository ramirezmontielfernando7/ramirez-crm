# Solicitud de revisión independiente para Claude

Revisa la rama `codex/dashfort-mobile-signing-20261125` de
`ramirezmontielfernando7/ramirez-crm`. Contrasta el diff con
`924abb112792a0324ac7a2ddbb3ab671000630ed`, lee los cuatro workflows nuevos,
`scripts/mobile-signing/` y la evidencia en esta carpeta. Las ramas de
trabajo están aisladas de `main`. La activación queda suspendida durante
la auditoría.

## Prompt para copiar

> Actúa como auditor independiente de la cadena de suministro Android.
> Verifica los workflows, scripts y evidencia de esta rama. Intenta
> refutar los límites de confianza: checkout de control frente a fuente
> Expo, IDs de ejecución y artefacto, digest del ZIP, hash de APK antes y
> después de la aprobación, downgrade, aislamiento de red, aprobación
> explícita del propietario, historial de reintentos, certificado de
> laboratorio frente al histórico y publicación de resultados. Revisa
> además que el despacho MCP no pueda llamar a TWA, credenciales, ramas
> arbitrarias ni despliegues, y que pueda revocarse cliente por cliente.
> Distingue revisiones de código, pruebas de laboratorio y validación
> hospedada. Devuelve hallazgos priorizados, evidencia y un veredicto
> independiente para la activación. No solicites, cargues ni leas la
> clave original. No cambies main, infraestructura, producción ni TWA.

## Preguntas de auditoría

- ¿Puede un actor con permiso de escritura en ramas de aplicación
  sustituir el workflow de control, falsificar la rama o alterar la APK
  entre verificación y firma? Comprobar reglas remotas antes de cargar
  secretos. El código de la app puede construir un binario malicioso, de
  modo que la revisión humana debe incluir su SHA fuente.
- ¿Envía el job firmante tráfico externo con secretos o ejecuta archivos de
  la APK? APT/SDK, runner, kernel y acciones fijadas son dependencias de
  confianza. La prueba hospedada del namespace es un requisito de activación.
- ¿Está confinada la opción `automatic_lab` al demo y al certificado
  efímero? Comprobar que el job no referencia entornos ni secretos de firma
  y que un modo real con esa opción se rechaza en GitHub. Revisar también
  el aprovisionador de permisos administrativos, que debe operar solo
  sobre la rama y los entornos de firma expresamente aprobados.
- ¿Es efectivo el gate `deployment: false` con revisión obligatoria y
  registro de revisión consultable? Si falla cualquiera de esas condiciones,
  conservar la firma deshabilitada.
- ¿El token de GitHub permanece en el host autenticado del adaptador MCP?
  Verificar TLS, credenciales separadas para clientes, registros redacted,
  revocación y ausencia de una terminal o proxy HTTP arbitrario para agentes.
- ¿Coinciden salida y APK 0.2.2 en paquete e identidad del certificado?
  La clave desechable de laboratorio debe producir una huella distinta.
- ¿Puede Fer recuperar el cifrado en un equipo independiente y volver a
  configurar la firma sin Codex Cloud? Exigir identidad del destinatario
  verificada y confirmación de la recuperación antes de activar.

No hay integración de Claude disponible en esta ejecución. Este documento
es la solicitud de auditoría y no representa un veredicto externo.
