const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");

// Environment configuration
const config = {
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',
    database: {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'taskdb',
        user: process.env.POSTGRES_USER || 'worker',
        password: process.env.POSTGRES_PASSWORD || 'password',
        max: parseInt(process.env.DB_POOL_MAX) || 20,
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 2000,
    },
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
    }
};

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Rate limiting
const limiter = rateLimit(config.rateLimit);
app.use('/api/', limiter);

// Compression middleware
app.use(compression());

// CORS configuration
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

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

// Database connection
const pool = new Pool(config.database);

// Database connection event handlers
pool.on('connect', (client) => {
    console.log('New database client connected');
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

// Test database connection
async function testDatabaseConnection() {
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        console.log('Database connected successfully at:', result.rows[0].current_time);
        return true;
    } catch (error) {
        console.error('Database connection error:', error);
        return false;
    }
}

// Input validation middleware
const validateJobId = (req, res, next) => {
    const { jobId } = req.params;
    if (!jobId) {
        return res.status(400).json({
            error: "Invalid job ID",
            message: "Job ID is required"
        });
    }

    // Check if it's a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isNumeric = !isNaN(parseInt(jobId));
    const isUUID = uuidRegex.test(jobId);

    if (!isNumeric && !isUUID) {
        return res.status(400).json({
            error: "Invalid job ID",
            message: "Job ID must be a valid number or UUID"
        });
    }

    req.jobId = jobId; // Keep as string for UUIDs, convert to number for numeric IDs
    next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    if (err.code === 'ECONNREFUSED') {
        return res.status(503).json({
            error: "Database connection failed",
            message: "Unable to connect to database"
        });
    }

    if (err.code === '23505') { // Unique constraint violation
        return res.status(409).json({
            error: "Conflict",
            message: "Resource already exists"
        });
    }

    res.status(500).json({
        error: "Internal server error",
        message: config.nodeEnv === 'development' ? err.message : "Something went wrong"
    });
};

// API Routes
const apiRouter = express.Router();

// Get all jobs with task statistics
apiRouter.get("/jobs", async (req, res, next) => {
    try {
        const { search, state, user_id } = req.query;

        let whereClause = '';
        let queryParams = [];
        let paramIndex = 1;

        // Build WHERE clause based on search parameters
        if (search) {
            whereClause += `WHERE j.id::text ILIKE $${paramIndex}`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        if (state) {
            const stateCondition = whereClause ? 'AND' : 'WHERE';
            whereClause += `${whereClause ? ' AND' : ' WHERE'} j.state = $${paramIndex}`;
            queryParams.push(state);
            paramIndex++;
        }

        if (user_id) {
            const userCondition = whereClause ? 'AND' : 'WHERE';
            whereClause += `${whereClause ? ' AND' : ' WHERE'} j.user_id = $${paramIndex}`;
            queryParams.push(user_id);
            paramIndex++;
        }

        const query = `
            SELECT
                j.id,
                j.state,
                j.error,
                j.user_id,
                j.reported,
                COUNT(t.task_id) as task_count,
                COUNT(CASE WHEN t.state = 'done' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN t.state = 'running' THEN 1 END) as running_tasks,
                COUNT(CASE WHEN t.state = 'pending' THEN 1 END) as pending_tasks,
                COUNT(CASE WHEN t.state = 'failed' THEN 1 END) as failed_tasks
            FROM jobs j
            LEFT JOIN tasks t ON j.id = t.job_id
            ${whereClause}
            GROUP BY j.id, j.state, j.error, j.user_id, j.reported
            ORDER BY j.id DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        if (limit > 100) {
            return res.status(400).json({
                error: "Invalid limit",
                message: "Limit cannot exceed 100"
            });
        }

        queryParams.push(limit, offset);
        const result = await pool.query(query, queryParams);

        res.json({
            jobs: result.rows,
            pagination: {
                limit,
                offset,
                count: result.rows.length
            },
            search: {
                term: search || null,
                state: state || null,
                user_id: user_id || null
            }
        });
    } catch (error) {
        next(error);
    }
});

// Search jobs by various criteria
apiRouter.get("/jobs/search", async (req, res, next) => {
    try {
        const { jobId, partial, state, user_id, limit: limitParam, offset: offsetParam } = req.query;

        let whereClause = '';
        let queryParams = [];
        let paramIndex = 1;

        // Build WHERE clause based on search parameters
        if (jobId) {
            if (partial === 'true') {
                // Partial match - search for job IDs that contain the search term
                whereClause += `WHERE j.id::text ILIKE $${paramIndex}`;
                queryParams.push(`%${jobId}%`);
            } else {
                // Exact match - search for specific job ID
                whereClause += `WHERE j.id = $${paramIndex}`;
                queryParams.push(jobId);
            }
            paramIndex++;
        }

        if (state) {
            const stateCondition = whereClause ? 'AND' : 'WHERE';
            whereClause += `${whereClause ? ' AND' : ' WHERE'} j.state = $${paramIndex}`;
            queryParams.push(state);
            paramIndex++;
        }

        if (user_id) {
            const userCondition = whereClause ? 'AND' : 'WHERE';
            whereClause += `${whereClause ? ' AND' : ' WHERE'} j.user_id = $${paramIndex}`;
            queryParams.push(user_id);
            paramIndex++;
        }

        // If no search criteria provided, return error
        if (!jobId && !state && !user_id) {
            return res.status(400).json({
                error: "Missing search criteria",
                message: "At least one search parameter (jobId, state, or user_id) is required"
            });
        }

        const query = `
            SELECT
                j.id,
                j.state,
                j.error,
                j.user_id,
                j.reported,
                COUNT(t.task_id) as task_count,
                COUNT(CASE WHEN t.state = 'done' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN t.state = 'running' THEN 1 END) as running_tasks,
                COUNT(CASE WHEN t.state = 'pending' THEN 1 END) as pending_tasks,
                COUNT(CASE WHEN t.state = 'failed' THEN 1 END) as failed_tasks
            FROM jobs j
            LEFT JOIN tasks t ON j.id = t.job_id
            ${whereClause}
            GROUP BY j.id, j.state, j.error, j.user_id, j.reported
            ORDER BY j.id DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const limit = parseInt(limitParam) || 50;
        const offset = parseInt(offsetParam) || 0;

        if (limit > 100) {
            return res.status(400).json({
                error: "Invalid limit",
                message: "Limit cannot exceed 100"
            });
        }

        queryParams.push(limit, offset);
        const result = await pool.query(query, queryParams);

        res.json({
            jobs: result.rows,
            pagination: {
                limit,
                offset,
                count: result.rows.length
            },
            search: {
                jobId: jobId || null,
                partial: partial === 'true',
                state: state || null,
                user_id: user_id || null
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get job details with all tasks
apiRouter.get("/jobs/:jobId", validateJobId, async (req, res, next) => {
    try {
        const { jobId } = req;

        // Get job details
        const jobQuery = `
            SELECT
                id,
                state,
                error,
                user_id,
                reported
            FROM jobs
            WHERE id = $1
        `;

        const jobResult = await pool.query(jobQuery, [req.jobId]);

        if (jobResult.rows.length === 0) {
            return res.status(404).json({
                error: "Job not found",
                message: `Job with ID ${jobId} does not exist`
            });
        }

        const job = jobResult.rows[0];

        // Get tasks for this job
        const tasksQuery = `
            SELECT
                task_id,
                state,
                progress,
                retries,
                max_retries,
                timeout_secs,
                waiting_on,
                error,
                created_at,
                started_at,
                updated_at,
                task_def,
                prerequisites,
                output
            FROM tasks
            WHERE job_id = $1
            ORDER BY created_at ASC
        `;

        const tasksResult = await pool.query(tasksQuery, [req.jobId]);

        res.json({
            job: job,
            tasks: tasksResult.rows,
            taskCount: tasksResult.rows.length
        });
    } catch (error) {
        next(error);
    }
});

// Get task dependencies
apiRouter.get("/jobs/:jobId/dependencies", validateJobId, async (req, res, next) => {
    try {
        const { jobId } = req;

        const query = `
            SELECT
                pre_task_id,
                post_task_id
            FROM task_deps
            WHERE job_id = $1
        `;

        const result = await pool.query(query, [req.jobId]);
        res.json({
            dependencies: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        next(error);
    }
});

// Get streams
apiRouter.get("/streams", async (req, res, next) => {
    try {
        const query = `
            SELECT
                id,
                job_id,
                created_at,
                updated_at
            FROM streams
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        if (limit > 100) {
            return res.status(400).json({
                error: "Invalid limit",
                message: "Limit cannot exceed 100"
            });
        }

        const result = await pool.query(query, [limit, offset]);
        res.json({
            streams: result.rows,
            pagination: {
                limit,
                offset,
                count: result.rows.length
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete a job and all its tasks
apiRouter.delete("/jobs/:jobId", validateJobId, async (req, res, next) => {
    try {
        const { jobId } = req;

        // First check if job exists
        const jobCheckQuery = `SELECT id FROM jobs WHERE id = $1`;
        const jobCheckResult = await pool.query(jobCheckQuery, [jobId]);

        if (jobCheckResult.rows.length === 0) {
            return res.status(404).json({
                error: "Job not found",
                message: `Job with ID ${jobId} does not exist`
            });
        }

        // Delete in correct order: task_deps -> tasks -> jobs
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Delete task dependencies first (if table exists)
            try {
                await client.query('DELETE FROM task_deps WHERE job_id = $1', [jobId]);
            } catch (error) {
                console.log('task_deps table or job_id column may not exist, skipping...');
            }

            // 2. Delete tasks
            await client.query('DELETE FROM tasks WHERE job_id = $1', [jobId]);

            // 3. Finally delete the job
            const deleteResult = await client.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [jobId]);

            await client.query('COMMIT');

            res.json({
                message: "Job deleted successfully",
                deletedJobId: deleteResult.rows[0].id
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        next(error);
    }
});

// Delete a specific task
apiRouter.delete("/jobs/:jobId/tasks/:taskId", validateJobId, async (req, res, next) => {
    try {
        const { jobId } = req;
        const { taskId } = req.params;

        if (!taskId) {
            return res.status(400).json({
                error: "Invalid task ID",
                message: "Task ID is required"
            });
        }

        // Check if task exists
        const taskCheckQuery = `SELECT task_id FROM tasks WHERE job_id = $1 AND task_id = $2`;
        const taskCheckResult = await pool.query(taskCheckQuery, [jobId, taskId]);

        if (taskCheckResult.rows.length === 0) {
            return res.status(404).json({
                error: "Task not found",
                message: `Task ${taskId} not found in job ${jobId}`
            });
        }

        // Delete task dependencies and task in correct order
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Delete task dependencies that reference this task (if table exists)
            try {
                await client.query('DELETE FROM task_deps WHERE job_id = $1 AND (pre_task_id = $2 OR post_task_id = $2)', [jobId, taskId]);
            } catch (error) {
                console.log('task_deps table may not exist, skipping...');
            }

            // 2. Delete the task
            const deleteResult = await client.query('DELETE FROM tasks WHERE job_id = $1 AND task_id = $2 RETURNING task_id', [jobId, taskId]);

            await client.query('COMMIT');

            res.json({
                message: "Task deleted successfully",
                deletedTaskId: deleteResult.rows[0].task_id
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        next(error);
    }
});

// Health check endpoint
apiRouter.get("/health", async (req, res) => {
    try {
        const dbConnected = await testDatabaseConnection();
        const status = dbConnected ? 'healthy' : 'unhealthy';
        const statusCode = dbConnected ? 200 : 503;

        res.status(statusCode).json({
            status,
            timestamp: new Date().toISOString(),
            database: dbConnected ? 'connected' : 'disconnected',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: config.nodeEnv
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'error',
            error: error.message
        });
    }
});

// Database schema info endpoint
apiRouter.get("/schema", async (req, res) => {
    try {
        const schemaQuery = `
            SELECT
                table_name,
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `;

        const result = await pool.query(schemaQuery);

        // Group by table
        const schema = {};
        result.rows.forEach(row => {
            if (!schema[row.table_name]) {
                schema[row.table_name] = [];
            }
            schema[row.table_name].push({
                column: row.column_name,
                type: row.data_type,
                nullable: row.is_nullable
            });
        });

        res.json({
            schema,
            tables: Object.keys(schema)
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to get schema info",
            message: error.message
        });
    }
});

// Mount API routes
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
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

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

// Start server
const server = app.listen(config.port, () => {
    console.log(`🚀 Kumo server running on http://localhost:${config.port}`);
    console.log(`📊 Environment: ${config.nodeEnv}`);
    console.log(`🗄️  Database: ${config.database.host}:${config.database.port}/${config.database.database}`);
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
module.exports = { app, pool, config };
