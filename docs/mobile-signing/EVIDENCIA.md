# Evidencia de validación

## GitHub Actions y laboratorio

- [Registro del workflow de build](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45690819133) y [registro del workflow de firma](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45690819134). Ambos pasaron con los jobs de registro en la rama aislada.
- [Solicitud manual inicial](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45690892127). GitHub aceptó `workflow_dispatch` desde la rama aislada registrada. El job rechazó correctamente `versionCode=13` para el modo real, antes de instalar dependencias. La rama predeterminada siguió siendo `main`.
- [Prueba hospedada con APK sintética y clave desechable](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45692338724). Ubuntu hospedado generó la APK ARM64, ejecutó `unshare --net`, firmó con clave efímera y verificó v2, v3 y checksum. No subió APK ni clave. Esta prueba ejercita el runner y el firmante sin sustituir la aprobación del flujo integral.
- [Referencia no autorizada](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45692389007). Se recibió el evento, pero GitHub omitió los jobs de build al invocarlos desde la rama de smoke controlada.
- [Build Expo completo](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45691119250). Aprobó TypeScript, formato, 705 pruebas de aplicación y verificación del inventario. Gradle completó `:app:assembleRelease` con R8 y el job publicó el artefacto `15058659066` desde `877646e55d9809a5963127426a2834534183983c`. Se recuperó el ZIP y se comprobó su digest `545167de5c84890a906932a46beda47172f674ef7d2cb27f006d83a0b267bb70`. La APK demo sin firmar declaró `com.demfort.dashfort.dev`, `0.2.2`, `13` y ARM64. SHA-256 de la APK `e2b3453dc48bab0121e0d9361102e5d50d3389888ffbffaa2c3c326049303521`.
- [Preflight hospedado válido](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45693223091) y [preflight con hash alterado](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45693229691). Con el mismo commit y artefacto, el verificador aceptó el SHA válido y rechazó el alterado. El job de firma quedó omitido en ambos casos. Las solicitudes de prueba las inició la identidad del propietario, que no puede aprobar su propia firma.
- [Cancelación real](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45693372574). Se solicitó cancelar una revisión de laboratorio y GitHub la confirmó como `cancelled` antes de firmar.
- La primera descarga directa del artefacto público en Codex devolvió HTTP 403 con una URL temporal de descarga en el diagnóstico de la CLI. El conector de GitHub recuperó el ZIP y se verificó su integridad. El script ahora suprime ese tipo de diagnóstico durante la descarga para evitar republicar URLs temporales. No se expuso la credencial de GitHub ni material del keystore.
- La integración de GitHub devolvió HTTP 403 al intentar crear el entorno aislado de aprobación del laboratorio. Se necesita una cuenta con permisos de administración del repositorio. Quedó pendiente la creación desde Settings y la aprobación humana independiente. No se reemplazó el gate con una aprobación simulada.
- La API de GitHub devolvió 0 despliegues para las ramas verificadas. El listado de webhooks externos devolvió HTTP 403. No se modificó ninguno de los workflows existentes.

## Pruebas locales

`actionlint`, sintaxis Bash, `git diff --check` y 11 métodos de prueba Python
con múltiples variantes adversariales. Incluyen firma ARM64 y v2/v3 reales,
comparación del contenido firmado con el sin firmar, rechazo de modificación
de ZIP y hash, de paquete y versionCode distintos, de certificado ajeno y
de aprobación ausente, rechazada o del mismo usuario. El cifrado y descifrado
recuperaron exactamente el keystore desechable. Las pruebas del host bloquean
llamadas a la TWA y refs arbitrarias, revocan una credencial individual e
impiden que un agente cancele ejecuciones. La revocación de clientes del despachador se ensayó localmente. Falta
comprobarla en el host que se autorice para operación continua.

La suite se reproduce desde la rama con las variables Android documentadas en
[README](README.md), usando este comando:

```bash
python3 -m unittest discover -s scripts/mobile-signing -p 'test*.py' -v
```

## Comprobaciones previas a la activación real

La firma real sigue desactivada; la clave original permanece fuera de GitHub
y no se ha transferido. El respaldo real espera el destinatario criptográfico
y almacenamiento privado autorizados. No se ha realizado la prueba de
actualización física sobre la 0.2.2. Tampoco se ha producido un veredicto de
auditoría externo. [Prompt para Claude](AUDITORIA-CLAUDE.md)

## Laboratorio integral sin entorno protegido

- [Compilación Expo de esta revisión](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45697719067).
  R8 y el build ARM64 completaron. Pasaron 705 pruebas. El artefacto
  `15063690213` contiene la APK demo del commit fijo
  `877646e55d9809a5963127426a2834534183983c`. Su ZIP coincidió con el
  digest de GitHub
  `fc9f43c643ec744a1af9612f9a0b015b1ffcfb868092042172d2f833e310620f`.
  El SHA-256 de la APK sin firmar fue
  `e2b3453dc48bab0121e0d9361102e5d50d3389888ffbffaa2c3c326049303521`,
  idéntico al obtenido en el build de referencia. Paquete
  `com.demfort.dashfort.dev`, versión 0.2.2, código 13, exclusivamente ARM64.
- [Rechazo de la firma real automática](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45698112150).
  GitHub rechazó esa combinación de modo y opción y omitió los firmantes.
  La comparación estructural del YAML confirmó que el job real conserva
  sus controles y que el job automático de laboratorio carece de entorno
  y de referencias a secretos. Sus permisos son de lectura.
- GitHub confirmó que el API de creación exige
  `X-Accepted-GitHub-Permissions: administration=write`. Devolvió 403 a la
  integración actual. Los planes de aprovisionamiento real y de laboratorio
  se leyeron desde GitHub. Las cuatro pruebas locales añadidas comprobaron
  solo lectura por defecto, aplicación idempotente en simulación,
  rechazo del SHA incorrecto y rechazo de políticas ajenas. La suite
  ampliada tiene 15 métodos de prueba aprobados.
- [Firma automática de laboratorio](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45700269926).
  Pasaron el preflight y la firma en otro runner hospedado sin red, sin
  entorno ni secretos de firma. El job protegido y el firmante real se
  omitieron. Se recuperó el artefacto `15062676726`, se cotejó su digest
  externo y se comprobó que contenía exactamente la APK y su checksum.
  La APK conservó el paquete, código 13, ARM64 y firmas v2/v3. El firmante
  verificó que no cambió el contenido de los miembros del ZIP.
  SHA-256 de APK
  `d9dd2bc5d89feae23a5046f3f8a23fde4e77c8f75d224992ca50929a9063f089`.
  Certificado público desechable
  `d7f787570b62cb6550ea405e4f6d71ebc62ac165b54c6cac0fb7385bc0a1105b`.
  Es distinto del certificado histórico y no actualiza su instalación.
- [Artefacto correcto con hash de solicitud alterado](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/45700274913).
  El preflight falló y omitió los tres jobs de firma. No produjo una APK
  firmada. Este rechazo se comprobó con `automatic_lab=true`.

La prueba independiente de aprobación nativa sigue pendiente. El
laboratorio automático valida compilación, transporte, firma y verificación
de extremo a extremo. No acredita que GitHub haya solicitado o registrado
una aprobación humana. El job real queda desactivado. La clave original,
los secretos definitivos y las variables de activación siguen sin trasladar
ni configurar.
