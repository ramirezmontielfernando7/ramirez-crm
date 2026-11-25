# Firma experimental de Dashfort Mobile

Carril ligero. El propietario puede autorizar desde GitHub la firma de una
APK exacta preparada por una herramienta delegada. Una compilación registra
rama, commit, versión y hash. Un proceso separado verifica ejecución,
artefacto y APK antes y después de la aprobación. Solo el paso firmante
recibe la clave. Para una actualización conserva paquete, ABI y certificado
y exige un versionCode mayor que la versión de referencia configurada.

La rama de control y los scripts firmantes se revisan por separado de la app.
La publicación de una APK firmada será visible como artefacto del repositorio
público. El procedimiento de respaldo cifra el keystore original para una
identidad del propietario y comprueba la recuperación. El laboratorio utiliza
una clave efímera y prueba rechazos de procedencia, integridad y metadatos.

La entrega prepara los archivos, la auditoría y las pruebas locales. El entorno
de GitHub, la transferencia y cualquier ejecución con la clave original se
reservan para una autorización específica. Quedan fuera el servidor, TWA,
producción, Releases y los despliegues.
