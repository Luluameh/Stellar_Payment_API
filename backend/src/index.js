import 'dotenv/config';
import express from "express";
import morgan from "morgan";
import cors from "cors";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import paymentsRouter from "./routes/payments.js";
import merchantsRouter from "./routes/merchants.js";
import { requireApiKeyAuth } from "./lib/auth.js";
import { supabase } from "./lib/supabase.js";
import { pool, closePool } from "./lib/db.js";
import { validateEnvironmentVariables } from "./lib/env-validation.js";
import {
  getSecurityHeaders,
  sanitizeRequest,
  errorHandler,
  rateLimiters,
} from "./lib/security.js";

validateEnvironmentVariables();

const app = express();
const port = process.env.PORT || 4000;

// Make the pool available to all routes via req.app.locals.pool
app.locals.pool = pool;

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Stellar Payment API",
      version: "0.1.0",
      description: "API for creating and verifying Stellar network payments"
    },
    servers: [{ url: `http://localhost:${port}` }]
  },
  apis: ["./src/routes/*.js"]
});

// ============================================================================
// SECURITY MIDDLEWARE (applied before routes)
// ============================================================================

// Apply security headers first
app.use(getSecurityHeaders());

// Apply global rate limiting as early as possible
app.use(rateLimiters.global);

// CORS configuration
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log suspicious CORS violations
      console.warn(`[SECURITY] CORS violation attempted from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  maxAge: 3600,
}));

// Body parsing with strict size limit
app.use(express.json({ limit: "1mb" }));

// Request sanitization
app.use(sanitizeRequest);

// Request logging with Morgan
app.use(morgan((tokens, req, res) => {
  // Exclude sensitive headers from logs
  const status = tokens.status(req, res);
  const method = tokens.method(req, res);
  const url = tokens.url(req, res);
  const responseTime = tokens['response-time'](req, res);

  // Log suspicious patterns
  if (status >= 400) {
    console.warn(`[REQUEST] ${method} ${url} - ${status} ${responseTime}ms`);
  }

  return `${method} ${url} ${status} ${responseTime}ms`;
}));

// Swagger UI (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// ============================================================================
// ROUTES
// ============================================================================

app.get("/health", async (req, res) => {
  try {
    const { error } = await supabase.from("merchants").select("id").limit(1);

    if (error) {
      return res.status(503).json({
        ok: false,
        service: "stellar-payment-api",
        error: "Database unavailable"
      });
    }

    res.json({ ok: true, service: "stellar-payment-api" });
  } catch {
    res.status(503).json({
      ok: false,
      service: "stellar-payment-api",
      error: "Database unavailable"
    });
  }
});

// Apply authentication rate limiter to merchant registration
app.post("/api/register-merchant", rateLimiters.auth);

// Apply authentication rate limiter to key rotation
app.post("/api/rotate-key", rateLimiters.auth, requireApiKeyAuth());

// Apply API rate limiter to create-payment
app.post("/api/create-payment", rateLimiters.api, requireApiKeyAuth());

// Apply verification rate limiter to payment verification endpoints
app.post("/api/verify-payment/:id", rateLimiters.verification);

// Mount routers
app.use("/api", paymentsRouter);
app.use("/api", merchantsRouter);

// ============================================================================
// ERROR HANDLING (must be last)
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found"
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// ============================================================================
// DATABASE AND SERVER STARTUP
// ============================================================================

// Verify pg pool reaches Postgres before accepting traffic
pool.query('SELECT 1').then(() => {
  console.log('✅ pg pool connected (Supabase pooler)');
}).catch((err) => {
  console.warn('⚠️  pg pool probe failed — check DATABASE_URL:', err.message);
});

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown: drain in-flight queries then exit
function shutdown(signal) {
  console.log(`${signal} received — closing server and pg pool...`);
  server.close(async () => {
    await closePool();
    console.log('pg pool closed. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
