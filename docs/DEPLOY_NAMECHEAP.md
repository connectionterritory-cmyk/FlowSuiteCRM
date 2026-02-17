# Deploy Namecheap - FlowSuiteCRM (SPA)

## Entorno
- **Producción**: `crm.flowiadigital.com`
- **Staging (recomendado)**: `crm.flowiadigital.com/staging/`
- Sin backend Node, sin rutas `/api`.

## Build
1) `cd frontend`
2) `npm install`
3) `npm run build`
4) Subir contenido de `frontend/dist/` al docroot.

## Deploy a Staging (subcarpeta `/staging/`)

### 1. Configurar base path en Vite
Edita `frontend/vite.config.js`:
```javascript
export default defineConfig({
  plugins: [react()],
  base: '/staging/', // <-- Agregar esta línea
})
```

### 2. Build con base path
```bash
cd frontend
npm run build
```

### 3. Subir a subcarpeta
- Subir contenido de `frontend/dist/` a `/public_html/staging/` en Namecheap

### 4. SPA Rewrite para subcarpeta
Crear `/public_html/staging/.htaccess`:
```apache
RewriteEngine On
RewriteBase /staging/
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /staging/index.html [L]
```

## Deploy a Producción (root `/`)

### 1. Configurar base path en Vite
Edita `frontend/vite.config.js`:
```javascript
export default defineConfig({
  plugins: [react()],
  base: '/', // <-- Base path para root
})
```

### 2. Build
```bash
cd frontend
npm run build
```

### 3. Subir a root
- Subir contenido de `frontend/dist/` a `/public_html/` en Namecheap

### 4. SPA Rewrite para root
Crear `/public_html/.htaccess`:
```apache
RewriteEngine On
RewriteBase /
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

## Variables de entorno (Vite)
Las variables se embeben en el build. Configurar en `frontend/.env.local`:
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**IMPORTANTE**: Estas variables se embeben en el bundle de JavaScript. NO incluir secrets sensibles.

## Checklist de Verificación

### Staging (`/staging/`)
- [ ] Abrir `crm.flowiadigital.com/staging/`
- [ ] Login funciona
- [ ] Rutas profundas funcionan (ej. `/staging/pipeline`, `/staging/cliente-360`)
- [ ] No hay errores 404 al navegar
- [ ] Los 6 módulos cargan correctamente:
  - [ ] Pipeline
  - [ ] Cliente360
  - [ ] Servicio
  - [ ] Agua
  - [ ] Cartera
  - [ ] Team Hub
- [ ] RLS activo (solo data de tu org visible)

### Producción (`/`)
- [ ] Abrir `crm.flowiadigital.com`
- [ ] Login funciona
- [ ] Rutas profundas funcionan (ej. `/pipeline`, `/cliente-360`)
- [ ] No hay errores 404 al navegar
- [ ] Los 6 módulos cargan correctamente
- [ ] RLS activo (solo data de tu org visible)

## Troubleshooting

### Error: "Blank page after deploy"
- Verificar que `base` en `vite.config.js` coincide con la ruta de deploy
- Verificar que `.htaccess` tiene `RewriteBase` correcto

### Error: "404 en rutas profundas"
- Verificar que `.htaccess` existe en la carpeta correcta
- Verificar que `RewriteEngine On` está activo en el servidor

### Error: "Cannot connect to Supabase"
- Verificar que `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` están en `.env.local`
- Rebuild después de cambiar variables de entorno
- Verificar en DevTools → Network que las requests van a la URL correcta
