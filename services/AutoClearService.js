const DatabaseService = require('./DatabaseService');

class AutoClearService {
    constructor(dbService, config) {
        this.dbService = dbService;
        this.config = config;
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Start the auto-clear service if enabled
     */
    start() {
        if (!this.config.autoClear.enabled) {
            console.log('🔧 Auto-clear service is disabled');
            return;
        }

        if (this.isRunning) {
            console.log('⚠️  Auto-clear service is already running');
            return;
        }

        console.log(`🕐 Starting auto-clear service (interval: ${this.config.autoClear.interval / 1000 / 60} minutes)`);

        this.intervalId = setInterval(() => {
            this.performAutoClear();
        }, this.config.autoClear.interval);

        this.isRunning = true;

        // Perform initial clear after a short delay
        setTimeout(() => {
            this.performAutoClear();
        }, 5000);
    }

    /**
     * Stop the auto-clear service
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.isRunning = false;
            console.log('🛑 Auto-clear service stopped');
        }
    }

    /**
     * Perform the actual auto-clear operation
     */
    async performAutoClear() {
        try {
            console.log('🧹 Performing auto-clear...');

            let totalCleared = 0;
            const results = {};

            // Clear completed jobs if enabled
            if (this.config.autoClear.clearCompleted) {
                try {
                    const completedResult = await this.dbService.clearCompletedJobs();
                    results.completed = completedResult;
                    totalCleared += completedResult.deletedJobsCount || 0;
                    console.log(`✅ Cleared ${completedResult.deletedJobsCount || 0} completed jobs`);
                } catch (error) {
                    console.error('❌ Error clearing completed jobs:', error.message);
                    results.completedError = error.message;
                }
            }

            // Clear failed jobs if enabled
            if (this.config.autoClear.clearFailed) {
                try {
                    const failedResult = await this.dbService.clearFailedJobs();
                    results.failed = failedResult;
                    totalCleared += failedResult.deletedJobsCount || 0;
                    console.log(`✅ Cleared ${failedResult.deletedJobsCount || 0} failed jobs`);
                } catch (error) {
                    console.error('❌ Error clearing failed jobs:', error.message);
                    results.failedError = error.message;
                }
            }

            if (totalCleared > 0) {
                console.log(`🎉 Auto-clear completed: ${totalCleared} total jobs cleared`);
            } else {
                console.log('ℹ️  Auto-clear completed: No jobs to clear');
            }

            return results;
        } catch (error) {
            console.error('❌ Auto-clear service error:', error.message);
            throw error;
        }
    }

    /**
     * Get the current status of the auto-clear service
     */
    getStatus() {
        return {
            enabled: this.config.autoClear.enabled,
            running: this.isRunning,
            interval: this.config.autoClear.interval,
            clearCompleted: this.config.autoClear.clearCompleted,
            clearFailed: this.config.autoClear.clearFailed,
            nextRun: this.isRunning ? new Date(Date.now() + this.config.autoClear.interval).toISOString() : null
        };
    }

    /**
     * Manually trigger an auto-clear operation
     */
    async triggerManualClear() {
        console.log('🔧 Manual auto-clear triggered');
        return await this.performAutoClear();
    }
}

module.exports = AutoClearService;
