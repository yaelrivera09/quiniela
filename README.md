# Quiniela Familiar — Mundial 2026

Sitio con los 12 participantes, sus 4 equipos cada uno, tabla de grupos y partidos en vivo del Mundial 2026.

## Estructura
- `index.html`, `css/styles.css`, `js/script.js` — sitio (estático).
- `data/people.js` — participantes y sus equipos.
- `api/standings.js`, `api/matches.js` — funciones serverless de Vercel que consultan [football-data.org](https://www.football-data.org/) sin exponer la API key.
- `images/` — pon aquí `Nombre.jpg` por cada persona (ver `images/README.txt`).

## 1. Obtener API key gratuita
1. Regístrate en https://www.football-data.org/client/register (plan gratuito).
2. Te llega una API key por correo.

## 2. Subir a GitHub
```bash
cd "Proyectos web/Quiniela"
git init
git add .
git commit -m "Quiniela familiar Mundial 2026"
git branch -M main
git remote add origin <URL_DE_TU_REPO>
git push -u origin main
```

## 3. Desplegar en Vercel
1. Entra a https://vercel.com → "Add New Project" → importa el repo de GitHub.
2. En **Settings → Environment Variables** agrega:
   - `FOOTBALL_DATA_API_KEY` = tu API key del paso 1.
3. Deploy. Vercel detecta `api/*.js` como funciones serverless automáticamente (no necesitas configuración extra).

## Notas
- Si no configuras la API key, la web sigue funcionando (participantes y sus equipos se ven bien), solo no se cargan grupos/partidos en vivo y aparece un aviso.
- Un equipo se marca en rojo ("Eliminado") automáticamente cuando pierde un partido de eliminación directa (octavos, cuartos, semis, final).

### Motor de actualización
- **Polling adaptativo**: los partidos se refrescan cada 7 s cuando hay alguno en vivo y cada 45 s cuando no; la tabla cada 2 min y las apuestas cada 20 s (ver constante `POLL` en `js/script.js`).
- **Caché de borde**: las funciones serverless fijan `Cache-Control` con `s-maxage` para que football-data.org solo se consulte una vez por intervalo en todo el CDN (protege el límite gratuito de ~10 llamadas/min sin importar cuántos usuarios haya abiertos).
- **Indicador visible**: el encabezado muestra "Actualizado: HH:MM:SS" (o "Sin conexión" en rojo) y un botón "🔄 Actualizar" para forzar un refresco.
- **Reanudación**: al volver a primer plano (`visibilitychange`, `pageshow`, `focus`) se hace un refresco inmediato y se reinician los temporizadores; en segundo plano el polling se detiene para ahorrar llamadas/batería. Esto cubre el caso de iOS "Agregar a pantalla de inicio".
- **Anti-caché en estáticos**: `vercel.json` + metas en el `<head>` + versión `?v=` en CSS/JS evitan que Safari sirva una copia vieja desde el ícono de inicio.

## 4. Apuestas (requiere Upstash Redis)
La pestaña "Apuestas" guarda su estado en una base de datos Redis gratuita:
1. En Vercel: proyecto → **Storage** → **Create Database** → elige **Upstash for Redis** (plan gratis) → conéctala al proyecto.
2. Vercel agrega solas las variables de conexión. El helper `api/_redis.js` acepta tanto `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (Upstash directo) como `KV_REST_API_URL`/`KV_REST_API_TOKEN` (marketplace de Vercel).
3. Endpoints: `api/bets/create.js`, `api/bets/list.js`, `api/bets/accept.js`, `api/bets/delete.js` (usan `api/_redis.js`).
4. Cada persona tiene un campo `phone` en `data/people.js` (formato `+52XXXXXXXXXX`) usado para abrir WhatsApp 1 a 1 (`wa.me`) con el mensaje de la apuesta ya redactado.
5. Sin la base conectada, los botones de apostar igual abren WhatsApp, pero la apuesta no queda guardada ni aparece en la pestaña "Apuestas".
