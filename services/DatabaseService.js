const QueryBuilder = require('../utils/QueryBuilder');
const Validator = require('../utils/Validator');

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

    async getStreams(pagination = {}) {
        const { limit, offset } = Validator.validatePagination(pagination.limit, pagination.offset);

        const query = `
            SELECT id, job_id, created_at, updated_at
            FROM streams
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.pool.query(query, [limit, offset]);
        return {
            streams: result.rows,
            pagination: { limit, offset, count: result.rows.length }
        };
    }

    async getSchema() {
        const schemaQuery = `
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `;

        const result = await this.pool.query(schemaQuery);

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

        return {
            schema,
            tables: Object.keys(schema)
        };
    }
}

module.exports = DatabaseService;
