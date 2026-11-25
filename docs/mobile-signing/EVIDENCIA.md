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
