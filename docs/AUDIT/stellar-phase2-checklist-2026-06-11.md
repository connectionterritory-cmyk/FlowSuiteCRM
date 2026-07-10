# Fase 2 Segura para Salir de Stellar

Fecha: 2026-06-11

Objetivo: dejar listo el corte de Namecheap Stellar/cPanel sin romper CRM, API, login, formularios, leads, cotizaciones, mensajes ni correo.

Reglas activas de esta fase:

- No borrar archivos todavia.
- No cambiar DNS todavia.
- No cancelar Stellar todavia.
- No mover produccion sin backup y pruebas.

## Resumen operativo

Hallazgos clave confirmados antes de esta Fase 2:

- El CRM moderno no muestra dependencia directa de `api.flowiadigital.com`.
- El login moderno usa Supabase Auth.
- La mensajeria moderna usa `outbox_messages` + Supabase Edge Functions.
- `api.flowiadigital.com` sigue exponiendo codigo legacy, archivos y credenciales desde cPanel/LiteSpeed.

Implicacion:

- La salida de Stellar parece viable.
- Pero primero hay que respaldar cPanel, cerrar la exposicion publica del API legacy y rotar credenciales.

## Evidencia nueva consolidada

### 1. El CRM moderno no llama directamente al API legacy

No encontre referencias directas a `api.flowiadigital.com` en `flowsuitecrm/src`.

En cambio:

- Login moderno via Supabase Auth: [flowsuitecrm/src/modules/auth/LoginPage.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/modules/auth/LoginPage.tsx:27)
- Cliente Supabase del frontend: [flowsuitecrm/src/lib/supabase/client.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/lib/supabase/client.ts:1)
- Mensajeria moderna via Edge Function `process-outbox`: [flowsuitecrm/src/components/messaging/MessagingProvider.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/messaging/MessagingProvider.tsx:381)
- Ventas via RPC en Supabase: [flowsuitecrm/src/modules/ventas/VentasPage.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/modules/ventas/VentasPage.tsx:678)
- Casos de cartera via RPC en Supabase: [flowsuitecrm/src/modules/clientes/ClientesPage.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/modules/clientes/ClientesPage.tsx:1178)

Juicio:

- El CRM actual parece operar contra Supabase, no contra `api.flowiadigital.com`.
- Aun asi, eso no prueba por si solo que ninguna integracion externa siga usando el API legacy.

### 2. El API legacy conserva auth, imports y correo propios

Hallazgos en `api.flowiadigital.com`:

- Auth propia por Express/JWT y password reset propio.
- Imports por `multer` al directorio `./data`.
- Servicio SMTP/Nodemailer propio.
- Migraciones y scripts legacy expuestos.

Esto confirma que el API legacy no es solo un “cascaron”; todavia contiene capacidades operativas.

## Checklist maestro

## Fase A. Backup completo de cPanel/Stellar

Estado: pendiente

### A1. Backup de home completo

Checklist:

- Exportar `homedir` completo desde cPanel Backup Wizard.
- Confirmar tamaño del backup y fecha.
- Guardar copia fuera de Namecheap.
- Generar checksum local del archivo descargado.

Entregable:

- `cpanel-home-YYYYMMDD.tar.gz`
- `sha256.txt`

### A2. Backup de subdominios y docroots

Checklist:

- Confirmar docroot actual de:
  - `flowiadigital.com`
  - `www.flowiadigital.com`
  - `crm.flowiadigital.com`
  - `api.flowiadigital.com`
- Comprimir cada docroot por separado.
- Guardar inventario de archivos top-level.

Entregable:

- `public_html.tar.gz`
- `crm.flowiadigital.com.tar.gz`
- `api.flowiadigital.com.tar.gz`

### A3. Backup de backend legacy completo

Checklist:

- Respaldar todo lo visible en `api.flowiadigital.com`:
  - `src/`
  - `data/`
  - `scripts/`
  - `public/`
  - `tmp/`
  - `package.json`
  - `app.js`
  - `crm.db`
  - `.env` si existe
- Exportar logs de Node/LiteSpeed si existen.

Entregable:

- `api-legacy-full-backup.tar.gz`
- `api-legacy-file-manifest.txt`

### A4. Backup de configuracion operativa

Checklist:

- Guardar `.htaccess` de cada docroot.
- Guardar configuracion de Node.js app en cPanel.
- Guardar lista de subdominios.
- Guardar lista de cron jobs.
- Guardar lista de cuentas de correo, forwarders y routing.
- Guardar configuracion SSL/TLS que dependa de cPanel.

Entregable:

- `cpanel-config-snapshot.md`

## Fase B. Cerrar el riesgo publico de `api.flowiadigital.com`

Estado: pendiente critica

Objetivo: cerrar exposicion publica sin borrar todavia.

### B1. Desactivar directory listing

Cambio esperado:

- Agregar `Options -Indexes` en el docroot de `api.flowiadigital.com` o en su `.htaccess`.

Validacion:

- `GET /`
- `GET /src/`
- `GET /scripts/`
- `GET /src/services/`

Resultado esperado:

- `403` o ruta controlada.

### B2. Sacar codigo sensible del web root

Sin borrar todavia:

- Mover fuera del web root:
  - `src/`
  - `scripts/`
  - `data/`
  - `tmp/`
  - `crm.db`
  - `.env`
  - migraciones
- Dejar en el web root solo:
  - entrypoint publico necesario
  - assets publicos estrictamente requeridos

Si no se puede mover de inmediato:

- Bloquear acceso por `.htaccess` a:
  - `*.env`
  - `*.sql`
  - `*.db`
  - `*.log`
  - `/src`
  - `/scripts`
  - `/data`
  - `/tmp`

### B3. Verificar proceso real del API

Checklist:

- Confirmar si hay app Node activa en cPanel Application Manager.
- Confirmar puerto interno.
- Confirmar si hay reverse proxy o rewrite para `/api`.
- Confirmar por que `/api/health` devuelve `404`.

Juicio buscado:

- Saber si el backend esta caido, desconectado o solo mal enroutado.

### B4. Tomar snapshot antes y despues

Checklist:

- Captura de respuesta HTTP antes de mitigar.
- Captura de respuesta HTTP despues de mitigar.
- Guardar evidencia en el reporte.

## Fase C. Credenciales expuestas y rotacion

Estado: pendiente critica

### C1. Credenciales confirmadas como expuestas

Confirmado publicamente:

- Credenciales Postgres/Supabase pooler dentro de `api.flowiadigital.com/src/config/database.js`

Tambien hay riesgo local adicional en este workspace:

- `.env` local con service role
- scripts utilitarios con claves hardcodeadas o defaults inseguros

### C2. Orden de rotacion recomendado

1. Identificar todas las credenciales expuestas.
2. Crear nuevas credenciales y probarlas en entorno controlado.
3. Actualizar destinos vivos:
   - cPanel legacy
   - Supabase secrets
   - Vercel env vars
   - n8n o providers externos
4. Verificar conectividad.
5. Revocar credenciales viejas.

### C3. Matriz minima de credenciales a revisar

- Password de Postgres pooler de Supabase usado por el API legacy.
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_KEY`
- credenciales SMTP
- API keys de Resend
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `META_ACCESS_TOKEN` / `META_WHATSAPP_TOKEN`
- `META_PHONE_NUMBER_ID`
- `TELEGRAM_BOT_TOKEN`
- cualquier secreto en `.env`, `.env.local`, cPanel app config, n8n, Supabase Edge Function secrets y Vercel envs

### C4. Evidencia de que el stack moderno soporta esa rotacion

El frontend moderno usa `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, no service role en cliente:

- [flowsuitecrm/src/lib/supabase/client.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/lib/supabase/client.ts:3)

Las funciones server-side modernas usan secrets por entorno:

- [flowsuitecrm/supabase/functions/process-outbox/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/process-outbox/index.ts:60)
- [flowsuitecrm/supabase/functions/send-whatsapp/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/send-whatsapp/index.ts:10)

## Fase D. Confirmar dependencias reales de cPanel

Estado: pendiente

### D1. Cron jobs

No pude confirmarlos desde este workspace.

Checklist en cPanel:

- Exportar lista completa de cron jobs.
- Identificar:
  - scripts Node
  - scripts PHP
  - tareas de limpieza
  - tareas de correo
  - imports
  - backups
- Marcar cada job como:
  - activo critico
  - obsoleto
  - duplicado
  - migrable a Supabase/n8n/Render/Vercel Cron

### D2. Correo

No pude confirmarlo desde este workspace.

Checklist en cPanel:

- Listar Email Accounts.
- Listar Forwarders.
- Listar autoresponders.
- Confirmar Email Routing.
- Confirmar si existen buzones activos tipo:
  - `info@flowiadigital.com`
  - `ventas@flowiadigital.com`
  - `cobranza@flowiadigital.com`
  - `servicio@flowiadigital.com`
  - `referidos@flowiadigital.com`
  - `citas@flowiadigital.com`

Nota:

- Esos remitentes si existen en el stack moderno como aliases operativos de UI o mensajeria:
  - [flowsuitecrm/src/lib/emailSenders.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/lib/emailSenders.ts:14)

### D3. Scripts activos

Checklist en cPanel:

- Revisar Application Manager de Node.js.
- Revisar Passenger/Setup Node.js App si aplica.
- Revisar `stderr.log`, `stdout`, LiteSpeed logs.
- Revisar si `app.js` o `src/server.js` son el entrypoint real.
- Revisar webhooks entrantes.

## Fase E. DNS de `flowiadigital.com` y `www`

Estado: documentar primero, cambiar despues

### E1. Estado publico observado al 2026-06-11

- `flowiadigital.com`: sin resolucion publica observada
- `www.flowiadigital.com`: sin resolucion publica observada
- `crm.flowiadigital.com`: publico via Cloudflare -> Vercel
- `api.flowiadigital.com`: publico via Cloudflare -> cPanel/LiteSpeed

### E2. Lo que falta documentar antes de tocar DNS

Checklist en Cloudflare:

- Exportar todos los registros:
  - A
  - AAAA
  - CNAME
  - MX
  - TXT
  - SPF
  - DKIM
  - DMARC
- Guardar si estan proxied o DNS only.
- Guardar reglas de redirect.
- Guardar SSL/TLS mode.
- Guardar Page Rules / Redirect Rules / Transform Rules si existen.

### E3. Cambio objetivo futuro, pero no ahora

- `flowiadigital.com` -> Vercel
- `www.flowiadigital.com` -> Vercel o redirect al apex

Precondiciones:

- registros actuales documentados
- dominio agregado y verificado en Vercel
- pruebas en preview/alias listas

## Fase F. Plan de migracion del API legacy

Estado: preparar arquitectura

## Mapa funcional del API legacy

Funciones detectadas:

- auth propio
- reset password propio
- contactos
- clientes
- cuentas
- ordenes
- transacciones
- dashboard
- mensajes
- programas
- referrals
- pipeline
- imports por archivo
- SMTP/Nodemailer

## Clasificacion de migracion recomendada

### A. Migrar a Supabase directo

Apto para:

- CRUD de clientes, leads, contactos, usuarios, ventas y catalogos
- vistas, filtros y reportes que ya existen en SQL/RPC

### B. Migrar a Supabase Edge Functions

Apto para:

- create-user
- resend-invite
- send-email
- send-message-email
- send-whatsapp
- process-outbox
- dispatch-campaign

Nota:

- Gran parte ya existe en `flowsuitecrm/supabase/functions/`

### C. Migrar a Render/Railway/VPS solo si sigue siendo necesario

Apto para:

- imports pesados por archivo
- OCR
- procesos largos o stateful
- tareas que no encajen bien en Edge runtime

### D. Posiblemente eliminar

- auth legacy de Express si todo login real ya esta en Supabase Auth
- password reset legacy si todo reset real ya va por Supabase
- endpoints duplicados que ya tienen equivalente moderno

## Matriz de decision por dominio funcional

| Dominio funcional | Estado moderno | Accion sugerida |
|---|---|---|
| Login | Supabase Auth confirmado | Mantener moderno, retirar legacy despues de pruebas |
| Reset password | Supabase Auth confirmado | Mantener moderno, retirar legacy despues de pruebas |
| Mensajeria | Outbox + Edge Functions confirmado | Mantener moderno |
| Ventas | RPC Supabase confirmado | Mantener moderno |
| Cartera | RPC + tablas Supabase confirmado | Mantener moderno |
| Imports | No completamente confirmado | Evaluar Edge vs Render/Railway |
| SMTP legacy | Existe en API legacy | Migrar a Resend/servicio moderno |

## Checklist final antes de salir de Stellar

- Backup completo validado y probado.
- `api.flowiadigital.com` sin directory listing.
- Archivos sensibles fuera del web root o bloqueados.
- Credenciales nuevas creadas.
- Credenciales antiguas revocadas.
- Cron jobs documentados y clasificados.
- Correo documentado y proveedor final definido.
- DNS actual exportado.
- `flowiadigital.com` y `www` preparados para Vercel.
- Dependencias reales del API legacy confirmadas con pruebas.
- Plan de migracion del API legacy firmado.
- Smoke test completo:
  - CRM
  - login
  - reset password
  - leads
  - clientes
  - ventas/cotizaciones
  - mensajes
  - formularios
  - correo

## Bloqueadores actuales

- No hay acceso directo desde esta sesion a cPanel/SSH.
- No hay acceso directo desde esta sesion al dashboard de Cloudflare.
- No hay acceso directo desde esta sesion a variables de entorno de Vercel.
- No hay acceso directo desde esta sesion a correo alojado en cPanel.

## Proximo paso recomendado

Ejecutar una subfase `2A` solo de recoleccion controlada:

1. Entrar a cPanel y descargar backups.
2. Exportar inventario de cron jobs, correo y docroots.
3. Exportar DNS completo desde Cloudflare.
4. Confirmar App Manager / Node process real de `api.flowiadigital.com`.
5. Solo entonces ejecutar `2B` de mitigacion publica del API legacy.

