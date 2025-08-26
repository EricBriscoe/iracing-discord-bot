# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Install fonts so SVG text renders correctly with sharp/libvips
RUN apk add --no-cache fontconfig ttf-dejavu ttf-liberation

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p data

# Start the application
CMD ["npm", "start"]
