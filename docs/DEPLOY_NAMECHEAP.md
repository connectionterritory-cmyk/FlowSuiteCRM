# Deploy Namecheap - FlowSuiteCRM (SPA)

## Entorno
- Hosting estatico: `crm.flowiadigital.com`
- Sin backend Node, sin rutas `/api`.

## Build
1) `npm install`
2) `npm run build`
3) Subir contenido de `frontend/dist/` al docroot.

## SPA Rewrite (.htaccess)
Requerido para rutas SPA:
```
RewriteEngine On
RewriteBase /
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

## Variables de entorno (Vite)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Verificacion
- Abrir rutas profundas (ej. `/pipeline`, `/cliente/123`) sin 404.
- Login y acceso restringido por org (RLS activo).
