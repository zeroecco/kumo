const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cors = require('cors');
const config = require('../config');

const setupSecurityMiddleware = (app) => {
    // Security middleware
    app.use(helmet({
        contentSecurityPolicy: config.nodeEnv === 'production' ? {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:"],
            },
        } : false,
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: false
    }));

    // Rate limiting
    const limiter = rateLimit(config.rateLimit);
    app.use('/api/', limiter);

    // Compression middleware
    app.use(compression());

    // CORS configuration
    app.use(cors(config.cors));

    // Additional headers for development
    if (config.nodeEnv === 'development') {
        app.use((req, res, next) => {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
            res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
            res.setHeader('Origin-Agent-Cluster', '?0');
            next();
        });
    }
};

module.exports = { setupSecurityMiddleware };
