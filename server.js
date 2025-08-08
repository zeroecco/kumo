const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");

// ============================================================================
// CONFIGURATION
// ============================================================================

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
        max: parseInt(process.env.RATE_LIMIT_MAX) || (process.env.NODE_ENV === 'production' ? 1000 : 10000), // limit each IP to 100 requests per windowMs in production, 1000 in development
    }
};

// ============================================================================
// DATABASE UTILITIES
// ============================================================================

class QueryBuilder {
    constructor() {
        this.selectFields = null;
        this.fromTable = '';
        this.joins = [];
        this.whereConditions = [];
        this.groupByFields = [];
        this.orderByClauses = [];
        this.limitValue = null;
        this.offsetValue = null;
        this.params = [];
        this.paramIndex = 1;
    }

    select(fields) {
        this.selectFields = Array.isArray(fields) ? fields : [fields];
        return this;
    }

    from(table) {
        this.fromTable = table;
        return this;
    }

    join(table, condition, type = 'LEFT') {
        this.joins.push({ table, condition, type });
        return this;
    }

    where(condition, value = null) {
        if (value !== null) {
            this.whereConditions.push({ condition: condition.replace('?', `$${this.paramIndex}`), value });
            this.params.push(value);
            this.paramIndex++;
        } else {
            this.whereConditions.push({ condition, value: null });
        }
        return this;
    }

    groupBy(fields) {
        this.groupByFields = Array.isArray(fields) ? fields : [fields];
        return this;
    }

    orderBy(field, direction = 'ASC') {
        this.orderByClauses.push({ field, direction });
        return this;
    }

    limit(value) {
        this.limitValue = value;
        return this;
    }

    offset(value) {
        this.offsetValue = value;
        return this;
    }

    build() {
        if (!this.selectFields) {
            throw new Error('SELECT clause is required');
        }
        let query = 'SELECT ' + this.selectFields.join(', ') + ' FROM ' + this.fromTable;

        // Add joins
        this.joins.forEach(join => {
            query += ` ${join.type} JOIN ${join.table} ON ${join.condition}`;
        });

        // Add where clause
        if (this.whereConditions.length > 0) {
            const whereConditions = this.whereConditions.map(w => w.condition).join(' AND ');
            query += ' WHERE ' + whereConditions;
        }

        // Add group by
        if (this.groupByFields.length > 0) {
            query += ' GROUP BY ' + this.groupByFields.join(', ');
        }

        // Add order by
        if (this.orderByClauses.length > 0) {
            const orderClause = this.orderByClauses.map(o => `${o.field} ${o.direction}`).join(', ');
            query += ' ORDER BY ' + orderClause;
        }

        // Add limit and offset
        if (this.limitValue !== null) {
            query += ` LIMIT $${this.paramIndex}`;
            this.params.push(this.limitValue);
            this.paramIndex++;
        }

        if (this.offsetValue !== null) {
            query += ` OFFSET $${this.paramIndex}`;
            this.params.push(this.offsetValue);
        }

        return { query, params: this.params };
    }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

class Validator {
    static validateJobId(jobId) {
        if (!jobId) {
            throw new Error('Job ID is required');
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isNumeric = !isNaN(parseInt(jobId));
        const isUUID = uuidRegex.test(jobId);

        if (!isNumeric && !isUUID) {
            throw new Error('Job ID must be a valid number or UUID');
        }

        return jobId;
    }

    static validatePagination(limit, offset) {
        const parsedLimit = parseInt(limit) || 50;
        const parsedOffset = parseInt(offset) || 0;

        if (parsedLimit > 100) {
            throw new Error('Limit cannot exceed 100');
        }

        if (parsedLimit < 1) {
            throw new Error('Limit must be at least 1');
        }

        if (parsedOffset < 0) {
            throw new Error('Offset must be non-negative');
        }

        return { limit: parsedLimit, offset: parsedOffset };
    }

    static validateSearchParams(params) {
        const validParams = {};

        if (params.jobId) {
            validParams.jobId = params.jobId;
        }

        if (params.state && ['running', 'done', 'failed', 'pending'].includes(params.state)) {
            validParams.state = params.state;
        }

        if (params.user_id) {
            validParams.user_id = params.user_id;
        }

        if (params.partial === 'true' || params.partial === 'false') {
            validParams.partial = params.partial;
        }

        return validParams;
    }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

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
        if (error.message && error.message.includes('required') || error.message.includes('must be')) {
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

// ============================================================================
// MIDDLEWARE
// ============================================================================

const validateJobId = (req, res, next) => {
    try {
        const jobId = Validator.validateJobId(req.params.jobId);
        req.jobId = jobId;
        next();
    } catch (error) {
        res.status(400).json({
            error: "Invalid job ID",
            message: error.message
        });
    }
};

// ============================================================================
// DATABASE SERVICE
// ============================================================================

class DatabaseService {
    constructor(pool) {
        this.pool = pool;
    }

    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW() as current_time');
            console.log('Database connected successfully at:', result.rows[0].current_time);
            return true;
        } catch (error) {
            console.error('Database connection error:', error);
            return false;
        }
    }

    async getJobsWithStats(searchParams = {}, pagination = {}) {
        const { limit, offset } = Validator.validatePagination(pagination.limit, pagination.offset);
        const validSearchParams = Validator.validateSearchParams(searchParams);

                const queryBuilder = new QueryBuilder()
            .select([
                'j.id',
                'j.state',
                'j.error',
                'j.user_id',
                'j.reported',
                'COUNT(t.task_id) as task_count',
                'COUNT(CASE WHEN t.state = \'done\' THEN 1 END) as completed_tasks',
                'COUNT(CASE WHEN t.state = \'running\' THEN 1 END) as running_tasks',
                'COUNT(CASE WHEN t.state = \'pending\' THEN 1 END) as pending_tasks',
                'COUNT(CASE WHEN t.state = \'failed\' THEN 1 END) as failed_tasks'
            ])
            .from('jobs j')
            .join('tasks t', 'j.id = t.job_id')
            .groupBy(['j.id', 'j.state', 'j.error', 'j.user_id', 'j.reported'])
            .orderBy('j.id', 'DESC')
            .limit(limit)
            .offset(offset);

        // Add search conditions
        if (validSearchParams.jobId) {
            if (validSearchParams.partial === 'true') {
                queryBuilder.where('j.id::text ILIKE ?', `%${validSearchParams.jobId}%`);
            } else {
                queryBuilder.where('j.id = ?', validSearchParams.jobId);
            }
        }

        if (validSearchParams.state) {
            queryBuilder.where('j.state = ?', validSearchParams.state);
        }

        if (validSearchParams.user_id) {
            queryBuilder.where('j.user_id = ?', validSearchParams.user_id);
        }

        const { query, params } = queryBuilder.build();
        const result = await this.pool.query(query, params);

        return {
            jobs: result.rows,
            pagination: { limit, offset, count: result.rows.length },
            search: validSearchParams
        };
    }

    async getJobDetails(jobId) {
        const jobQuery = `
            SELECT id, state, error, user_id, reported
            FROM jobs WHERE id = $1
        `;
        const jobResult = await this.pool.query(jobQuery, [jobId]);

        if (jobResult.rows.length === 0) {
            throw new Error(`Job with ID ${jobId} does not exist`);
        }

        const tasksQuery = `
            SELECT task_id, state, progress, retries, max_retries, timeout_secs,
                   waiting_on, error, created_at, started_at, updated_at, task_def,
                   prerequisites, output
            FROM tasks WHERE job_id = $1 ORDER BY created_at ASC
        `;
        const tasksResult = await this.pool.query(tasksQuery, [jobId]);

        return {
            job: jobResult.rows[0],
            tasks: tasksResult.rows,
            taskCount: tasksResult.rows.length
        };
    }

    async getJobDependencies(jobId) {
        const query = `
            SELECT pre_task_id, post_task_id
            FROM task_deps WHERE job_id = $1
        `;
        const result = await this.pool.query(query, [jobId]);

        return {
            dependencies: result.rows,
            count: result.rows.length
        };
    }

    async deleteJob(jobId) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Check if job exists first
            const jobCheck = await client.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
            if (jobCheck.rows.length === 0) {
                throw new Error(`Job with ID ${jobId} does not exist`);
            }

            // Delete in correct order: task_deps -> tasks -> jobs
            try {
                await client.query('DELETE FROM task_deps WHERE job_id = $1', [jobId]);
            } catch (error) {
                console.log('task_deps table or job_id column may not exist, skipping...');
            }

            await client.query('DELETE FROM tasks WHERE job_id = $1', [jobId]);
            const deleteResult = await client.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [jobId]);

            await client.query('COMMIT');

            return { deletedJobId: deleteResult.rows[0].id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteTask(jobId, taskId) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Check if task exists
            const taskCheck = await client.query(
                'SELECT task_id FROM tasks WHERE job_id = $1 AND task_id = $2',
                [jobId, taskId]
            );

            if (taskCheck.rows.length === 0) {
                throw new Error(`Task ${taskId} not found in job ${jobId}`);
            }

            // Delete task dependencies and task
            try {
                await client.query(
                    'DELETE FROM task_deps WHERE job_id = $1 AND (pre_task_id = $2 OR post_task_id = $2)',
                    [jobId, taskId]
                );
            } catch (error) {
                console.log('task_deps table may not exist, skipping...');
            }

            const deleteResult = await client.query(
                'DELETE FROM tasks WHERE job_id = $1 AND task_id = $2 RETURNING task_id',
                [jobId, taskId]
            );

            await client.query('COMMIT');

            return { deletedTaskId: deleteResult.rows[0].task_id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app = express();

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
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : (config.nodeEnv === 'production' ? ['http://localhost:3000', 'http://localhost:3001'] : true),
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Additional headers for development
if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
        res.setHeader('Origin-Agent-Cluster', '?0');
        next();
    });
}

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
// DATABASE CONNECTION
// ============================================================================

const pool = new Pool(config.database);

// Database connection event handlers
pool.on('connect', (client) => {
    console.log('New database client connected');
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

// Initialize database service
const dbService = new DatabaseService(pool);

// ============================================================================
// API ROUTES
// ============================================================================

const apiRouter = express.Router();

// Get all jobs with task statistics
apiRouter.get("/jobs", async (req, res, next) => {
    try {
        const result = await dbService.getJobsWithStats(req.query, req.query);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Search jobs by various criteria
apiRouter.get("/jobs/search", async (req, res, next) => {
    try {
        const result = await dbService.getJobsWithStats(req.query, req.query);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get job details with all tasks
apiRouter.get("/jobs/:jobId", validateJobId, async (req, res, next) => {
    try {
        const result = await dbService.getJobDetails(req.jobId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get task dependencies
apiRouter.get("/jobs/:jobId/dependencies", validateJobId, async (req, res, next) => {
    try {
        const result = await dbService.getJobDependencies(req.jobId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get streams
apiRouter.get("/streams", async (req, res, next) => {
    try {
        const { limit, offset } = Validator.validatePagination(req.query.limit, req.query.offset);

        const query = `
            SELECT id, job_id, created_at, updated_at
            FROM streams
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        const result = await pool.query(query, [limit, offset]);
        res.json({
            streams: result.rows,
            pagination: { limit, offset, count: result.rows.length }
        });
    } catch (error) {
        next(error);
    }
});

// Delete a job and all its tasks
apiRouter.delete("/jobs/:jobId", validateJobId, async (req, res, next) => {
    try {
        const result = await dbService.deleteJob(req.jobId);
        res.json({
            message: "Job deleted successfully",
            ...result
        });
    } catch (error) {
        next(error);
    }
});

// Delete a specific task
apiRouter.delete("/jobs/:jobId/tasks/:taskId", validateJobId, async (req, res, next) => {
    try {
        const { taskId } = req.params;
        if (!taskId) {
            return res.status(400).json({
                error: "Invalid task ID",
                message: "Task ID is required"
            });
        }

        const result = await dbService.deleteTask(req.jobId, taskId);
        res.json({
            message: "Task deleted successfully",
            ...result
        });
    } catch (error) {
        next(error);
    }
});

// Health check endpoint
apiRouter.get("/health", async (req, res) => {
    try {
        const dbConnected = await dbService.testConnection();
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
            SELECT table_name, column_name, data_type, is_nullable
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
app.use(ErrorHandler.handle);

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

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

// ============================================================================
// SERVER STARTUP
// ============================================================================

const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Kumo server running on http://0.0.0.0:${config.port}`);
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
module.exports = { app, pool, config, dbService };
