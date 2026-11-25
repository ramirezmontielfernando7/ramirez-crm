# Operación de firma sin configurar GitHub manualmente

## Qué se automatiza

La compilación y firma conservan procesos independientes. Claude, Codex
y otros clientes autorizados usan el despachador MCP desde un host
administrado. El host conserva una credencial de una identidad distinta
del propietario, con acceso a Actions únicamente en el repositorio
autorizado. Las IA reciben acceso solo a las herramientas concretas del
despachador. Una vez activado, la intervención habitual del propietario
es aprobar desde GitHub la ejecución que muestra el SHA exacto de la APK.

Para la activación única se usa `scripts/mobile-signing/bootstrap.py` desde
un host confiable con una credencial administrativa temporal, separada
por completo de las credenciales del despachador y del firmante. El
aprovisionador es de solo lectura por defecto. Su aplicación requiere
`--apply`, el modo explícito y el SHA aprobado. La aplicación crea
únicamente entornos y reglas identificados de firma. Relee políticas y
rama al final y se detiene ante configuraciones existentes distintas.

| Modo | Cambios propuestos |
| --- | --- |
| `lab` | Crear el entorno desechable, con revisor requerido, sin autoaprobación ni bypass, autorizado solo desde la rama de control. |
| `live` | Congelar exactamente la rama de control auditada, verificar las reglas activas y crear el entorno real con los mismos controles de revisión. |

El aprovisionador no administra secretos, no cambia la rama
predeterminada y no habilita la firma. La rama congelada impide actualizaciones
y borrados hasta que el equipo/propietario autorice una revisión de la
política. Si la API rechaza parte de la configuración, detener el proceso y
verificar el estado antes de autorizar cualquier carga de clave.

En este repositorio la credencial de la integración actual obtiene HTTP
403 al crear entornos. GitHub devolvió de forma explícita
`X-Accepted-GitHub-Permissions: administration=write`. La cuenta tiene
rol administrativo, pero el token instalado carece de ese permiso.
La alternativa sin configuración manual es que el propietario autorice
una GitHub App o un operador administrativo existente, limitado a este
repositorio. El operador puede aplicar el aprovisionador y retirar
después la credencial temporal. Las IA y el runner nunca reciben ese
permiso. La ejecución de solo lectura ya se comprobó en GitHub; la
aplicación idempotente y el rechazo de políticas distintas se probaron
contra una API simulada. [Permiso requerido por GitHub](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment)

### Alcance de las identidades

- Aprovisionamiento de reglas y entornos: `Administration: write`
  en este repositorio, concedido solo al operador temporal.
- Alta posterior de secretos: `Environments: write`, con cifrado al
  destinatario público del entorno mediante una herramienta fiable.
  La activación de variables del repositorio requiere `Variables: write`.
- Despacho diario: `Actions: write` y lectura de contenido, solo en el
  host autenticado que aplica la lista de operaciones y no comparte
  esos permisos con clientes de IA.

[Secretos de entorno](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret) ·
[Variables del repositorio](https://docs.github.com/en/rest/actions/variables#create-a-repository-variable)

## Laboratorio automático

La opción `automatic_lab` se acepta exclusivamente con `mode=lab` y
requiere los metadatos que fija el verificador para el demo 0.2.2, código 13,
fuente `877646e55d9809a5963127426a2834534183983c`. El job no referencia
entornos ni secretos de firma. La fase de comprobación valida la ejecución,
digests, APK y ref. Tras el preflight, un runner nuevo vuelve a descargar
y verificar el artefacto, crea una clave desechable y firma sin acceso a la
red. Comprueba igualdad de los miembros ZIP, identidad desechable, v2/v3 y
checksum. La salida se llama `LAB-Dashfort-…` y vence en un día. Ese binario
no es actualizable sobre una instalación firmada con la clave histórica.

## Prueba independiente de aprobación humana

La ejecución automática no acredita que GitHub exija o registre una
aprobación humana. Se comprueba de forma independiente, aun con clave
desechable, una vez aplicada la configuración de laboratorio:

1. Leer de GitHub el revisor, autoaprobación, bypass y rama exacta del entorno.
2. Despachar desde otra identidad mediante el workflow de solicitud de
   laboratorio. Usar `mode=lab` y dejar `automatic_lab=false`.
3. Comprobar que el firmante permanece en espera. Solicitar al propietario
   un único clic de aprobación en GitHub para la prueba.
4. Comprobar el registro auténtico de su aprobación y el firmante, y
   confirmar que GitHub registró cero despliegues. Ante cualquier fallo
   mantener la firma real apagada. Los rechazos por aprobación ausente,
   negativa o del propio solicitante ya están cubiertos con pruebas locales.

## Puerta única de activación

Después de la auditoría independiente, agrupar la autorización del
propietario para el operador administrativo temporal y el host del
despachador, el destinatario de cifrado y almacenamiento privado, la
transferencia del respaldo verificado, la carga de secretos definitivos y
el destino de entrega de la primera APK real. Si la APK debe ser privada,
mantener deshabilitada la distribución pública e instalar una salida
privada antes de cargar secretos. No se requiere que el propietario
transcriba comandos ni credenciales al chat.

El certificado histórico y el paquete se mantienen. El despliegue en
GitHub y el host autenticado eliminan la dependencia cotidiana de
Codex Cloud después de enrolar una sola vez la clave original. El
respaldo independiente permite recuperar la misma identidad de firma.
La revocación de clientes, el interruptor de emergencia y la retirada
de secretos se describen en [la guía de auditoría](README.md).
