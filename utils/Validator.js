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

    static validateTaskId(taskId) {
        if (!taskId) {
            throw new Error('Task ID is required');
        }
        return taskId;
    }
}

module.exports = Validator;
