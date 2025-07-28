# Kumo - Bento Job Monitor

A real-time web-based monitoring application for [Boundless Bento]([https://github.com/boundless/bento](https://github.com/risc0/risc0/tree/main/bento)) job execution and task management. Kumo provides a comprehensive dashboard for tracking job progress, task dependencies, and execution timelines.

![Kumo Dashboard](https://img.shields.io/badge/status-active-brightgreen)
![Node.js](https://img.shields.io/badge/node.js-v18+-green)
![PostgreSQL](https://img.shields.io/badge/postgresql-v12+-blue)

## 🚀 Features

### Real-time Job Monitoring
- **Live Job Status**: Monitor job states (running, done, failed) in real-time
- **Task Statistics**: Track total, completed, running, pending, and failed tasks
- **Auto-refresh**: Automatic updates every 10 seconds
- **Connection Status**: Real-time API connectivity indicator

### Detailed Job Analytics
- **Job Overview**: Comprehensive job cards with task breakdowns
- **Task Details**: Individual task progress, retries, and error tracking
- **Progress Visualization**: Visual progress bars for task completion
- **Error Reporting**: Detailed error messages and failure analysis

### Advanced Timeline View
- **Gantt Chart Timeline**: Visual representation of task execution over time
- **Task Dependencies**: View task prerequisites and waiting conditions
- **Execution Timeline**: Track task start/end times and duration
- **Interactive Tooltips**: Hover for detailed task information

### Database Integration
- **PostgreSQL Support**: Direct connection to Bento task database
- **Real-time Queries**: Live data fetching from job and task tables
- **Dependency Tracking**: Monitor task dependencies and prerequisites
- **Stream Monitoring**: Track data streams and job outputs

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **PostgreSQL** database with Bento schema
- **Bento** job execution system running

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd kumo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file or set environment variables:
   ```bash
   # Database Configuration
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=taskdb
   POSTGRES_USER=worker
   POSTGRES_PASSWORD=password

   # Server Configuration
   PORT=3001
   ```

4. **Start the application**
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

5. **Access the dashboard**
   Open your browser and navigate to `http://localhost:3001`

## 🗄️ Database Schema

Kumo connects to the Bento PostgreSQL database and expects the following tables:

### Jobs Table
```sql
CREATE TABLE jobs (
    id BIGINT PRIMARY KEY,
    state VARCHAR(50),
    error TEXT,
    user_id VARCHAR(255),
    reported TIMESTAMP
);
```

### Tasks Table
```sql
CREATE TABLE tasks (
    task_id VARCHAR(255),
    job_id BIGINT,
    state VARCHAR(50),
    progress DECIMAL(5,4),
    retries INTEGER,
    max_retries INTEGER,
    timeout_secs INTEGER,
    waiting_on INTEGER,
    error TEXT,
    created_at TIMESTAMP,
    started_at TIMESTAMP,
    updated_at TIMESTAMP,
    task_def JSONB,
    prerequisites JSONB,
    output TEXT
);
```

### Task Dependencies Table
```sql
CREATE TABLE task_deps (
    job_id BIGINT,
    pre_task_id VARCHAR(255),
    post_task_id VARCHAR(255)
);
```

### Streams Table
```sql
CREATE TABLE streams (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `postgres` | PostgreSQL server hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL server port |
| `POSTGRES_DB` | `taskdb` | Database name |
| `POSTGRES_USER` | `worker` | Database username |
| `POSTGRES_PASSWORD` | `password` | Database password |
| `PORT` | `3001` | Web server port |

### Docker Support

For containerized deployment, you can use the provided Docker configuration:

```bash
# Build the Docker image
docker build -t kumo .

# Run with environment variables
docker run -p 3001:3001 \
  -e POSTGRES_HOST=your-db-host \
  -e POSTGRES_DB=taskdb \
  -e POSTGRES_USER=worker \
  -e POSTGRES_PASSWORD=password \
  kumo
```

## 📊 API Endpoints

### Health Check
- `GET /health` - Application health status

### Jobs
- `GET /api/jobs` - List all jobs with task statistics
- `GET /api/jobs/:jobId` - Get detailed job information with tasks
- `GET /api/jobs/:jobId/dependencies` - Get task dependencies for a job

### Streams
- `GET /api/streams` - List all data streams

## 🎨 User Interface

### Dashboard Features
- **Responsive Design**: Works on desktop and mobile devices
- **Modern UI**: Clean, intuitive interface with smooth animations
- **Real-time Updates**: Live data without page refreshes
- **Interactive Elements**: Hover effects and smooth transitions

### Job Cards
- Job ID and current state
- Task statistics (total, completed, running, pending, failed)
- Error messages (if any)
- Quick access to detailed view

### Detailed Job View
- **List View**: Detailed task information with progress bars
- **Timeline View**: Gantt chart showing task execution over time
- **Task Details**: Individual task progress, retries, and errors
- **Dependency Information**: Task prerequisites and waiting conditions

## 🔍 Monitoring Features

### Real-time Monitoring
- **Connection Status**: Visual indicator of API connectivity
- **Auto-refresh**: Automatic data updates every 10 seconds
- **Error Handling**: Graceful handling of connection issues
- **Loading States**: Clear feedback during data fetching

### Task Analytics
- **Progress Tracking**: Visual progress bars for each task
- **State Management**: Color-coded task states (running, done, failed, pending)
- **Retry Logic**: Track retry attempts and maximum retries
- **Timeout Monitoring**: Monitor task timeout settings

### Timeline Analysis
- **Execution Timeline**: Visual representation of task execution order
- **Duration Analysis**: Track task start/end times and duration
- **Dependency Visualization**: See task dependencies and waiting conditions
- **Performance Insights**: Identify bottlenecks and slow tasks

## 🚀 Development

### Project Structure
```
kumo/
├── server.js              # Express server and API endpoints
├── package.json           # Dependencies and scripts
├── public/
│   ├── index.html        # Main dashboard HTML
│   ├── app.js           # Frontend JavaScript
│   └── style.css        # Styling and UI components
└── README.md            # This file
```

### Development Commands
```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Install dependencies
npm install

# Check for linting issues
npm run lint
```

### Adding New Features
1. **Backend**: Add new API endpoints in `server.js`
2. **Frontend**: Update `public/app.js` for new functionality
3. **Styling**: Modify `public/style.css` for UI changes
4. **Testing**: Test with real Bento job data

## 🔧 Troubleshooting

### Common Issues

**Database Connection Failed**
- Verify PostgreSQL is running
- Check database credentials in environment variables
- Ensure database schema matches expected structure

**No Jobs Displayed**
- Confirm Bento jobs are running
- Check database connection
- Verify job data exists in the database

**Timeline View Not Working**
- Ensure tasks have proper timestamps
- Check for JavaScript console errors
- Verify Chart.js library is loaded

### Debug Mode
Enable debug logging by setting the environment variable:
```bash
DEBUG=kumo:* npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow existing code style and conventions
- Add appropriate error handling
- Include comments for complex logic
- Test with real Bento job data
- Update documentation for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Boundless Bento](https://github.com/boundless/bento) - The job execution system being monitored
- [Express.js](https://expressjs.com/) - Web framework
- [PostgreSQL](https://www.postgresql.org/) - Database system
- [Chart.js](https://www.chartjs.org/) - Charting library for timeline visualization

## 📞 Support

For issues, questions, or contributions:
- Create an issue on GitHub
- Check the troubleshooting section above
- Review the API documentation
- Test with your Bento setup

---

**Kumo** - Cloud-like monitoring for your Bento jobs 🌤️
