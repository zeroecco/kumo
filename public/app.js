/**
 * Kumo - Bento Job Monitor Frontend
 * Production-grade monitoring dashboard
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class StateManager {
    constructor() {
        this._state = {
            jobs: [],
            isConnected: false,
            currentJobDetail: null,
            currentChart: null,
            refreshInterval: null,
            retryCount: 0,
            maxRetries: 3,
            retryDelay: 5000,
            searchTerm: '',
            isLoading: false,
            error: null,
            statusFilters: ['running', 'done', 'failed']
        };
        this._listeners = new Set();
    }

    // Immutable state updates
    update(updates) {
        this._state = { ...this._state, ...updates };
        this._notifyListeners();
    }

    get state() {
        return { ...this._state }; // Return immutable copy
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notifyListeners() {
        this._listeners.forEach(listener => listener(this._state));
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    API_BASE_URL: window.location.origin + '/api',
    REFRESH_INTERVAL: 10000, // 10 seconds
    CONNECTION_TIMEOUT: 5000,
    MAX_JOBS_DISPLAY: 100,
    TOOLTIP_DELAY: 300,
    SEARCH_DEBOUNCE: 500,
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const Utils = {
    /**
     * Debounce function to limit API calls
     */
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Format timestamp for display
     */
    formatTimestamp: (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp).toLocaleString();
    },

    /**
     * Calculate percentage safely
     */
    calculatePercentage: (value, total) => {
        if (!total || total === 0) return 0;
        return Math.round((value / total) * 100);
    },

    /**
     * Sanitize HTML content
     */
    sanitizeHtml: (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Generate unique ID
     */
    generateId: () => {
        return 'id_' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Create DOM element with attributes
     */
    createElement: (tag, attributes = {}, children = []) => {
        const element = document.createElement(tag);
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'innerHTML') {
                element.innerHTML = value;
            } else {
                element.setAttribute(key, value);
            }
        });
        children.forEach(child => element.appendChild(child));
        return element;
    },

    /**
     * Query selector with caching
     */
    querySelector: (() => {
        const cache = new Map();
        return (selector) => {
            if (!cache.has(selector)) {
                cache.set(selector, document.querySelector(selector));
            }
            return cache.get(selector);
        };
    })(),

    /**
     * Validate required parameters
     */
    validateParams: (params, required = []) => {
        const missing = required.filter(param => !params[param]);
        if (missing.length > 0) {
            throw new Error(`Missing required parameters: ${missing.join(', ')}`);
        }
    }
};

// ============================================================================
// ERROR HANDLING
// ============================================================================

class ErrorHandler {
    static handle(error, context = '') {
        console.error(`Error in ${context}:`, error);

        const errorMessage = error.message || 'An unexpected error occurred';

        // Update state with error
        stateManager.update({
            error: errorMessage,
            isLoading: false
        });

        // Show user-friendly error message
        UIComponents.showError(
            document.getElementById('jobs-container'),
            `Error ${context ? `in ${context}` : ''}: ${errorMessage}`
        );
    }

    static clear() {
        stateManager.update({ error: null });
    }
}

// ============================================================================
// API SERVICE
// ============================================================================

class ApiService {
    static async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.CONNECTION_TIMEOUT);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    static async checkHealth() {
        try {
            const response = await this.request('/health');
            return response.status === 'healthy';
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }

    static async getJobs(limit = 50, offset = 0) {
        return await this.request(`/jobs?limit=${limit}&offset=${offset}`);
    }

    static async getJobsByStatus(status, limit = 100, offset = 0) {
        return await this.request(`/jobs?state=${status}&limit=${limit}&offset=${offset}`);
    }

    static async searchJobs(searchParams = {}) {
        const params = new URLSearchParams();

        // Validate and add parameters
        Object.entries(searchParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                params.append(key, value);
            }
        });

        return await this.request(`/jobs/search?${params.toString()}`);
    }

    static async getJobDetails(jobId) {
        Utils.validateParams({ jobId }, ['jobId']);
        return await this.request(`/jobs/${jobId}`);
    }

    static async getJobDependencies(jobId) {
        Utils.validateParams({ jobId }, ['jobId']);
        return await this.request(`/jobs/${jobId}/dependencies`);
    }

    static async getStreams(limit = 50, offset = 0) {
        return await this.request(`/streams?limit=${limit}&offset=${offset}`);
    }

    static async deleteJob(jobId) {
        Utils.validateParams({ jobId }, ['jobId']);
        return await this.request(`/jobs/${jobId}`, { method: 'DELETE' });
    }

    static async deleteTask(jobId, taskId) {
        Utils.validateParams({ jobId, taskId }, ['jobId', 'taskId']);
        return await this.request(`/jobs/${jobId}/tasks/${taskId}`, { method: 'DELETE' });
    }

    static async clearCompletedJobs() {
        return await this.request('/jobs/completed', { method: 'DELETE' });
    }

    static async clearFailedJobs() {
        return await this.request('/jobs/failed', { method: 'DELETE' });
    }
}

// ============================================================================
// CONNECTION MANAGER
// ============================================================================

class ConnectionManager {
    static updateStatus(connected, message = '') {
        const statusDot = Utils.querySelector('.status-dot');
        const statusText = Utils.querySelector('.status-text');

        stateManager.update({ isConnected: connected });

        if (connected) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connected';
            stateManager.update({ retryCount: 0 });
        } else {
            statusDot.className = 'status-dot';
            statusText.textContent = message || 'Disconnected';
        }
    }

    static async checkConnection() {
        try {
            const isHealthy = await ApiService.checkHealth();
            this.updateStatus(isHealthy);
            return isHealthy;
        } catch (error) {
            this.updateStatus(false, 'Connection Failed');
            return false;
        }
    }

    static async retryConnection() {
        const state = stateManager.state;

        if (state.retryCount >= CONFIG.MAX_RETRIES) {
            this.updateStatus(false, 'Max retries exceeded');
            return false;
        }

        stateManager.update({
            retryCount: state.retryCount + 1
        });

        const delay = CONFIG.RETRY_DELAY * Math.pow(2, state.retryCount - 1);

        setTimeout(async () => {
            const connected = await this.checkConnection();
            if (connected) {
                JobManager.loadJobs();
            } else {
                this.retryConnection();
            }
        }, delay);
    }
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

class UIComponents {
    static showLoading(container, message = 'Loading...') {
        container.innerHTML = `<div class="loading">${message}</div>`;
    }

    static showError(container, message) {
        container.innerHTML = `
            <div class="error">
                <h3>Error</h3>
                <p>${Utils.sanitizeHtml(message)}</p>
                <button onclick="JobManager.loadJobs()">Retry</button>
            </div>
        `;
    }

    static createJobCard(job) {
        const jobId = Utils.sanitizeHtml(job.id);
        const state = Utils.sanitizeHtml(job.state);
        const error = job.error ? Utils.sanitizeHtml(job.error) : '';
        const userId = job.user_id ? Utils.sanitizeHtml(job.user_id) : 'N/A';
        const taskCount = parseInt(job.task_count) || 0;
        const completedTasks = parseInt(job.completed_tasks) || 0;
        const runningTasks = parseInt(job.running_tasks) || 0;
        const failedTasks = parseInt(job.failed_tasks) || 0;

        // Calculate progress based on completed tasks
        let progressPercent = 0;
        if (taskCount > 0) {
            progressPercent = Utils.calculatePercentage(completedTasks, taskCount);
        }

        // Determine progress color based on job state
        let progressColor = '#27ae60'; // Default green
        if (job.state === 'failed') {
            progressColor = '#e74c3c'; // Red for failed
        } else if (job.state === 'running') {
            progressColor = '#f39c12'; // Orange for running
        } else if (progressPercent === 100) {
            progressColor = '#27ae60'; // Green for completed
        }

        return `
            <div class="job-card" data-job-id="${jobId}">
                <div class="job-header">
                    <span class="job-id">${jobId}</span>
                    <span class="job-state state-${state.toLowerCase()}">${state}</span>
                </div>

                <div class="job-stats">
                    <div class="stat">
                        <div class="stat-value">${job.task_count || 0}</div>
                        <div class="stat-label">Total Tasks</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${job.completed_tasks || 0}</div>
                        <div class="stat-label">Completed</div>
                        <div class="mini-progress">
                            <div class="mini-progress-fill completed" style="width: ${taskCount > 0 ? (completedTasks / taskCount) * 100 : 0}%"></div>
                        </div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${job.running_tasks || 0}</div>
                        <div class="stat-label">Running</div>
                        <div class="mini-progress">
                            <div class="mini-progress-fill running" style="width: ${taskCount > 0 ? (runningTasks / taskCount) * 100 : 0}%"></div>
                        </div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${job.failed_tasks || 0}</div>
                        <div class="stat-label">Failed</div>
                        <div class="mini-progress">
                            <div class="mini-progress-fill failed" style="width: ${taskCount > 0 ? (failedTasks / taskCount) * 100 : 0}%"></div>
                        </div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${job.effective_hz_formatted || 'N/A'}</div>
                        <div class="stat-label">Effective Hz</div>
                    </div>
                </div>

                ${error ? `<div class="job-error">Error: ${error}</div>` : ''}
                <div class="job-progress">
                    <div class="job-progress-header">
                        <span class="job-progress-label">Overall Progress</span>
                        <span class="job-progress-percentage">${progressPercent}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressPercent}%; background: ${progressColor};"></div>
                    </div>
                    <div class="progress-details">
                        <small>${completedTasks} of ${taskCount} tasks completed</small>
                        <div class="progress-status">
                            <span class="status-indicator ${job.state.toLowerCase()}">${job.state}</span>
                            ${runningTasks > 0 ? `<span class="active-tasks">${runningTasks} active</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="job-actions">
                    <button class="view-details-btn" data-job-id="${jobId}">View Details</button>
                    <button class="delete-job-btn" data-job-id="${jobId}">Delete</button>
                </div>
            </div>
        `;
    }

    static createTaskItem(task) {
        const taskId = Utils.sanitizeHtml(task.task_id);
        const state = Utils.sanitizeHtml(task.state);
        const progress = task.progress || 0;
        const error = task.error ? Utils.sanitizeHtml(task.error) : '';

        return `
            <div class="task-item ${state.toLowerCase()}" data-task-id="${taskId}">
                <div class="task-header">
                    <span class="task-id">${taskId}</span>
                    <span class="task-state">${state}</span>
                </div>

                <div class="task-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress * 100}%"></div>
                    </div>
                </div>

                ${error ? `<div class="task-error">Error: ${error}</div>` : ''}

                <div class="task-actions">
                    <button class="delete-task-btn" data-task-id="${taskId}">Delete</button>
                </div>
            </div>
        `;
    }
}

// ============================================================================
// JOB MANAGER
// ============================================================================

class JobManager {
    static async loadJobs() {
        const container = document.getElementById('jobs-container');

        try {
            stateManager.update({ isLoading: true, error: null });

            // Check connection first
            const connected = await ConnectionManager.checkConnection();
            if (!connected) {
                throw new Error('Cannot connect to Kumo API. Please check if the server is running.');
            }

            UIComponents.showLoading(container, 'Loading jobs...');

            // Get jobs for each selected status filter
            const state = stateManager.state;
            const allJobs = [];

            // Valid job states that exist in the database
            const validJobStates = ['running', 'done', 'failed'];

            // Fetch jobs for each selected status (skip 'pending' as it's not a valid job state)
            for (const status of state.statusFilters) {
                if (validJobStates.includes(status)) {
                    const response = await ApiService.getJobsByStatus(status);
                    allJobs.push(...(response.jobs || []));
                }
            }

            stateManager.update({
                jobs: allJobs,
                isLoading: false
            });

            JobManager.displayJobs();
            ConnectionManager.updateStatus(true);

        } catch (error) {
            ErrorHandler.handle(error, 'loading jobs');
            ConnectionManager.retryConnection();
        }
    }

    static displayJobs() {
        const container = document.getElementById('jobs-container');
        const state = stateManager.state;

        if (!state.jobs || state.jobs.length === 0) {
            container.innerHTML = '<div class="loading">No jobs found</div>';
            return;
        }

        const jobsHtml = state.jobs
            .slice(0, CONFIG.MAX_JOBS_DISPLAY)
            .map(job => UIComponents.createJobCard(job))
            .join('');

        container.innerHTML = `
            <div class="jobs-grid">
                ${jobsHtml}
            </div>
        `;

        JobManager._attachJobEventListeners();
    }

    static _attachJobEventListeners() {
        const container = document.getElementById('jobs-container');

        // Job card click handlers
        container.querySelectorAll('.job-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.classList.contains('view-details-btn')) {
                    const jobId = card.dataset.jobId;
                    JobManager.viewJobDetails(jobId);
                }
            });
        });

        // View details buttons
        container.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.dataset.jobId;
                JobManager.viewJobDetails(jobId);
            });
        });

        // Delete job buttons
        container.querySelectorAll('.delete-job-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.dataset.jobId;
                JobManager.deleteJob(jobId);
            });
        });
    }

    static async viewJobDetails(jobId) {
        try {
            Utils.validateParams({ jobId }, ['jobId']);

            if (!stateManager.state.isConnected) {
                throw new Error('Not connected to API. Please check the connection.');
            }

            const jobDetail = await ApiService.getJobDetails(jobId);
            stateManager.update({ currentJobDetail: jobDetail });

            JobManager.displayJobDetails(jobDetail);
            ModalManager.open();

        } catch (error) {
            ErrorHandler.handle(error, 'loading job details');
        }
    }

    static async deleteJob(jobId) {
        if (!confirm(`Are you sure you want to delete job ${jobId}? This will also delete all associated tasks.`)) {
            return;
        }

        try {
            Utils.validateParams({ jobId }, ['jobId']);

            if (!stateManager.state.isConnected) {
                throw new Error('Not connected to API. Please check the connection.');
            }

            await ApiService.deleteJob(jobId);
            await JobManager.loadJobs(); // Refresh the list

        } catch (error) {
            ErrorHandler.handle(error, 'deleting job');
        }
    }

    static async deleteTask(jobId, taskId) {
        if (!confirm(`Are you sure you want to delete task ${taskId}?`)) {
            return;
        }

        try {
            Utils.validateParams({ jobId, taskId }, ['jobId', 'taskId']);

            if (!stateManager.state.isConnected) {
                throw new Error('Not connected to API. Please check the connection.');
            }

            await ApiService.deleteTask(jobId, taskId);

            // Refresh job details if modal is open
            if (stateManager.state.currentJobDetail) {
                await JobManager.viewJobDetails(jobId);
            }

        } catch (error) {
            ErrorHandler.handle(error, 'deleting task');
        }
    }

    static async clearCompletedJobs() {
        if (!confirm('Are you sure you want to clear all completed jobs? This action cannot be undone.')) {
            return;
        }

        try {
            if (!stateManager.state.isConnected) {
                throw new Error('Not connected to API. Please check the connection.');
            }

            const result = await ApiService.clearCompletedJobs();

            // Show success message
            if (result.deletedJobsCount > 0) {
                alert(`Successfully cleared ${result.deletedJobsCount} completed job(s).`);
            } else {
                alert('No completed jobs found to clear.');
            }

            // Refresh the jobs list
            await JobManager.loadJobs();

        } catch (error) {
            ErrorHandler.handle(error, 'clearing completed jobs');
        }
    }

    static async clearFailedJobs() {
        if (!confirm('Are you sure you want to clear all failed jobs? This action cannot be undone.')) {
            return;
        }

        try {
            if (!stateManager.state.isConnected) {
                throw new Error('Not connected to API. Please check the connection.');
            }

            const result = await ApiService.clearFailedJobs();

            // Show success message
            if (result.deletedJobsCount > 0) {
                alert(`Successfully cleared ${result.deletedJobsCount} failed job(s).`);
            } else {
                alert('No failed jobs found to clear.');
            }

            // Refresh the jobs list
            await JobManager.loadJobs();

        } catch (error) {
            ErrorHandler.handle(error, 'clearing failed jobs');
        }
    }

    static displayJobDetails(jobDetail) {
        const modalContent = document.getElementById('modal-content');
        const job = jobDetail.job;
        const tasks = jobDetail.tasks || [];

        const jobStatsHtml = `
            <div class="job-stats">
                <div class="stat">
                    <div class="stat-value">${tasks.length}</div>
                    <div class="stat-label">Total Tasks</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${tasks.filter(t => t.state === 'done').length}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${tasks.filter(t => t.state === 'running').length}</div>
                    <div class="stat-label">Running</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${tasks.filter(t => t.state === 'failed').length}</div>
                    <div class="stat-label">Failed</div>
                </div>
            </div>
        `;

        const errorHtml = job.error ? `<div class="job-error">Error: ${Utils.sanitizeHtml(job.error)}</div>` : '';

        const tasksHtml = tasks.length === 0
            ? '<p>No tasks found for this job.</p>'
            : tasks.map(task => UIComponents.createTaskItem(task)).join('');

        modalContent.innerHTML = `
            <h2>Job Details: ${Utils.sanitizeHtml(job.id)}</h2>
            <div class="job-header">
                <div class="job-state state-${job.state.toLowerCase()}">${Utils.sanitizeHtml(job.state)}</div>
            </div>

            ${jobStatsHtml}
            ${errorHtml}

            <div class="view-toggle">
                <button class="active" data-view="list">Details</button>
                <button data-view="gantt">Timeline</button>
            </div>

            <div id="task-list-view">
                <div class="task-list">
                    <h3>Tasks (${tasks.length})</h3>
                    ${tasksHtml}
                </div>
            </div>

            <div id="timeline-view" class="hidden">
                <div class="full-timeline-container">
                    <div class="timeline-header">
                        <h3>Task Timeline Progression</h3>
                        <div class="timeline-bounds">
                            <span class="timeline-start"></span>
                            <span class="timeline-end"></span>
                        </div>
                    </div>
                    <div class="timeline-container">
                        <!-- Timeline content will be dynamically generated -->
                    </div>
                    <div class="timeline-summary">
                        <h3>Task Summary</h3>
                        <div class="summary-stats">
                            <div class="summary-stat">
                                <div class="stat-number">${tasks.filter(t => t.state === 'done').length}</div>
                                <div class="stat-label">Completed</div>
                            </div>
                            <div class="summary-stat">
                                <div class="stat-number">${tasks.filter(t => t.state === 'running').length}</div>
                                <div class="stat-label">Running</div>
                            </div>
                            <div class="summary-stat">
                                <div class="stat-number">${tasks.filter(t => t.state === 'pending').length}</div>
                                <div class="stat-label">Pending</div>
                            </div>
                            <div class="summary-stat">
                                <div class="stat-number">${tasks.filter(t => t.state === 'failed').length}</div>
                                <div class="stat-label">Failed</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._attachModalEventListeners(jobDetail);
    }

    static _attachModalEventListeners(jobDetail) {
        const modalContent = document.getElementById('modal-content');

        // Add event listeners for view toggle buttons
        const viewButtons = modalContent.querySelectorAll('.view-toggle button');
        viewButtons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                const view = btn.dataset.view;
                this.switchView(view, event);
            });
        });

        // Add event listeners for delete task buttons
        const deleteTaskButtons = modalContent.querySelectorAll('.delete-task-btn');
        deleteTaskButtons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const taskId = btn.dataset.taskId;
                const jobId = jobDetail.job.id;
                this.deleteTask(jobId, taskId);
            });
        });
    }

    static switchView(view, event) {
        const listView = document.getElementById('task-list-view');
        const timelineView = document.getElementById('timeline-view');
        const buttons = document.querySelectorAll('.view-toggle button');

        // Update button states
        buttons.forEach(btn => {
            btn.classList.remove('active');
            btn.style.transform = 'scale(0.95)';
        });

        setTimeout(() => {
            if (event && event.target) {
                event.target.classList.add('active');
                event.target.style.transform = 'scale(1)';
            }

            if (view === 'list') {
                if (listView) listView.classList.remove('hidden');
                if (timelineView) timelineView.classList.add('hidden');
                if (stateManager.state.currentChart) {
                    stateManager.state.currentChart.destroy();
                    stateManager.update({ currentChart: null });
                }
            } else if (view === 'gantt') {
                if (listView) listView.classList.add('hidden');
                if (timelineView) timelineView.classList.remove('hidden');
                this.createTimelineChart();
            }
        }, 100);
    }

    static createTimelineChart() {
        const jobDetail = stateManager.state.currentJobDetail;

        if (!jobDetail || !jobDetail.tasks || jobDetail.tasks.length === 0) {
            return;
        }

        const tasks = jobDetail.tasks;
        const now = new Date();

        // Create timeline data - exclude pending tasks
        const taskData = tasks
            .filter(task => task.state !== 'pending' && task.state !== 'ready') // Exclude pending tasks from timeline
            .map(task => {
                let startTime, endTime;

                try {
                    startTime = task.started_at ? new Date(task.started_at) : new Date(task.created_at);
                    endTime = task.updated_at ? new Date(task.updated_at) : now;

                    // Validate dates
                    if (isNaN(startTime.getTime())) {
                        startTime = new Date();
                    }
                    if (isNaN(endTime.getTime())) {
                        endTime = new Date();
                    }
                } catch (error) {
                    console.warn('Invalid date for task:', task.task_id, error);
                    startTime = new Date();
                    endTime = new Date();
                }

                return {
                    task: task.task_id,
                    state: task.state,
                    progress: task.progress || 0,
                    startTime: startTime,
                    endTime: endTime,
                    error: task.error,
                    retries: task.retries || 0,
                    maxRetries: task.max_retries || 0
                };
            });

        // Sort tasks by start time
        taskData.sort((a, b) => a.startTime - b.startTime);

        // Find timeline bounds
        const allStartTimes = taskData.map(d => d.startTime);
        const allEndTimes = taskData.map(d => d.endTime);
        const timelineStart = new Date(Math.min(...allStartTimes));
        const timelineEnd = new Date(Math.max(...allEndTimes));

        // Handle edge case where all times are the same
        if (timelineStart.getTime() === timelineEnd.getTime()) {
            timelineEnd.setTime(timelineEnd.getTime() + 60000); // Add 1 minute
        }

        // Create timeline data
        const timelineData = taskData.map(task => {
            const startOffset = (task.startTime - timelineStart) / (timelineEnd - timelineStart) * 100;
            const duration = Math.max((task.endTime - task.startTime) / (timelineEnd - timelineStart) * 100, 1); // Minimum 1% width

            return {
                task: task.task,
                state: task.state,
                progress: task.progress,
                startOffset: Math.max(startOffset, 0), // Ensure non-negative
                duration: duration,
                startTime: task.startTime,
                endTime: task.endTime,
                error: task.error,
                retries: task.retries,
                maxRetries: task.maxRetries
            };
        });

        // Update timeline bounds display
        const timelineStartSpan = document.querySelector('.timeline-start');
        const timelineEndSpan = document.querySelector('.timeline-end');
        if (timelineStartSpan) timelineStartSpan.textContent = timelineStart.toLocaleString();
        if (timelineEndSpan) timelineEndSpan.textContent = timelineEnd.toLocaleString();

        // Populate timeline container
        const timelineContainer = document.querySelector('.timeline-container');
        if (timelineContainer) {
            if (timelineData.length === 0) {
                timelineContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No timeline data available</p>';
                return;
            }

            timelineContainer.innerHTML = timelineData.map(task => `
                <div class="timeline-row">
                    <div class="task-label">${Utils.sanitizeHtml(task.task)}</div>
                    <div class="timeline-bar-container">
                        <div class="timeline-bar ${task.state.toLowerCase()}"
                             style="left: ${task.startOffset}%; width: ${Math.max(task.duration, 2)}%;">
                            <div class="bar-progress" style="width: ${task.progress * 100}%"></div>
                            <div class="bar-tooltip">
                                <strong>${Utils.sanitizeHtml(task.task)}</strong><br>
                                State: ${Utils.sanitizeHtml(task.state)}<br>
                                Progress: ${Math.round(task.progress * 100)}%<br>
                                Started: ${task.startTime.toLocaleTimeString()}<br>
                                Duration: ${Math.round((task.endTime - task.startTime) / 1000)}s<br>
                                Retries: ${task.retries}/${task.maxRetries}<br>
                                ${task.error ? `Error: ${Utils.sanitizeHtml(task.error)}` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');

            // Add event listeners for tooltips
            const bars = timelineContainer.querySelectorAll('.timeline-bar');
            bars.forEach(bar => {
                bar.addEventListener('mouseenter', function () {
                    this.querySelector('.bar-tooltip').style.display = 'block';
                });
                bar.addEventListener('mouseleave', function () {
                    this.querySelector('.bar-tooltip').style.display = 'none';
                });
            });
        }
    }
}

// ============================================================================
// FILTER MANAGER
// ============================================================================

class FilterManager {
    static toggleStatusFilter() {
        const dropdown = document.getElementById('status-filter-dropdown');
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }

    static updateStatusFilter() {
        const checkboxes = document.querySelectorAll('#status-filter-dropdown input[type="checkbox"]');
        const selectedStatuses = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        stateManager.update({ statusFilters: selectedStatuses });

        // Update filter count display
        this.updateFilterCount(selectedStatuses.length);

        // Reload jobs from server with new filters
        JobManager.loadJobs();
    }

    static updateFilterCount(count) {
        const filterCount = document.querySelector('.filter-count');
        if (count === 3) {
            // All selected, don't show count
            filterCount.textContent = '';
        } else {
            filterCount.textContent = `(${count})`;
        }
    }
}

// ============================================================================
// SEARCH MANAGER
// ============================================================================

class SearchManager {
    static async performSearch() {
        const searchInput = Utils.querySelector('#search-input');
        const searchTerm = searchInput.value.trim();
        const clearBtn = Utils.querySelector('.clear-search-btn');

        if (!searchTerm) {
            this.clearSearch();
            return;
        }

        const container = document.getElementById('jobs-container');

        try {
            stateManager.update({ isLoading: true, error: null });

            // Check connection first
            const connected = await ConnectionManager.checkConnection();
            if (!connected) {
                throw new Error('Cannot connect to Kumo API. Please check if the server is running.');
            }

            UIComponents.showLoading(container, 'Searching jobs...');

            // Perform search with partial matching
            const response = await ApiService.searchJobs({
                jobId: searchTerm,
                partial: 'true',
                limit: CONFIG.MAX_JOBS_DISPLAY
            });

            stateManager.update({
                jobs: response.jobs || [],
                searchTerm,
                isLoading: false
            });

            JobManager.displayJobs();
            ConnectionManager.updateStatus(true);

            // Show clear button
            clearBtn.style.display = 'inline-block';

        } catch (error) {
            ErrorHandler.handle(error, 'searching jobs');
        }
    }

    static clearSearch() {
        const searchInput = Utils.querySelector('#search-input');
        const clearBtn = Utils.querySelector('.clear-search-btn');

        searchInput.value = '';
        clearBtn.style.display = 'none';
        stateManager.update({ searchTerm: '' });
        JobManager.loadJobs();
    }
}

// ============================================================================
// MODAL MANAGER
// ============================================================================

class ModalManager {
    static open() {
        document.getElementById('jobModal').style.display = 'block';
    }

    static close() {
        document.getElementById('jobModal').style.display = 'none';
        if (stateManager.state.currentChart) {
            stateManager.state.currentChart.destroy();
            stateManager.update({ currentChart: null });
        }
        stateManager.update({ currentJobDetail: null });
    }
}

// ============================================================================
// DASHBOARD MANAGER
// ============================================================================

class DashboardManager {
    static charts = {};
    static currentTimeRange = '24h';

    static async refreshDashboard() {
        try {
            const timeRange = document.getElementById('time-range').value;
            this.currentTimeRange = timeRange;

            await this.loadMetrics();
            await this.loadCharts();
            await this.loadAnalytics();
        } catch (error) {
            ErrorHandler.handle(error, 'loading dashboard');
        }
    }

    static async loadMetrics() {
        // Always load fresh jobs data for the dashboard
        await JobManager.loadJobs();
        const jobs = stateManager.state.jobs;

        const metrics = this.calculateMetrics(jobs);
        this.updateMetricsDisplay(metrics);
    }

    static calculateMetrics(jobs) {
        const totalJobs = jobs.length;
        const successfulJobs = jobs.filter(job => job.state === 'done').length;
        const failedJobs = jobs.filter(job => job.state === 'failed').length;
        const runningJobs = jobs.filter(job => job.state === 'running').length;
        const pendingJobs = jobs.filter(job => job.state === 'pending').length;

        const successRate = totalJobs > 0 ? (successfulJobs / totalJobs * 100).toFixed(1) : 0;
        const avgExecutionTime = this.calculateAverageExecutionTime(jobs);
        const activeJobs = runningJobs + pendingJobs;

        return {
            totalJobs,
            successRate,
            avgExecutionTime,
            activeJobs,
            successfulJobs,
            failedJobs,
            runningJobs,
            pendingJobs
        };
    }

    static calculateAverageExecutionTime(jobs) {
        const completedJobs = jobs.filter(job => job.state === 'done');
        if (completedJobs.length === 0) return '0s';

        // Calculate execution time based on task count and completion status
        const totalTime = completedJobs.reduce((sum, job) => {
            const taskCount = parseInt(job.task_count) || 0;
            const completedTasks = parseInt(job.completed_tasks) || 0;

            // Use completed tasks as a proxy for execution time
            // Each completed task represents some execution time
            const executionTime = completedTasks > 0 ? completedTasks * 45 : taskCount * 30;
            return sum + executionTime;
        }, 0);

        const avgSeconds = totalTime / completedJobs.length;
        return this.formatDuration(avgSeconds);
    }

    static formatDuration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        return `${Math.round(seconds / 3600)}h`;
    }

    static updateMetricsDisplay(metrics) {
        document.getElementById('total-jobs').textContent = metrics.totalJobs;
        document.getElementById('success-rate').textContent = `${metrics.successRate}%`;
        document.getElementById('avg-execution-time').textContent = metrics.avgExecutionTime;
        document.getElementById('active-jobs').textContent = metrics.activeJobs;

        // Update change indicators based on real data
        const successRateChange = metrics.successRate > 0 ? `+${metrics.successRate}%` : `${metrics.successRate}%`;
        const activeJobsChange = metrics.activeJobs > 0 ? `+${metrics.activeJobs}` : metrics.activeJobs;

        document.getElementById('jobs-change').textContent = metrics.totalJobs > 0 ? `+${metrics.totalJobs}` : '0';
        document.getElementById('success-change').textContent = successRateChange;
        document.getElementById('time-change').textContent = metrics.avgExecutionTime;
        document.getElementById('active-change').textContent = activeJobsChange;
    }

    static async loadCharts() {
        // Use fresh jobs data from state manager
        const jobs = stateManager.state.jobs;
        if (!jobs || jobs.length === 0) return;

        this.createStatusChart(jobs);
        this.createExecutionTimeChart(jobs);
        this.createDailyJobsChart(jobs);
        this.createSuccessRateChart(jobs);
    }

    static createStatusChart(jobs) {
        const ctx = document.getElementById('status-chart');
        if (!ctx) return;

        const statusCounts = {
            done: jobs.filter(job => job.state === 'done').length,
            running: jobs.filter(job => job.state === 'running').length,
            failed: jobs.filter(job => job.state === 'failed').length,
            pending: jobs.filter(job => job.state === 'pending').length
        };

        if (this.charts.statusChart) {
            this.charts.statusChart.destroy();
        }

        this.charts.statusChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Completed', 'Running', 'Failed', 'Pending'],
                datasets: [{
                    data: [statusCounts.done, statusCounts.running, statusCounts.failed, statusCounts.pending],
                    backgroundColor: ['#27ae60', '#f39c12', '#e74c3c', '#95a5a6'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    static createExecutionTimeChart(jobs) {
        const ctx = document.getElementById('execution-time-chart');
        if (!ctx) return;

        // Use real job data to show task completion distribution
        const completedJobs = jobs.filter(job => job.state === 'done');
        if (completedJobs.length === 0) return;

        // Group jobs by task count ranges
        const taskRanges = {
            '1-5': 0,
            '6-10': 0,
            '11-20': 0,
            '21-50': 0,
            '50+': 0
        };

        completedJobs.forEach(job => {
            const taskCount = parseInt(job.task_count) || 0;
            if (taskCount <= 5) taskRanges['1-5']++;
            else if (taskCount <= 10) taskRanges['6-10']++;
            else if (taskCount <= 20) taskRanges['11-20']++;
            else if (taskCount <= 50) taskRanges['21-50']++;
            else taskRanges['50+']++;
        });

        const labels = Object.keys(taskRanges);
        const data = Object.values(taskRanges);

        if (this.charts.executionTimeChart) {
            this.charts.executionTimeChart.destroy();
        }

        this.charts.executionTimeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jobs by Task Count',
                    data: data,
                    backgroundColor: '#3498db',
                    borderColor: '#2980b9',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Jobs'
                        }
                    }
                }
            }
        });
    }

    static createDailyJobsChart(jobs) {
        const ctx = document.getElementById('daily-jobs-chart');
        if (!ctx) return;

        // Use real job data to create a job status distribution chart
        const statusCounts = {
            done: 0,
            running: 0,
            failed: 0,
            pending: 0
        };

        jobs.forEach(job => {
            const state = job.state || 'pending';
            if (statusCounts.hasOwnProperty(state)) {
                statusCounts[state]++;
            } else {
                statusCounts.pending++;
            }
        });

        const labels = ['Completed', 'Running', 'Failed', 'Pending'];
        const data = [statusCounts.done, statusCounts.running, statusCounts.failed, statusCounts.pending];

        if (this.charts.dailyJobsChart) {
            this.charts.dailyJobsChart.destroy();
        }

        this.charts.dailyJobsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Job Status Distribution',
                    data: data,
                    backgroundColor: ['#27ae60', '#f39c12', '#e74c3c', '#95a5a6'],
                    borderColor: ['#27ae60', '#f39c12', '#e74c3c', '#95a5a6'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Jobs'
                        }
                    }
                }
            }
        });
    }

    static createSuccessRateChart(jobs) {
        const ctx = document.getElementById('success-rate-chart');
        if (!ctx) return;

        // Calculate real success rate based on job states
        const totalJobs = jobs.length;
        if (totalJobs === 0) return;

        const completedJobs = jobs.filter(job => job.state === 'done').length;
        const failedJobs = jobs.filter(job => job.state === 'failed').length;
        const successRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

        // Create a pie chart showing success vs failure distribution
        const labels = ['Successful', 'Failed', 'Other'];
        const data = [
            completedJobs,
            failedJobs,
            totalJobs - completedJobs - failedJobs
        ];

        if (this.charts.successRateChart) {
            this.charts.successRateChart.destroy();
        }

        this.charts.successRateChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#27ae60', '#e74c3c', '#95a5a6'],
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.parsed;
                                const percentage = totalJobs > 0 ? Math.round((value / totalJobs) * 100) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    static async loadAnalytics() {
        const jobs = stateManager.state.jobs;
        if (!jobs || jobs.length === 0) return;

        this.loadTopJobs(jobs);
        this.loadFailedJobs(jobs);
    }

    static loadTopJobs(jobs) {
        const container = document.getElementById('top-jobs-list');
        if (!container) return;

        // Sort jobs by task count (as a proxy for performance)
        const topJobs = jobs
            .filter(job => job.state === 'done')
            .sort((a, b) => (b.task_count || 0) - (a.task_count || 0))
            .slice(0, 5);

        if (topJobs.length === 0) {
            container.innerHTML = '<div class="analytics-item">No completed jobs found</div>';
            return;
        }

        container.innerHTML = topJobs.map(job => `
            <div class="analytics-item">
                <span class="job-id">${Utils.sanitizeHtml(job.id)}</span>
                <span class="job-status state-done">${Utils.sanitizeHtml(job.state)}</span>
                <span class="job-metric">${job.task_count || 0} tasks</span>
            </div>
        `).join('');
    }

    static loadFailedJobs(jobs) {
        const container = document.getElementById('failed-jobs-list');
        if (!container) return;

        const failedJobs = jobs
            .filter(job => job.state === 'failed')
            .slice(0, 5);

        if (failedJobs.length === 0) {
            container.innerHTML = '<div class="analytics-item">No failed jobs found</div>';
            return;
        }

        container.innerHTML = failedJobs.map(job => `
            <div class="analytics-item">
                <span class="job-id">${Utils.sanitizeHtml(job.id)}</span>
                <span class="job-status state-failed">${Utils.sanitizeHtml(job.state)}</span>
                <span class="job-metric">${job.task_count || 0} tasks</span>
            </div>
        `).join('');
    }

}

// ============================================================================
// NAVIGATION MANAGER
// ============================================================================

class NavigationManager {
    static switchPage(pageName) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        // Show selected page
        const targetPage = document.getElementById(`${pageName}-page`);
        if (targetPage) {
            targetPage.classList.add('active');
        }

        // Update navigation buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const activeBtn = document.querySelector(`[data-page="${pageName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        // Load dashboard data if switching to dashboard
        if (pageName === 'dashboard') {
            DashboardManager.refreshDashboard();
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize state manager
const stateManager = new StateManager();

// Event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Initial load
    JobManager.loadJobs();

    // Set up auto-refresh
    const refreshInterval = setInterval(JobManager.loadJobs, CONFIG.REFRESH_INTERVAL);
    stateManager.update({ refreshInterval });

    // Modal event listeners
    window.addEventListener('click', function (event) {
        const modal = document.getElementById('jobModal');
        if (event.target === modal) {
            ModalManager.close();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            ModalManager.close();
        }
    });

    // Refresh button
    const refreshBtn = Utils.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', Utils.debounce(JobManager.loadJobs, 300));
    }

    // Search functionality
    const searchInput = Utils.querySelector('#search-input');
    if (searchInput) {
        // Search on Enter key
        searchInput.addEventListener('keypress', function (event) {
            if (event.key === 'Enter') {
                SearchManager.performSearch();
            }
        });

        // Debounced search on input
        searchInput.addEventListener('input', Utils.debounce(function () {
            if (this.value.trim()) {
                SearchManager.performSearch();
            }
        }, CONFIG.SEARCH_DEBOUNCE));
    }

    // Navigation functionality
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const pageName = this.dataset.page;
            NavigationManager.switchPage(pageName);
        });
    });

    // Dashboard time range selector
    const timeRangeSelect = document.getElementById('time-range');
    if (timeRangeSelect) {
        timeRangeSelect.addEventListener('change', function () {
            DashboardManager.refreshDashboard();
        });
    }

    // Close button
    const closeBtn = Utils.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', ModalManager.close);
    }

    // Close filter dropdown when clicking outside
    document.addEventListener('click', function (event) {
        const filterContainer = document.querySelector('.filter-container');
        const dropdown = document.getElementById('status-filter-dropdown');

        if (filterContainer && dropdown && !filterContainer.contains(event.target)) {
            dropdown.style.display = 'none';
        }
    });
});

// Cleanup on page unload
window.addEventListener('beforeunload', function () {
    const state = stateManager.state;
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
    }
});

// Export functions for global access
(function () {
    window.loadJobs = JobManager.loadJobs.bind(JobManager);
    window.viewJobDetails = JobManager.viewJobDetails.bind(JobManager);
    window.switchView = JobManager.switchView.bind(JobManager);
    window.closeModal = ModalManager.close.bind(ModalManager);
    window.openModal = ModalManager.open.bind(ModalManager);
    window.deleteJob = JobManager.deleteJob.bind(JobManager);
    window.deleteTask = JobManager.deleteTask.bind(JobManager);
    window.clearCompletedJobs = JobManager.clearCompletedJobs.bind(JobManager);
    window.clearFailedJobs = JobManager.clearFailedJobs.bind(JobManager);
    window.performSearch = SearchManager.performSearch.bind(SearchManager);
    window.clearSearch = SearchManager.clearSearch.bind(SearchManager);
    window.refreshDashboard = DashboardManager.refreshDashboard.bind(DashboardManager);
    window.switchPage = NavigationManager.switchPage.bind(NavigationManager);
    window.toggleStatusFilter = FilterManager.toggleStatusFilter.bind(FilterManager);
    window.updateStatusFilter = FilterManager.updateStatusFilter.bind(FilterManager);
})();
