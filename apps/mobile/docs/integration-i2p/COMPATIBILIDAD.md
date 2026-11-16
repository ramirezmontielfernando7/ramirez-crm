# Compatibilidad con el build web · Lectura y propuestas, sin cambios raíz

Referencia: main **834806ec8616375fd8acb7961ac0d830ac9d0066**. No se ejecutó `pnpm build`, Docker, Next, migraciones, instalación raíz ni backend.

| Confirmado mediante código | Riesgo / propuesta para revisión |
|---|---|
| tsconfig raíz incluye `**/*.ts` y `**/*.tsx`, excluye node_modules y scripts, no apps/mobile | Al fusionar Mobile, el typecheck web puede incluir RN/Expo/tests con un compilador/configuración diferente. Proponer exclude apps/mobile/** en config web y ejecutar typecheck móvil por separado. No se afirmó haber reproducido un error del compilador web |
| ESLint raíz ignora node_modules/.next/etc. pero no Mobile | Las reglas Next/typescript y no-unused-vars pueden analizar RN con reglas ajenas. Proponer ignore apps/mobile/** y un check móvil independiente; no apagar lint global |
| Dockerfile builder usa COPY . .; .dockerignore no excluye explícitamente apps/mobile | Riesgo de contexto enorme y artefactos locales/claves de builds si se construye desde un workspace sucio; .gitignore no equivale a .dockerignore. Proponer excluir apps/mobile del contexto web o allowlist estricta de COPY. Verificar patrones reales en un contexto temporal antes de afirmar qué datos entrarían; no se construyó imagen |
| Docker declara SKIP_BUILD_CHECKS=1 apoyándose en CI | No usarlo como arreglo. Corregir límites web/móvil en la configuración y validar ambos checks antes de cualquier merge/despliegue |
| Vitest raíz solo tests/unit/**/*.test.ts | Los tests móviles no deben darse por ejecutados desde pnpm test. Conservar npm test dentro de apps/mobile, sin mover tests al backend |
| pnpm-lock raíz y package-lock móvil independientes; versiones React/TypeScript diferentes | No instalar Better Auth/Expo en la raíz por comodidad. No cambiar gestor/lock compartido. I2-P no añade dependencias ni fuerza deduplicación/actualización de React web |
| Backend Better Auth 1.7.19 no configura plugin Expo/bearer móvil en el código revisado | Evaluar adaptación oficial solo en staging con versión acreditada; cualquier cambio de plugin, orígenes o bootstrap requiere aprobación backend. No reutilizar bearer MCP ni abrir organización genérica |

Corrección mínima futura propuesta: diff separado de tsconfig/ESLint/.dockerignore en raíz, aprobado y probado contra un checkout test antes de merge; jobs web y mobile separados, sin ampliar disparadores de despliegue. No modificar colores, navegación, fuentes, Next global, DB o flags productivos para resolver un problema de inclusión de archivos. El historial y APK aprobados permanecen recuperables.
