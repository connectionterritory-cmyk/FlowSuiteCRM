# Informe de Auditoría Adicional - FlowSuiteCRM

**Fecha:** 6 de Abril 2026  
**Alcance:** Evolution API, Supabase Edge Functions, Docker, Integración WhatsApp

---

## 1. Estado Actual del Sistema

### 1.1 Evolution API (Docker Local)
| Componente | Estado | Versión |
|------------|--------|---------|
| API | ✅ Operativo | v2.3.7 |
| Frontend | ✅ Operativo | v2.0.0 |
| Redis | ✅ Operativo | latest |
| PostgreSQL | ✅ Operativo | postgres:15 |

**Puerto expuesta:** 8080

### 1.2 Instancia WhatsApp
- **Nombre:** flowsuite-local
- **ID:** c48c9414-e39b-4d50-8192-519b0cc6f72c
- **Estado:** Conectada y recibiendo mensajes
- **Evidencia:** Logs muestran mensajes entrantes con deliveryACK

---

## 2. Hallazgos de la Auditoría

### 2.1 ✅ Evolution API Local - FUNCIONANDO

La instalación local de Evolution API está completamente operativa:
- Receive mensajes de WhatsApp correctamente
- Gestionando estados de entrega (DELIVERY_ACK)
- Actualizando contactos en tiempo real

### 2.2 ⚠️ Acceso Externo - Tunnel Activo

**URL del túnel:** https://violet-bikes-go.loca.lt

**Nota:** LocalTunnel genera un nuevo subdominio en cada reinicio. Para producción permanente se requiere:
- Cloudflared configurado correctamente
- O VPS con IP pública

### 2.3 ⚠️ Configuración SERVER_TYPE

**Estado actual en .env:**
```
SERVER_TYPE=http
SERVER_URL=http://localhost:8080
```

**Recomendación para producción:**
```
SERVER_TYPE=https
SERVER_URL=https://tu-dominio.com
```

### 2.4 ✅ CORS Edge Functions - Configurado

El archivo `flowsuitecrm/supabase/functions/send-whatsapp/index.ts` tiene CORS correctamente configurado:

```typescript
const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',  // ✅ Desarrollo local
  'http://localhost:4173',
]
```

**Headers permitidos:**
```
Authorization, Content-Type, apikey, X-Client-Info, x-client-info
```

### 2.5 ⚠️ Migración RLS Pendiente

**Archivo:** `supabase/migrations/0023_notasrp_supervisor_telemercadeo.sql`

**Contenido:** Agrega políticas RLS para que `supervisor_telemercadeo` pueda leer/insertar en `notasrp`

**Acción requerida:** Ejecutar en Supabase SQL Editor

### 2.6 📋 Resumen de Puertos

| Servicio | Puerto Host | Puerto Contenedor |
|----------|-------------|-------------------|
| evolution_api | 8080 | 8080 |
| evolution_frontend | 3000 | 80 |
| evolution_redis | - | 6379 |
| evolution_postgres | - | 5432 |

---

## 3. Recomendaciones Inmediatas

### Prioridad Alta
1. **Aplicar migración RLS** en proyecto Supabase correcto
2. **Redeploy Edge Function** `send-whatsapp` para aplicar cambios CORS
3. **Configurar tunnel permanente** (Cloudflared) para producción

### Prioridad Media
1. Actualizar `SERVER_TYPE=https` cuando se tenga dominio SSL
2. Implementar logs de monitoreo para Evolution API
3. Configurar webhooks para eventos de WhatsApp

### Prioridad Baja
1. Configurar Prometheus metrics
2. Implementar backup automático de instancias
3. Configurar autenticación API key robusta

---

## 4. Próximos Pasos Sugeridos

1. **Verificar conectividad desde EasyPanel:**
   - Ejecutar `curl -I https://web.whatsapp.com` dentro del contenedor
   - Verificar resolución DNS

2. **Si EasyPanel sigue sin conectar:**
   - Usar Opción A: Apuntar a túnel local (requiere mantener tunnel activo)
   - Migrar Evolution API a VPS con salida libre

3. **Monitoreo continuo:**
   - Revisar logs de Evolution API periódicamente
   - Configurar alertas para desconexiones de WhatsApp

---

## 5. Archivos Clave Revisados

| Archivo | Estado |
|---------|--------|
| evolution-api/.env | ✅ Configurado |
| evolution-api/docker-compose.yaml | ✅ Correcto |
| flowsuitecrm/supabase/functions/send-whatsapp/index.ts | ✅ CORS OK |
| supabase/migrations/0023_notasrp_supervisor_telemercadeo.sql | ⏳ Pendiente aplicar |

---

**Conclusión:** El sistema local está operativo. El problema principal es el acceso desde EasyPanel (probablemente bloqueado por firewall/restricciones de red). La solución más práctica es mantener el túnel hacia la instalación local o migrar a un VPS con salida libre.
