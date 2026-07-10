# Fase 2A Runbook de Recoleccion Controlada

Fecha: 2026-06-11

Objetivo: recopilar toda la informacion necesaria de cPanel, Cloudflare, Vercel y Supabase antes de cerrar o migrar `api.flowiadigital.com`.

## Reglas

- No borrar archivos.
- No cambiar DNS.
- No cancelar Stellar.
- No mover produccion.
- No rotar credenciales todavia, solo identificarlas y preparar la rotacion.
- Tomar capturas antes de cualquier mitigacion.

## Evidencia base ya confirmada

- `crm.flowiadigital.com` responde desde Vercel.
- `api.flowiadigital.com` expone directory listing publico desde cPanel/LiteSpeed.
- El CRM moderno usa Supabase y Edge Functions, no referencias directas a `api.flowiadigital.com`.

## Paso 1. Backup completo en cPanel

Ruta:

- Namecheap -> Hosting -> `flowiadigital.com` -> Go to cPanel
- Files -> Backup Wizard

Acciones:

1. Descargar backup completo de Home Directory.
2. Guardar el archivo fuera de Namecheap.
3. Anotar:
   - nombre del archivo
   - fecha
   - tamano
   - ubicacion donde se guardo

Entregables:

- `cpanel-home-2026-06-11.tar.gz`
- captura del backup descargado

Campos a llenar:

| Campo | Valor |
|---|---|
| Nombre archivo | |
| Fecha backup | |
| Tamano | |
| Ubicacion almacenada | |
| Captura guardada | |

## Paso 2. Backup manual de carpetas importantes

Ruta:

- cPanel -> File Manager

Carpetas a revisar y comprimir por separado:

- `public_html`
- `crm.flowiadigital.com`
- `api.flowiadigital.com`
- `CRM-Flowia-Backend`
- `FlowSuiteCore`
- `nodevenv`
- `logs`
- `mail`, si existe contenido importante

Acciones por carpeta:

1. Click derecho -> Compress
2. Crear archivo `.tar.gz` o `.zip`
3. Descargar
4. Anotar tamano y fecha

Entregables:

- `public_html.tar.gz`
- `crm-docroot.tar.gz`
- `api-docroot.tar.gz`
- `CRM-Flowia-Backend.tar.gz`
- `FlowSuiteCore.tar.gz`
- `nodevenv.tar.gz`
- `logs.tar.gz`

Tabla de control:

| Carpeta | Archivo backup | Fecha | Tamano | Descargado | Notas |
|---|---|---|---|---|---|
| public_html | | | | | |
| crm.flowiadigital.com | | | | | |
| api.flowiadigital.com | | | | | |
| CRM-Flowia-Backend | | | | | |
| FlowSuiteCore | | | | | |
| nodevenv | | | | | |
| logs | | | | | |
| mail | | | | | |

## Paso 3. Inventario de docroots

Ruta:

- cPanel -> Domains -> Domains

Documentar:

- Dominio
- Subdominio
- Document root
- Si esta redirigido o no
- Si tiene Force HTTPS Redirect activo

Registrar:

- `flowiadigital.com`
- `www.flowiadigital.com`
- `crm.flowiadigital.com`
- `api.flowiadigital.com`

Entregables:

- `cpanel-domains-docroots.md`
- captura de pantalla de la tabla de dominios

Tabla de inventario:

| Dominio | Tipo | Document root | Redirect | Force HTTPS | Notas |
|---|---|---|---|---|---|
| flowiadigital.com | | | | | |
| www.flowiadigital.com | | | | | |
| crm.flowiadigital.com | | | | | |
| api.flowiadigital.com | | | | | |

## Paso 4. Revisar Node.js App o Application Manager

Buscar en cPanel:

- Setup Node.js App
- Node.js Selector
- Application Manager
- Passenger Apps

Revisar si existe app para:

- `api.flowiadigital.com`
- `CRM-Flowia-Backend`
- `FlowSuiteCore`

Documentar:

- Application root
- Application URL
- Startup file
- Node version
- Environment mode
- Variables de entorno visibles
- Estado: running o stopped
- Boton restart disponible
- Logs disponibles

No reiniciar todavia.

Entregables:

- `cpanel-node-app-snapshot.md`
- capturas de la configuracion Node

Tabla de snapshot:

| App | Application root | URL | Startup file | Node version | Env mode | Estado | Restart | Logs | Notas |
|---|---|---|---|---|---|---|---|---|---|
| api.flowiadigital.com | | | | | | | | | |
| CRM-Flowia-Backend | | | | | | | | | |
| FlowSuiteCore | | | | | | | | | |

## Paso 5. Logs del API legacy

Buscar en cPanel o File Manager:

- `stderr.log`
- `stdout.log`
- `passenger.log`
- `error_log`
- logs dentro de `logs`
- logs dentro de `api.flowiadigital.com`
- logs dentro de `CRM-Flowia-Backend`

Acciones:

- Descargar o copiar los ultimos errores.
- Registrar fecha, archivo y error visible.

Entregable:

- `api-legacy-logs-2026-06-11.md`

Tabla de logs:

| Archivo | Ruta | Ultima fecha | Error o mensaje clave | Severidad | Notas |
|---|---|---|---|---|---|
| | | | | | |

## Paso 6. Cron jobs

Ruta:

- cPanel -> Advanced -> Cron Jobs

Documentar cada cron job:

- Comando
- Frecuencia
- Ruta de script
- Usuario
- Si parece activo o legacy
- Si usa Node, PHP, curl, wget o scripts internos

No eliminar nada.

Clasificacion:

- Critico
- Posiblemente activo
- Legacy
- Desconocido

Entregable:

- `cpanel-cron-inventory.md`

Tabla de inventario:

| Frecuencia | Comando | Ruta script | Tipo | Clasificacion | Riesgo si se apaga | Notas |
|---|---|---|---|---|---|---|
| | | | | | | |

## Paso 7. Correo en cPanel

Revisar en cPanel:

- Email Accounts
- Forwarders
- Email Routing
- Autoresponders
- Default Address

Buscar correos como:

- `info@flowiadigital.com`
- `ventas@flowiadigital.com`
- `cobranza@flowiadigital.com`
- `servicio@flowiadigital.com`
- `referidos@flowiadigital.com`
- `citas@flowiadigital.com`

Entregables:

- `cpanel-email-inventory.md`
- capturas de Email Accounts, Forwarders y Email Routing

Tablas:

### Email Accounts

| Cuenta | Existe | Tipo de uso | Observaciones |
|---|---|---|---|
| info@flowiadigital.com | | | |
| ventas@flowiadigital.com | | | |
| cobranza@flowiadigital.com | | | |
| servicio@flowiadigital.com | | | |
| referidos@flowiadigital.com | | | |
| citas@flowiadigital.com | | | |

### Forwarders y routing

| Tipo | Configuracion | Estado | Notas |
|---|---|---|---|
| Forwarders | | | |
| Email Routing | | | |
| Autoresponders | | | |
| Default Address | | | |

## Paso 8. Snapshot publico de `api.flowiadigital.com`

Abrir en navegador antes de tocar nada:

- `https://api.flowiadigital.com/`
- `https://api.flowiadigital.com/src/`
- `https://api.flowiadigital.com/scripts/`
- `https://api.flowiadigital.com/data/`
- `https://api.flowiadigital.com/src/config/`
- `https://api.flowiadigital.com/api/health`

Tomar captura de:

- status visible
- directory listing
- 404, 403 o 200
- cualquier archivo expuesto

Entregables:

- `api-public-exposure-before.md`
- carpeta de capturas

Tabla de evidencia:

| URL | HTTP esperado | HTTP observado | Exposicion | Captura guardada | Notas |
|---|---|---|---|---|---|
| https://api.flowiadigital.com/ | | | | | |
| https://api.flowiadigital.com/src/ | | | | | |
| https://api.flowiadigital.com/scripts/ | | | | | |
| https://api.flowiadigital.com/data/ | | | | | |
| https://api.flowiadigital.com/src/config/ | | | | | |
| https://api.flowiadigital.com/api/health | | | | | |

## Paso 9. Inventario de credenciales expuestas

Buscar dentro de backups o File Manager:

- `.env`
- `.env.local`
- `.env.production`
- `database.js`
- `config.js`
- `supabase.js`
- `email.js`
- referencias a `smtp`
- referencias a `nodemailer`
- `service_role`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_KEY`
- `POSTGRES`
- `DATABASE_URL`
- `META_ACCESS_TOKEN`
- `EVOLUTION_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `RESEND_API_KEY`

Reglas:

- No pegarlas en chats publicos.
- No subirlas a GitHub.
- No compartirlas completas.

Entregable:

- `secrets-inventory-redacted.md`

Formato:

| Nombre del secreto | Archivo donde aparece | Sistema donde se usa | Riesgo | Accion sugerida |
|---|---|---|---|---|
| | | | | rotar / eliminar / mover a env var |

## Paso 10. Exportar DNS de Cloudflare

Ruta:

- Cloudflare -> `flowiadigital.com` -> DNS -> Records

Documentar todos los registros:

- A
- AAAA
- CNAME
- MX
- TXT
- SPF
- DKIM
- DMARC

Para cada registro:

- Type
- Name
- Content
- Proxy status
- TTL
- Comentario

Tambien revisar:

- SSL/TLS mode
- Page Rules
- Redirect Rules
- Transform Rules
- Workers Routes, si existen

No cambiar nada todavia.

Entregables:

- `cloudflare-dns-export-2026-06-11.md`
- capturas de DNS

Tabla base:

| Type | Name | Content | Proxy status | TTL | Comentario | Notas |
|---|---|---|---|---|---|---|
| | | | | | | |

Checklist adicional:

- SSL/TLS mode: _____
- Page Rules documentadas: si / no
- Redirect Rules documentadas: si / no
- Transform Rules documentadas: si / no
- Workers Routes documentadas: si / no

## Paso 11. Vercel snapshot

Ruta:

- Vercel -> proyecto `flowsuitecrm` -> Settings

Documentar:

### Domains

- `crm.flowiadigital.com`
- `flowiadigital.com`
- `www.flowiadigital.com`, si existen

### Environment Variables

Solo nombres, no valores completos.

Confirmar si existen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Deployments

- ultimo deployment de produccion
- estado
- fecha
- branch conectada

Entregable:

- `vercel-snapshot-2026-06-11.md`

Tablas:

### Domains

| Dominio | Existe en Vercel | Estado | Proyecto | Notas |
|---|---|---|---|---|
| crm.flowiadigital.com | | | | |
| flowiadigital.com | | | | |
| www.flowiadigital.com | | | | |

### Environment Variables

| Variable | Existe | Ambiente | Notas |
|---|---|---|---|
| VITE_SUPABASE_URL | | | |
| VITE_SUPABASE_ANON_KEY | | | |

### Deployments

| Fecha | Estado | Branch | Commit | Notas |
|---|---|---|---|---|
| | | | | |

## Paso 12. Supabase snapshot

Ruta:

- Supabase -> proyecto actual

Documentar:

### Project Settings

- Project URL
- API keys existentes, sin copiarlas completas
- si hay keys que deben rotarse

### Authentication

- Site URL
- Redirect URLs
- Providers activos

### Edge Functions

- lista de funciones
- secrets configurados, solo nombres
- ultimo deploy si aparece

### Database

- backups disponibles
- estado de RLS
- logs recientes

### Storage

- buckets existentes
- cuales son publicos o privados

Entregable:

- `supabase-snapshot-2026-06-11.md`

Tablas:

### Project settings

| Campo | Valor |
|---|---|
| Project URL | |
| Keys a revisar | |
| Requieren rotacion | |

### Auth

| Campo | Valor |
|---|---|
| Site URL | |
| Redirect URLs | |
| Providers activos | |

### Edge Functions

| Funcion | Deploy visible | Secrets asociados | Notas |
|---|---|---|---|
| | | | |

### Storage

| Bucket | Publico o privado | Uso | Notas |
|---|---|---|---|
| | | | |

## Paso 13. Reporte final de Fase 2A

Crear archivo:

- `docs/AUDIT/stellar-phase2A-collection-report-2026-06-11.md`

Debe incluir:

1. Resumen ejecutivo
2. Que se respaldo
3. Que sigue dependiendo de cPanel
4. Que cron jobs existen
5. Que correo existe
6. Que app Node existe
7. Que archivos expuestos encontro `api.flowiadigital.com`
8. Que credenciales deben rotarse
9. Que DNS existe en Cloudflare
10. Que dominios estan en Vercel
11. Que falta confirmar
12. Recomendacion para Fase 2B

## Criterio para pasar a Fase 2B

- Backup completo descargado
- Cron jobs documentados
- Email documentado
- DNS exportado
- Node App documentada
- Credenciales sensibles inventariadas
- Evidencia del directory listing guardada

## Estado de avance

Marca cada bloque al completar:

- [ ] Paso 1 completo
- [ ] Paso 2 completo
- [ ] Paso 3 completo
- [ ] Paso 4 completo
- [ ] Paso 5 completo
- [ ] Paso 6 completo
- [ ] Paso 7 completo
- [ ] Paso 8 completo
- [ ] Paso 9 completo
- [ ] Paso 10 completo
- [ ] Paso 11 completo
- [ ] Paso 12 completo
- [ ] Paso 13 completo

