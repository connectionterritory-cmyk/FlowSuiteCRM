# Auditoria Tecnica Namecheap Stellar -> GitHub + Vercel + Supabase + Cloudflare

Fecha de auditoria: 2026-06-11

Estado del encargo: auditoria solamente. No se hicieron cambios en codigo, DNS, Vercel, Supabase, GitHub ni cPanel.

## Resumen ejecutivo

Hoy tienes dos arquitecturas coexistiendo:

1. Una arquitectura nueva basada en `FlowSuiteCRM` + `flowsuitecrm/` + Supabase + Vercel.
2. Una arquitectura legacy basada en `crm-flowia-legacy` desplegada en Namecheap/cPanel bajo `api.flowiadigital.com`, con Express sobre LiteSpeed.

Hallazgo mas importante:

- `crm.flowiadigital.com` esta vivo y sale desde Vercel.
- `api.flowiadigital.com` sigue dependiendo de cPanel/Stellar y ademas expone listado publico de archivos, codigo fuente y credenciales embebidas.
- `flowiadigital.com` y `www.flowiadigital.com` no resuelven publicamente al 2026-06-11.

Conclusión preliminar:

- No recomiendo cancelar Stellar todavia.
- Si hoy apagas Stellar, al menos `api.flowiadigital.com` se cae y puedes perder acceso operativo a archivos legacy que aun existen solo ahi.
- La direccion estrategica correcta si parece ser Vercel + Supabase + Cloudflare, pero primero hay que cerrar la dependencia del API legacy, respaldar cPanel completo y corregir los riesgos de seguridad.

## Nivel de confianza y limites

Hallazgos confirmados con evidencia directa:

- Repo local actual.
- Conexion GitHub del repo principal.
- Vercel link local del proyecto `flowsuitecrm`.
- Estado remoto de migraciones Supabase.
- Respuesta publica de `crm.flowiadigital.com`, `api.flowiadigital.com`, `flowiadigital.com` y `www.flowiadigital.com`.
- DNS publico visible via resolucion externa.

No confirmado porque no hubo acceso directo al dashboard o filesystem remoto:

- Contenido interno de `public_html`, `CRM-Flowia-Backend`, `FlowSuiteCore`, `nodevenv`, `mail`, `ssl`, `logs`.
- Variables de entorno de Vercel.
- Jobs cron reales de cPanel.
- Cuentas de correo y routing dentro de cPanel.
- Registros privados/ocultos que solo se ven dentro de Cloudflare.

## Tabla de hallazgos

| Prioridad | Hallazgo | Estado |
|---|---|---|
| Alta | `api.flowiadigital.com` sigue en cPanel/Stellar | Confirmado |
| Alta | `api.flowiadigital.com` expone directory listing publico | Confirmado |
| Alta | Codigo y credenciales del backend legacy son publicamente accesibles | Confirmado |
| Alta | `flowiadigital.com` no resuelve publicamente | Confirmado |
| Alta | `www.flowiadigital.com` no resuelve publicamente | Confirmado |
| Alta | `crm.flowiadigital.com` esta saliendo por Vercel | Confirmado |
| Alta | Supabase ya reemplaza gran parte del backend actual | Confirmado |
| Media | Hay drift entre migraciones remotas y el repo local | Confirmado |
| Media | El repo raiz `supabase/` parece legacy o paralelo al `flowsuitecrm/supabase/` | Confirmado |
| Media | `crm-flowia-legacy` sigue siendo relevante por su despliegue en cPanel | Confirmado |
| Baja | `FlowSuiteCRM-Legacy` ya esta archivado | Confirmado |

## 1. Inventario actual

### Dominios y subdominios observados publicamente

- `flowiadigital.com`: no resuelve publicamente al 2026-06-11.
- `www.flowiadigital.com`: no resuelve publicamente al 2026-06-11.
- `crm.flowiadigital.com`: resuelve por Cloudflare y sirve una SPA de `FlowSuiteCRM` con headers de Vercel.
- `api.flowiadigital.com`: resuelve por Cloudflare pero responde con LiteSpeed/cPanel y un autoindex publico.

### Inventario local del repo auditado

Directorios relevantes encontrados en este workspace:

- `flowsuitecrm/`: app React + TypeScript + Vite, con `vercel.json`, `.vercel/project.json`, `supabase/`, `src/`, `public/`.
- `frontend/`: app React + Vite mas antigua o paralela.
- `supabase/`: carpeta de migraciones legacy/paralela en la raiz.
- `evolution-api/`: proyecto aparte relacionado con mensajeria/WhatsApp.
- `tools/`, `scripts/`, `docs/`: utilidades y documentacion.

### Frameworks detectados

- `flowsuitecrm/`: React 19 + TypeScript + Vite.
- `frontend/`: React 19 + Vite.
- `crm-flowia-legacy`: frontend React + Vite; backend Node.js + Express.
- Supabase: Postgres + Auth + Edge Functions + Storage + RLS.
- No encontre evidencia local de Next.js ni WordPress para la app actual.
- En el host publico `api.flowiadigital.com` si hay Node.js/Express legacy sobre LiteSpeed.

### Sobre las carpetas de cPanel mencionadas

No se pudieron abrir directamente porque no hubo acceso SSH/cPanel al hosting. Lo que si puede afirmarse:

- `crm.flowiadigital.com` ya no parece depender de una carpeta local de cPanel para servir la app actual; hoy responde como despliegue de Vercel.
- `api.flowiadigital.com` si depende de cPanel/Stellar y actualmente expone una estructura compatible con un proyecto Node/Express legacy:
  - `/src/`
  - `/src/config/`
  - `/src/routes/`
  - `/data/`
  - `/scripts/`
  - `package.json`
  - `app.js`
  - `crm.db`

## 2. Dependencias reales de cPanel/Stellar

### Pagina web principal

- Estado actual: no resolviendo publicamente.
- Dependencia de Stellar: indeterminada desde el repo, pero operativamente hoy el apex no esta bien publicado.

### CRM

- `crm.flowiadigital.com` hoy depende de Vercel, no de cPanel, para el frontend publicado.
- Evidencia: respuesta HTTP con `x-vercel-id`, `x-vercel-cache` y bundle de Vite.

### API / backend

- `api.flowiadigital.com` si depende de cPanel/Stellar.
- Ademas hoy no parece estar sirviendo la API activa: `/api/health` devolvio `404` el 2026-06-11.
- Eso sugiere que el subdominio esta apuntando al filesystem legacy, pero el proceso Node o la reescritura/proxy del app server no esta funcionando como API publica.

### Correos

- No hay evidencia publica de MX/TXT en el apex al momento de la consulta externa.
- No se puede confirmar si el correo activo depende de cPanel sin entrar al dashboard de Cloudflare/cPanel.

### SSL

- `crm.flowiadigital.com` y `api.flowiadigital.com` responden por HTTPS detras de Cloudflare.
- `flowiadigital.com` y `www.flowiadigital.com` no resuelven, asi que el problema principal hoy no es SSL sino DNS.

### Base de datos

- La base de datos principal ya depende de Supabase, no de MySQL/cPanel.
- Evidencia:
  - el frontend actual consume `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
  - el backend legacy publico usa `pg` y conecta al pooler de Supabase
  - la plataforma actual tiene 10 Edge Functions y 197 migraciones locales en `flowsuitecrm/supabase/migrations`

### Cron jobs

- No confirmados dentro de cPanel.
- Pero si hay funciones y flujos que sugieren tareas programadas u outbox workers en Supabase/n8n:
  - `process-outbox`
  - `dispatch-outbox-n8n`
  - `dfp-daily-cuota-notifications`

### Redirecciones

- En Vercel, `flowsuitecrm/vercel.json` hace rewrite global a `/index.html` para SPA.
- En cPanel no se pudieron auditar reglas `.htaccess` ni redirects.

### Archivos publicos

- `api.flowiadigital.com` sigue sirviendo archivos publicos desde cPanel.
- `crm.flowiadigital.com` sirve estaticos desde Vercel.

### Procesos Node.js

- El backend legacy si requiere proceso persistente si pretendes usar Express en modo tradicional.
- Las Edge Functions de Supabase no requieren proceso Node persistente.

## 3. Backend / API

### Estado del backend legacy expuesto

`api.flowiadigital.com` coincide materialmente con `connectionterritory-cmyk/crm-flowia-legacy`.

Elementos confirmados en el host publico:

- `package.json`: si
- `app.js`: si
- `src/`: si
- `routes/`: si
- `middleware/`: si
- `config/database.js`: si
- `scripts/`: si
- `data/`: si
- `crm.db`: si

### Tecnologias del backend legacy

- Node.js
- Express
- `pg`
- `sqlite3`
- `jsonwebtoken`
- `nodemailer`
- `multer`
- `tesseract.js`

### Conectividad real

El backend legacy publico ya no apunta a una DB local principal; usa Supabase Postgres por pooler:

- host de Supabase pooler
- usuario `postgres.<project-ref>`
- puerto `6543`

Tambien existe un archivo `crm.db` visible en el host, lo que indica que aun quedan artefactos SQLite legacy en el filesystem.

### Puede migrarse?

Si, pero no de una sola forma:

- CRUD simple y autenticacion: mejor moverlos al frontend + Supabase directo con RLS.
- Procesos de mensajeria, correo, bots, outbox y dispatch: mejor en Supabase Edge Functions.
- OCR pesado o tareas largas: si realmente siguen en uso, considerar Render/Railway/VPS o una cola separada.
- El backend legacy completo de Express no parece la arquitectura objetivo a mantener.

### Juicio de necesidad

- No parece ser el backend objetivo de largo plazo.
- Pero aun no debe borrarse sin una verificacion funcional, porque hoy sigue representando la unica pieza conocida de `api.flowiadigital.com`.

## 4. Frontend / CRM

### CRM actual desplegable en Vercel

Si. De hecho ya hay evidencia de despliegue activo desde Vercel.

### Framework usado

- React + TypeScript + Vite

### Build

- Comando: `npm run build`
- Script real: `NODE_OPTIONS=--max-old-space-size=4096 tsc -b && vite build`
- Salida: `dist/`

### Variables de entorno requeridas

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Rutas protegidas

- Login y reset de password son publicos.
- El resto del CRM pasa por `ProtectedRoute` y depende de sesion Supabase.

### Conexion con Supabase

- Directa desde cliente web.
- El CRM consulta tablas, vistas, RPCs, realtime y storage desde el frontend.

### Riesgos de CORS / auth

- Las Edge Functions tienen listas de `ALLOWED_ORIGINS` que incluyen `https://flowiadigital.com`, `https://crm.flowiadigital.com`, staging de Vercel y localhost.
- Si cambias el dominio final, debes alinear esas listas antes del corte.

## 5. Supabase

### Uso actual de Supabase

Supabase ya es pieza central del sistema:

- Base de datos Postgres
- Auth
- RLS
- Storage
- Edge Functions
- RPCs
- Triggers

### Evidencia cuantitativa local

- 197 archivos de migracion en `flowsuitecrm/supabase/migrations`
- 10 directorios de Edge Functions en `flowsuitecrm/supabase/functions`
- 268 ocurrencias de `create policy`
- 84 ocurrencias de `enable row level security`
- 40 ocurrencias de `create trigger`
- 76 ocurrencias de `create function` o `create or replace function`

### Edge Functions detectadas

- `process-outbox`
- `send-whatsapp`
- `bot-telegram`
- `dispatch-campaign`
- `create-user`
- `send-email`
- `resend-invite`
- `send-message-email`
- `dispatch-outbox-n8n`
- `dfp-daily-cuota-notifications`

### Drift entre repo y remoto

Hay desalineacion entre migraciones locales y remotas:

- En `flowsuitecrm/`, varias migraciones locales no aparecen aplicadas en remoto.
- Tambien existen migraciones remotas sin contraparte local reciente.
- En la raiz del repo, la carpeta `supabase/` esta claramente desfasada frente al proyecto vivo de `flowsuitecrm/supabase/`.

Esto no bloquea una migracion fuera de Stellar, pero si bloquea una limpieza segura sin reconciliar el source of truth.

### Conclusión

Si: Supabase ya reemplaza gran parte del backend actual.

## 6. GitHub

### Repositorios encontrados

- `connectionterritory-cmyk/FlowSuiteCRM`
- `connectionterritory-cmyk/crm-flowia-legacy`
- `connectionterritory-cmyk/FlowSuiteCRM-Legacy`
- `connectionterritory-cmyk/izzyfbservices`
- `connectionterritory-cmyk/izzyphone`
- `connectionterritory-cmyk/izzy-pnc-cram-trainer`

### Cual parece ser el repo principal actual

- `FlowSuiteCRM`

Motivos:

- Este workspace esta conectado a ese origen.
- Tiene el app `flowsuitecrm/` enlazado con Vercel.
- Su arquitectura coincide con el CRM moderno basado en Supabase.

### Cuales son legacy / respaldo

- `crm-flowia-legacy`: legacy pero aun importante, porque coincide con el backend expuesto en `api.flowiadigital.com`.
- `FlowSuiteCRM-Legacy`: ya archivado.

### Cuales conviene archivar luego

- `FlowSuiteCRM-Legacy`: ya archivado.
- `crm-flowia-legacy`: no archivarlo aun hasta completar migracion y backup, pero si clasificarlo como legacy activo.
- Los repos `izzy*` no parecen parte del despliegue principal auditado, salvo evidencia futura en cPanel.

### GitHub vs cPanel

Conclusiones razonables:

- `crm-flowia-legacy` si esta alineado con lo que vive en `api.flowiadigital.com`; los archivos expuestos son practicamente equivalentes.
- `FlowSuiteCRM` representa la app moderna que ya esta en `crm.flowiadigital.com`.
- No hay evidencia de que todo lo que esta en cPanel exista ya migrado al repo moderno.

## 7. Vercel

### Confirmado

- `flowsuitecrm/.vercel/project.json` apunta al proyecto Vercel `flowsuitecrm`.
- `crm.flowiadigital.com` sirve bundle con headers de Vercel.
- El frontend actual parece listo para operar desde Vercel como SPA.

### No confirmado por falta de acceso directo al dashboard/API de Vercel

- Variables de entorno actualmente configuradas.
- Lista de deployments activos.
- Historial de errores de build.
- Dominios adicionales asignados dentro del dashboard.

### Evaluacion por dominio

- `crm.flowiadigital.com`: si esta conectado correctamente a Vercel hoy.
- `api.flowiadigital.com`: no esta en Vercel; sigue en cPanel/LiteSpeed.
- `flowiadigital.com`: no parece estar conectado publicamente.
- `www.flowiadigital.com`: no parece estar conectado publicamente.

## 8. Cloudflare / DNS

### Nameservers detectados

- `fonzie.ns.cloudflare.com`
- `teagan.ns.cloudflare.com`

### DNS publico observado el 2026-06-11

- `crm.flowiadigital.com`:
  - A `172.67.168.187`
  - A `104.21.70.230`
  - AAAA `2606:4700:3032::ac43:a8bb`
  - AAAA `2606:4700:3034::6815:46e6`

- `api.flowiadigital.com`:
  - A `104.21.70.230`
  - A `172.67.168.187`

- `flowiadigital.com`:
  - sin respuesta publica A
  - sin respuesta publica MX
  - sin respuesta publica TXT

- `www.flowiadigital.com`:
  - no resuelve publicamente

### Interpretacion

- `crm` y `api` pasan por Cloudflare proxy.
- El apex y `www` estan rotos o no publicados.
- No pude verificar desde fuera SPF, DKIM, DMARC ni redirects porque no aparecieron TXT/MX publicos y no hubo acceso al dashboard.

### Recomendacion objetivo de DNS

- `crm.flowiadigital.com` -> Vercel
- `flowiadigital.com` -> Vercel si la web principal va a vivir ahi
- `www.flowiadigital.com` -> CNAME a dominio primario web o manejo de redirect en Vercel/Cloudflare
- `api.flowiadigital.com` -> solo mantenerlo mientras exista backend real; luego migrar o eliminar
- MX/TXT -> al proveedor final de email, no a cPanel si ya no vas a usar correo alli

## 9. Email

### Confirmacion actual

No pude confirmar uso de correo en cPanel.

### Señales publicas

- No aparecieron MX visibles publicos para `flowiadigital.com` en la consulta externa.
- Eso no es compatible con un correo de dominio operativo normal, salvo que el correo este roto o pendiente de publicacion.

### Recomendacion

Orden sugerido:

1. Google Workspace si el correo es critico y quieres administracion simple.
2. Zoho Mail si quieres menor costo con correo empresarial.
3. Cloudflare Email Routing si solo necesitas aliases/forwarding y no buzones completos.
4. Namecheap Private Email solo si quieres mantener parte de la dependencia en Namecheap.

Mi recomendacion general:

- No dejar correo critico en cPanel si tu objetivo es salir de Stellar.

## 10. Riesgos antes de cancelar Stellar

### Que dejaria de funcionar

- `api.flowiadigital.com` casi seguro.
- Cualquier archivo, script o proceso legacy que siga viviendo solo en cPanel.
- Cualquier correo alojado en cPanel, si existe.
- Cualquier cron job de cPanel, si existe.

### Que podrias perder

- Codigo legacy no versionado fuera de cPanel.
- `.env` legacy.
- SQLite DBs o archivos locales como `crm.db`.
- Logs utiles para reconstruir integraciones.
- Certificados, redirecciones o reglas de Apache/LiteSpeed no documentadas.

### Que debe respaldarse antes

- Backup completo de cPanel home.
- Backup completo de bases de datos y archivos.
- `.env`, `.htaccess`, Node app configs, cron jobs y logs.
- Descarga completa de `api.flowiadigital.com` filesystem legacy.
- Export de DNS en Cloudflare.
- Export de variables de entorno de Vercel.

## 11. Plan de migracion recomendado

### Fase 1. Backup completo de cPanel

- Descargar home completo.
- Exportar cualquier DB local.
- Guardar `.env`, `.htaccess`, configs de Node y cron.

### Fase 2. Identificar app activa

- Confirmar con pruebas funcionales si algun usuario o integracion aun consume `api.flowiadigital.com`.
- Revisar si el backend legacy realmente participa en login, imports, dashboards o mensajeria.

### Fase 3. Comparar cPanel vs GitHub

- Comparar `api.flowiadigital.com` contra `crm-flowia-legacy`.
- Comparar `crm.flowiadigital.com` contra `FlowSuiteCRM/flowsuitecrm`.
- Documentar cualquier delta solo-existe-en-cPanel.

### Fase 4. Migrar frontend a Vercel de forma completa

- Mantener `crm.flowiadigital.com` en Vercel.
- Corregir `flowiadigital.com` y `www.flowiadigital.com` para que resuelvan publicamente.

### Fase 5. Migrar backend

- Mover lo que aun sirva del backend legacy a:
  - Supabase directo si es CRUD con RLS
  - Supabase Edge Functions si son acciones de servidor
  - Render/Railway/VPS solo si queda trabajo stateful o pesado que no cabe en Edge

### Fase 6. Configurar DNS en Cloudflare

- Apex y `www` hacia Vercel.
- `crm` mantenerlo en Vercel.
- `api` moverlo solo cuando exista reemplazo funcional.

### Fase 7. Probar

- Dominio apex
- `www`
- `crm`
- login
- reset password
- mensajeria
- imports
- formularios
- cualquier webhook o bot

### Fase 8. Apagar Stellar solo despues de pruebas

- Apagar primero en ventana controlada.
- Monitorear 24-72 horas.

### Fase 9. Cancelar o no renovar

- Cancelar solo cuando:
  - `api.flowiadigital.com` ya no dependa de cPanel
  - correo ya no dependa de cPanel
  - backups ya esten validados
  - DNS final ya este estable

## 12. Entregable final

### Que debes conservar

- `FlowSuiteCRM`
- `flowsuitecrm/`
- `flowsuitecrm/supabase/`
- proyecto Vercel `flowsuitecrm`
- proyecto Supabase actual
- `crm-flowia-legacy` hasta terminar migracion

### Que debes migrar

- `api.flowiadigital.com`
- cualquier cron/integracion que viva en cPanel
- cualquier correo aun alojado en cPanel
- apex `flowiadigital.com` y `www`

### Que puedes borrar despues, no antes

- `FlowSuiteCRM-Legacy` ya esta archivado
- archivos cPanel legacy despues de backup, comparacion y pruebas
- dependencias antiguas duplicadas como SQLite local si ya no cumplen ninguna funcion

### Que debes respaldar

- cPanel completo
- backend legacy completo
- archivos `crm.db`, `data/`, `scripts/`, `src/`
- DNS Cloudflare
- env vars de Vercel
- secretos y configuracion de proveedores

### Que herramienta falta

- Acceso directo a:
  - cPanel o SSH del hosting
  - dashboard de Cloudflare
  - dashboard/API de Vercel
  - dashboard de Supabase para revisar Auth, Storage, Edge Function secrets y backups

### Necesitas renovar Stellar o no

- Recomendacion actual: si, por ahora.
- Motivo: aun existe dependencia confirmada de `api.flowiadigital.com` sobre cPanel/Stellar y no hay evidencia de reemplazo completo ya en produccion.

### Arquitectura ideal recomendada

- `flowiadigital.com` y `www.flowiadigital.com` -> Vercel
- `crm.flowiadigital.com` -> Vercel
- Datos, auth, storage, RPC, realtime -> Supabase
- Acciones server-side -> Supabase Edge Functions
- DNS y TLS -> Cloudflare
- Email -> Google Workspace o Zoho
- Eliminar Express legacy en cPanel salvo que sobreviva una necesidad tecnica real muy puntual

## Riesgos concretos de seguridad encontrados

### Riesgo 1. Exposicion publica del backend legacy

`api.flowiadigital.com` muestra directory listing publico con estructura interna del proyecto.

### Riesgo 2. Exposicion publica de credenciales

El archivo publico `src/config/database.js` contiene credenciales de conexion a Supabase/Postgres embebidas en codigo servido publicamente. Deben rotarse.

### Riesgo 3. Artefactos legacy visibles

El archivo `crm.db` es visible desde internet. Aunque no sea la DB principal, no deberia estar expuesto.

### Riesgo 4. Dominio principal roto

`flowiadigital.com` y `www.flowiadigital.com` no resuelven, lo que hoy rompe la presencia principal de marca y puede afectar redirecciones, correo y login flows.

## Proximos pasos concretos

1. No cancelar Stellar todavia.
2. Hacer backup completo de cPanel antes de tocar nada.
3. Corregir de inmediato el riesgo de `api.flowiadigital.com`:
   - desactivar autoindex
   - sacar codigo fuente del web root
   - rotar credenciales expuestas
4. Confirmar si alguien usa realmente `api.flowiadigital.com`.
5. Reconciliar `flowsuitecrm/supabase` contra el remoto y declarar el source of truth.
6. Revisar Cloudflare para restaurar `flowiadigital.com` y `www`.
7. Definir proveedor final de email fuera de cPanel.
8. Solo despues ejecutar migracion final fuera de Stellar.

## Evidencia principal usada

- Repo local: [package.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/package.json), [flowsuitecrm/package.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/package.json), [flowsuitecrm/vercel.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/vercel.json), [flowsuitecrm/.vercel/project.json](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/.vercel/project.json), [flowsuitecrm/src/app/App.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/App.tsx:60), [flowsuitecrm/src/lib/supabase/client.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/lib/supabase/client.ts:1), [flowsuitecrm/supabase/functions/process-outbox/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/process-outbox/index.ts:60), [flowsuitecrm/supabase/functions/send-whatsapp/index.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/supabase/functions/send-whatsapp/index.ts:10)
- GitHub: `connectionterritory-cmyk/FlowSuiteCRM`, `connectionterritory-cmyk/crm-flowia-legacy`, `connectionterritory-cmyk/FlowSuiteCRM-Legacy`
- Publico: `https://crm.flowiadigital.com`, `https://api.flowiadigital.com`

## Nota final

No hagas cambios todavia. Primero audita por dashboard/SSH lo faltante, documenta, respalda y pide aprobacion antes de borrar, migrar o modificar DNS.
