const express = require('express');
const { validateJobId, validateTaskId } = require('../middleware/validation');
const Validator = require('../utils/Validator');

const router = express.Router();

// Initialize database service (will be set by app.js)
let dbService;
let pool;

const setDependencies = (databaseService, databasePool) => {
    dbService = databaseService;
    pool = databasePool;
};

// Get all jobs with task statistics
router.get("/jobs", async (req, res, next) => {
    try {
        const result = await dbService.getJobsWithStats(req.query, req.query);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Search jobs by various criteria
router.get("/jobs/search", async (req, res, next) => {
    try {
        const result = await dbService.getJobsWithStats(req.query, req.query);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get job details with all tasks
router.get("/jobs/:jobId", validateJobId, async (req, res, next) => {
    try {
        const result = await dbService.getJobDetails(req.jobId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get task dependencies
router.get("/jobs/:jobId/dependencies", validateJobId, async (req, res, next) => {
    try {
        const result = await dbService.getJobDependencies(req.jobId);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Get streams
router.get("/streams", async (req, res, next) => {
    try {
        const result = await dbService.getStreams(req.query);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Delete a job and all its tasks
router.delete("/jobs/:jobId", validateJobId, async (req, res, next) => {
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
router.delete("/jobs/:jobId/tasks/:taskId", validateJobId, validateTaskId, async (req, res, next) => {
    try {
        const result = await dbService.deleteTask(req.jobId, req.taskId);
        res.json({
            message: "Task deleted successfully",
            ...result
        });
    } catch (error) {
        next(error);
    }
});

// Health check endpoint
router.get("/health", async (req, res) => {
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
            environment: process.env.NODE_ENV || 'development'
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
router.get("/schema", async (req, res) => {
    try {
        const result = await dbService.getSchema();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            error: "Failed to get schema info",
            message: error.message
        });
    }
});

module.exports = { router, setDependencies };
