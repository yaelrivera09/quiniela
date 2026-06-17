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
- Los partidos se refrescan cada 30s y los grupos cada 2 min mientras la pestaña está abierta.
- Un equipo se marca en rojo ("Eliminado") automáticamente cuando pierde un partido de eliminación directa (octavos, cuartos, semis, final).
