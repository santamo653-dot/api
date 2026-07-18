FROM python:3.11-slim-bullseye

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libxshmfence1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libasound2 \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright where to find browsers and sandbox settings
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_CHROMIUM_SANDBOX=1

# Create app directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

# Copy application files
COPY index.py .
COPY index.js ./fallback.js

# Expose port
EXPOSE 3000

# Run with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:3000", "--timeout", "120", "index:app"]