const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const morgan = require("morgan");

// Import modules
const config = require("./config");
const DatabaseService = require("./services/DatabaseService");
const AutoClearService = require("./services/AutoClearService");
const { setupSecurityMiddleware } = require("./middleware/security");
const ErrorHandler = require("./middleware/errorHandler");
const { router: apiRouter, setDependencies } = require("./routes/api");

// ============================================================================
// DATABASE SETUP
// ============================================================================

const pool = new Pool(config.database);

// Database connection event handlers
pool.on('connect', () => {
    console.log('New database client connected');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// Initialize database service
const dbService = new DatabaseService(pool);

// Initialize auto-clear service
const autoClearService = new AutoClearService(dbService, config);

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app = express();

// Security and middleware setup
setupSecurityMiddleware(app);

// Logging middleware
if (config.nodeEnv === 'production') {
    app.use(morgan('combined'));
} else {
    app.use(morgan('dev'));
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use(express.static(path.join(__dirname, "public"), {
    maxAge: config.nodeEnv === 'production' ? '1d' : 0,
    etag: true
}));

// ============================================================================
// ROUTES
// ============================================================================

// Set up API routes with dependencies
setDependencies(dbService, pool, autoClearService);
app.use('/api', apiRouter);

// Serve the main HTML page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: "Not found",
        message: `Route ${req.originalUrl} not found`
    });
});

// Error handling middleware (must be last)
app.use(ErrorHandler.handle);

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

    // Stop auto-clear service
    autoClearService.stop();

    // Stop accepting new requests
    server.close(() => {
        console.log('HTTP server closed');

        // Close database pool
        pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
        });
    });

    // Force exit after 30 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
};

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Kumo server running on http://0.0.0.0:${config.port}`);
    console.log(`📊 Environment: ${config.nodeEnv}`);
    console.log(`🗄️  Database: ${config.database.host}:${config.database.port}/${config.database.database}`);

    // Start auto-clear service if enabled
    autoClearService.start();
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// Export for testing
module.exports = { app, pool, config, dbService };
