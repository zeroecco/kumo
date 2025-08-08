const Validator = require('../utils/Validator');

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

const validateTaskId = (req, res, next) => {
    try {
        const taskId = Validator.validateTaskId(req.params.taskId);
        req.taskId = taskId;
        next();
    } catch (error) {
        res.status(400).json({
            error: "Invalid task ID",
            message: error.message
        });
    }
};

module.exports = {
    validateJobId,
    validateTaskId
};
