# Kumo - Task Management System

A clean, modular Node.js/Express application for managing jobs and tasks with PostgreSQL backend.

## 🏗️ Project Structure

```
kumo/
├── config.js                 # Centralized configuration
├── server.js                 # Main application entry point
├── utils/                    # Utility classes
│   ├── QueryBuilder.js      # SQL query builder
│   └── Validator.js         # Input validation utilities
├── services/                 # Business logic
│   └── DatabaseService.js   # Database operations
├── middleware/               # Express middleware
│   ├── errorHandler.js      # Error handling middleware
│   ├── security.js          # Security middleware setup
│   └── validation.js        # Request validation middleware
├── routes/                   # API routes
│   └── api.js               # API endpoint definitions
└── public/                   # Static files
    ├── index.html
    ├── app.js
    └── style.css
```

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   export POSTGRES_HOST=localhost
   export POSTGRES_PORT=5432
   export POSTGRES_DB=taskdb
   export POSTGRES_USER=worker
   export POSTGRES_PASSWORD=password
   export NODE_ENV=development
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

The server will start on `http://localhost:3001`

## 📋 API Endpoints

### Jobs
- `GET /api/jobs` - Get all jobs with task statistics
- `GET /api/jobs/search` - Search jobs by criteria
- `GET /api/jobs/:jobId` - Get job details with tasks
- `GET /api/jobs/:jobId/dependencies` - Get job task dependencies
- `DELETE /api/jobs/:jobId` - Delete job and all tasks
- `DELETE /api/jobs/:jobId/tasks/:taskId` - Delete specific task

### System
- `GET /api/health` - Health check
- `GET /api/schema` - Database schema information
- `GET /api/streams` - Get streams

## 🧹 Code Organization

### Configuration (`config.js`)
- Centralized environment variable management
- Database connection settings
- Rate limiting configuration
- CORS settings

### Utilities (`utils/`)
- **QueryBuilder**: Fluent SQL query builder with parameterized queries
- **Validator**: Input validation for job IDs, pagination, and search parameters

### Services (`services/`)
- **DatabaseService**: All database operations with proper error handling
- Transaction management for delete operations
- Connection pooling and health checks

### Middleware (`middleware/`)
- **errorHandler**: Centralized error handling with appropriate HTTP status codes
- **security**: Security middleware setup (helmet, rate limiting, CORS)
- **validation**: Request validation middleware

### Routes (`routes/`)
- Clean separation of route definitions
- Dependency injection for database services
- Consistent error handling

## 🔧 Maintenance Guidelines

### Adding New Features

1. **New API endpoints**: Add to `routes/api.js`
2. **Database operations**: Add methods to `services/DatabaseService.js`
3. **Validation**: Add validation methods to `utils/Validator.js`
4. **Configuration**: Add to `config.js`

### Code Style

- Use ES6+ features (const/let, arrow functions, template literals)
- Follow consistent error handling patterns
- Use async/await for database operations
- Add JSDoc comments for complex functions
- Use meaningful variable and function names

### Error Handling

- All database operations use try/catch blocks
- Validation errors return 400 status codes
- Database connection errors return 503 status codes
- Generic errors return 500 status codes
- Development mode shows detailed error messages

### Security

- Parameterized queries prevent SQL injection
- Input validation on all endpoints
- Rate limiting on API routes
- CORS configuration for cross-origin requests
- Helmet for security headers

## 🧪 Testing

The modular structure makes testing easier:

```javascript
// Example test for DatabaseService
const { DatabaseService } = require('./services/DatabaseService');
const mockPool = { /* mock pool */ };
const dbService = new DatabaseService(mockPool);

// Test individual methods
const result = await dbService.getJobsWithStats({}, { limit: 10, offset: 0 });
```

## 🔄 Migration from Monolithic Structure

The original `server.js` (763 lines) has been refactored into:

- **Configuration**: `config.js` (25 lines)
- **Database Logic**: `services/DatabaseService.js` (200 lines)
- **Routes**: `routes/api.js` (120 lines)
- **Utilities**: `utils/` (150 lines total)
- **Middleware**: `middleware/` (80 lines total)
- **Main Server**: `server.js` (100 lines)

This provides:
- ✅ Better separation of concerns
- ✅ Easier testing and maintenance
- ✅ Clear module boundaries
- ✅ Reusable components
- ✅ Improved error handling
- ✅ Consistent code style

## 📝 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `NODE_ENV` | development | Environment mode |
| `POSTGRES_HOST` | 127.0.0.1 | Database host |
| `POSTGRES_PORT` | 5432 | Database port |
| `POSTGRES_DB` | taskdb | Database name |
| `POSTGRES_USER` | worker | Database user |
| `POSTGRES_PASSWORD` | password | Database password |
| `ALLOWED_ORIGINS` | * | CORS allowed origins |

## 🤝 Contributing

1. Follow the modular structure
2. Add appropriate error handling
3. Include input validation
4. Write clear documentation
5. Test your changes thoroughly
