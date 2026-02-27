FROM node:20-slim

# Install system dependencies required by pdf2pic (GraphicsMagick + Ghostscript)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    graphicsmagick \
    libgs-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Allow ghostscript to read PDFs (policy workaround)
RUN sed -i 's|<policy domain="coder" rights="none" pattern="PDF" />|<policy domain="coder" rights="read|write" pattern="PDF" />|g' \
    /etc/ImageMagick-6/policy.xml 2>/dev/null || true

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["node", "server.js"]
