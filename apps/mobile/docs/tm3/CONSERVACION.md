# Conservación local T-M3

Rama exclusiva `codex/dashfort-mobile-tm3-20261111`, base T-M2 `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`. Los respaldos T-M1 y T-M2 se conservan. No se hizo push ni se creó PR, merge, tag, release, despliegue o workflow manual.

Fuentes: `/workspace/work/ramirez-crm/apps/mobile`.
Respaldo separado: `/workspace/work/entrega-dashfort-tm3`.

El ZIP contiene únicamente archivos móviles versionados, incluidas pruebas, referencias e informes. Excluye `node_modules`, proyectos nativos generados, `dist`, cachés, .env y claves de firma. Un manifiesto externo registra commit completo, SHA-256 y verificación de contenido. El bundle incremental conserva todos los commits T-M3 desde T-M2 y requiere el repositorio que ya contiene esa base.

Restaurar en un clon que contenga T-M2, conservando otras ramas:

```bash
git bundle verify /ruta/dashfort-mobile-tm3.bundle
git fetch /ruta/dashfort-mobile-tm3.bundle refs/heads/codex/dashfort-mobile-tm3-20261111:refs/heads/recovery/dashfort-mobile-tm3
git switch recovery/dashfort-mobile-tm3
cd apps/mobile
npm ci
npm run typecheck
npm test
```

El ZIP también permite trabajar solo en Mobile, sin el CRM. Las comparaciones están en `docs/tm3/comparacion.html`, con archivos relativos. Los logs e informes de navegador figuran en `docs/tm3/evidence`. Para servir el comparador localmente, desde apps/mobile ejecutar `python -m http.server 8082 --bind 127.0.0.1 --directory docs/tm3` y abrir `http://127.0.0.1:8082/comparacion.html`. Los exports Hermes, no instalables, se conservan en el directorio de artefactos local y separados del ZIP de fuentes.

No se inventa un enlace de descarga ni se publica GitHub para sustituir el directorio de salida de sesión que no está disponible. Para respaldar esta rama remotamente se necesitará autorización nueva y comprobar los disparadores vigentes; la autorización anterior de T-M2 no se reutiliza.
