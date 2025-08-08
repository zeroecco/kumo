const config = require('../config');

class ErrorHandler {
    static handle(error, req, res, next) {
        console.error('Error:', error);

        // Database connection errors
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                error: "Database connection failed",
                message: "Unable to connect to database"
            });
        }

        // Unique constraint violation
        if (error.code === '23505') {
            return res.status(409).json({
                error: "Conflict",
                message: "Resource already exists"
            });
        }

        // Validation errors
        if (error.message && (error.message.includes('required') || error.message.includes('must be'))) {
            return res.status(400).json({
                error: "Validation Error",
                message: error.message
            });
        }

        // Default error response
        res.status(500).json({
            error: "Internal server error",
            message: config.nodeEnv === 'development' ? error.message : "Something went wrong"
        });
    }
}

module.exports = ErrorHandler;
