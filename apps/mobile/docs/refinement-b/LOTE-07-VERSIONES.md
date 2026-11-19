# Lote 07 · Publicación local, versiones y pausa

Reanudación autorizada por el propietario desde `a4268bf7608bd84fa034b7b5698aadae7bed78af`. Misma rama B. **LAB-05/06/06C/07 verificados; 90/158 IDs, 68 pendientes.** Se reutilizaron los métodos y capas preparados, sin repetir Agentes.

La publicación es exclusivamente una transición del documento ficticio local. Una confirmación conserva una copia inmutable del borrador guardado; editar después no cambia esa copia ni otras versiones. Se rechazan borradores pendientes, vacíos, sin cambios, obsoletos o sobre el límite de 50 versiones. Un reintento con el mismo identificador no añade otra publicación, incluso tras restaurar datos.

Versiones lista las copias disponibles. Cargar requiere confirmación, reemplaza solo el borrador y no altera lo publicado. Cancelar vuelve a la lista. La versión general siempre conserva el uso del conocimiento compartido. La pausa global y la individual se conservan independientemente; el enrutador ficticio deriva a una persona, nunca responde con silencio. Reanudar la global no elimina una pausa individual. No se modifican mensajes ni previews existentes.

Se corrigieron dos casos adversariales detectados en código: la carga de una versión no debe borrar texto nuevo escrito durante una escritura lenta; y repetir una carga ya confirmada no debe limpiar un búfer creado después. Se conservan solo los campos posteriores al inicio de la carga y se actualiza su revisión base. También se preservan referencias de versiones inmutables para evitar reconstrucciones innecesarias.

## Verificación

- **315 pruebas de lógica aprobadas**: 12 nuevas y las 303 anteriores.
- TypeScript y formato aprobados. Sin dependencias nuevas.
- **20 capturas reales**: cuatro IDs × dos temas × dos tamaños (16), pausa en ambos temas (2), error de publicación y versiones vacías (2).
- **8 referencias** originales y `evidence/versions/comparacion.html`.
- Cuatro comprobaciones agrupadas RN Web: confirmaciones/cancelaciones, fallo y reintento de publicación, restauración del borrador separado del historial, y lista vacía usable. Las capturas ejercitan el retorno a Versiones y la reanudación global.
- Cero errores de página/cero solicitudes de red. Chromium offline; componentes/proveedores/capas reales con dobles del host de sesión/router/almacenamiento. No acredita Expo Router completo ni Android/iOS.

## Conservación y continuación

Solo apps/mobile. B, APK 0.1.2, firma y configuración preparada 0.1.3 intactas. Sin Gradle por espacio insuficiente, servicios/IA/créditos reales, autenticación/HTTP real, backend/BD/workers, producción, push o despliegues.

Siguiente lote: **LAB-20/21**, usando las etapas del Pipeline y agentes publicados no generales; comprobar identidad de etapas al eliminarlas/recrearlas, restauración de asignaciones, conflictos y fallback. Después LAB-30/31 con pruebas exclusivamente simuladas. La pausa anterior ya fue levantada por el propietario; continuar entre lotes seguros sin pedir aprobación de cada pantalla.
