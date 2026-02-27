# ARTES REVISOR — PDF Comparison & Review Platform

Plataforma profesional de comparación y revisión de diseños PDF con IA (GPT-4o Vision).  
Un solo comando para arrancar todo: `docker compose up --build`.

---

## Stack

| Capa     | Tecnología                                                            |
|----------|-----------------------------------------------------------------------|
| Frontend | Vanilla JS + Vite + TailwindCSS 3 + PDF.js                           |
| Backend  | Node.js 20 + Express + Multer + pdf2pic (ImageMagick/Ghostscript)    |
| IA       | OpenAI GPT-4o Vision                                                  |
| DB       | MongoDB 7 via Mongoose                                               |
| Infra    | Docker Compose (3 servicios: mongodb / backend / frontend)           |

---

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.x+
- Una **OpenAI API Key** con acceso a `gpt-4o`
- Puertos libres: `3000` (frontend), `3001` (backend), `27017` (MongoDB)

---

## Setup en 3 pasos

```bash
# 1. Clonar / entrar al directorio
cd artes2

# 2. Copiar variables de entorno y completar la API key
cp .env.example .env
# Editar .env y poner tu OPENAI_API_KEY=sk-proj-...

# 3. Arrancar todo
docker compose up --build
```

- **Frontend:** http://localhost:3000  
- **Backend API:** http://localhost:3001  
- **Health check:** http://localhost:3001/api/health  

---

## Variables de entorno (`.env`)

| Variable            | Descripción                                  | Default                               |
|---------------------|----------------------------------------------|---------------------------------------|
| `OPENAI_API_KEY`    | **Obligatorio.** Tu API key de OpenAI.       | —                                     |
| `MONGODB_URI`       | URI de conexión MongoDB.                     | `mongodb://mongodb:27017/pdfreviewer` |
| `MAX_FILE_SIZE_MB`  | Tamaño máximo por PDF en MB.                 | `50`                                  |
| `NODE_ENV`          | Entorno Node.                                | `development`                         |
| `VITE_API_URL`      | URL base del backend (para el browser).      | `http://localhost:3001`               |

---

## Flujo de uso

1. **Nuevo Trabajo** — Rellena el nombre del cliente, sube el PDF original y el PDF intervenido.
2. **Análisis** — La plataforma convierte los PDFs a imágenes y los envía a GPT-4o Vision. El progreso se muestra en tiempo real vía SSE.
3. **Resultados** — Vista comparativa con:
   - Sección A: Errores ortográficos detectados en cada versión
   - Sección B: Tabla de inventario de elementos (imágenes, textos, íconos, logos, CTAs)
   - Sección C: Paletas de colores extraídas (HEX), colores nuevos/eliminados
   - Sección D: Conclusión ejecutiva + veredicto (✅ Aprobado / ⚠️ Revisar / ❌ Rechazado)
4. **Historial** — Lista de todos los proyectos con búsqueda por cliente.

---

## Estructura del proyecto

```
artes2/
├── docker-compose.yml
├── .env.example
├── .env                   ← crear desde .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   ├── models/
│   │   └── Project.model.js
│   ├── routes/
│   │   ├── analysis.routes.js
│   │   └── projects.routes.js
│   ├── services/
│   │   ├── pdfConverter.service.js
│   │   ├── openai.service.js
│   │   └── comparison.service.js
│   └── uploads/           ← PDFs subidos (volumen Docker)
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── App.js
        ├── styles/
        │   └── main.css
        ├── hooks/
        │   └── useAnalysis.js
        └── components/
            ├── ProjectForm.js
            ├── PDFUploader.js
            ├── AnalysisPanel.js
            ├── ComparisonView.js
            └── HistoryList.js
```

---

## API Endpoints

| Método | Ruta                           | Descripción                                    |
|--------|--------------------------------|------------------------------------------------|
| GET    | `/api/health`                  | Health check del servidor                      |
| POST   | `/api/analysis/upload`         | Subir PDFs y crear proyecto (multipart/form)   |
| POST   | `/api/analysis/:id/start`      | Iniciar análisis de un proyecto                |
| GET    | `/api/analysis/:id/stream`     | Stream SSE de progreso del análisis            |
| GET    | `/api/analysis/:id`            | Obtener resultado completo                     |
| GET    | `/api/projects`                | Listar todos los proyectos                     |
| GET    | `/api/projects/:id`            | Obtener un proyecto por ID                     |
| DELETE | `/api/projects/:id`            | Eliminar un proyecto                           |

**Rate limit:** 5 peticiones/minuto por IP en los endpoints de análisis.

---

## Desarrollo local (sin Docker)

```bash
# MongoDB debe estar disponible en localhost:27017

# Backend
cd backend
npm install
OPENAI_API_KEY=sk-... MONGODB_URI=mongodb://localhost:27017/pdfreviewer node server.js

# Frontend (en otra terminal)
cd frontend
npm install
VITE_API_URL=http://localhost:3001 npm run dev
```

Requiere **Ghostscript** y **GraphicsMagick** instalados en el sistema:
- macOS: `brew install ghostscript graphicsmagick`
- Ubuntu: `apt-get install ghostscript graphicsmagick`
- Windows: https://www.ghostscript.com + https://www.graphicsmagick.org

---

## Troubleshooting

### El backend falla al convertir PDFs

```
Error: Could not convert PDF...
```

Verifica que la política de ImageMagick permita PDFs. El Dockerfile ya incluye el parche, pero si corres el backend localmente necesitas editar `/etc/ImageMagick-6/policy.xml`:

```xml
<!-- Cambiar rights="none" a rights="read|write" en la línea del patrón PDF -->
<policy domain="coder" rights="read|write" pattern="PDF" />
```

### OpenAI timeout

Si los PDFs son muy complejos, el análisis puede tardar más de 120 segundos. Puedes aumentar el timeout en `backend/services/openai.service.js`:

```js
const client = new OpenAI({ timeout: 180_000 }); // 3 minutos
```

### MongoDB no conecta

Asegúrate de que el servicio `mongodb` esté healthy antes de que arranque el `backend`. Docker Compose gestiona esto con `depends_on` + `healthcheck`.

```bash
# Ver logs de mongodb
docker compose logs mongodb

# Ver logs del backend
docker compose logs backend
```

### Limpiar todo y empezar de cero

```bash
docker compose down -v   # elimina contenedores Y volúmenes
docker compose up --build
```

---

## Licencia

MIT
