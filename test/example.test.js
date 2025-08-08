const { expect } = require('chai');
const Validator = require('../utils/Validator');
const QueryBuilder = require('../utils/QueryBuilder');

describe('Validator', () => {
    describe('validateJobId', () => {
        it('should accept numeric job IDs', () => {
            const result = Validator.validateJobId('123');
            expect(result).to.equal('123');
        });

        it('should accept UUID job IDs', () => {
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            const result = Validator.validateJobId(uuid);
            expect(result).to.equal(uuid);
        });

        it('should reject invalid job IDs', () => {
            expect(() => Validator.validateJobId('invalid')).to.throw('Job ID must be a valid number or UUID');
        });

        it('should reject empty job IDs', () => {
            expect(() => Validator.validateJobId('')).to.throw('Job ID is required');
        });
    });

    describe('validatePagination', () => {
        it('should return default values for empty input', () => {
            const result = Validator.validatePagination();
            expect(result).to.deep.equal({ limit: 50, offset: 0 });
        });

        it('should validate limit constraints', () => {
            expect(() => Validator.validatePagination(101)).to.throw('Limit cannot exceed 100');
            expect(() => Validator.validatePagination(0)).to.throw('Limit must be at least 1');
        });

        it('should validate offset constraints', () => {
            expect(() => Validator.validatePagination(10, -1)).to.throw('Offset must be non-negative');
        });
    });
});

describe('QueryBuilder', () => {
    it('should build a simple SELECT query', () => {
        const queryBuilder = new QueryBuilder()
            .select(['id', 'name'])
            .from('users')
            .where('active = ?', true);

        const { query, params } = queryBuilder.build();

        expect(query).to.include('SELECT id, name FROM users');
        expect(query).to.include('WHERE active = $1');
        expect(params).to.deep.equal([true]);
    });

    it('should build a complex query with joins and ordering', () => {
        const queryBuilder = new QueryBuilder()
            .select(['j.id', 'COUNT(t.id) as task_count'])
            .from('jobs j')
            .join('tasks t', 'j.id = t.job_id')
            .where('j.state = ?', 'running')
            .groupBy(['j.id'])
            .orderBy('j.id', 'DESC')
            .limit(10)
            .offset(20);

        const { query, params } = queryBuilder.build();

        expect(query).to.include('SELECT j.id, COUNT(t.id) as task_count FROM jobs j');
        expect(query).to.include('LEFT JOIN tasks t ON j.id = t.job_id');
        expect(query).to.include('WHERE j.state = $1');
        expect(query).to.include('GROUP BY j.id');
        expect(query).to.include('ORDER BY j.id DESC');
        expect(query).to.include('LIMIT $2');
        expect(query).to.include('OFFSET $3');
        expect(params).to.deep.equal(['running', 10, 20]);
    });
});

// Example of how to test the DatabaseService (would need a mock pool)
describe('DatabaseService', () => {
    it('should be testable with mocked dependencies', () => {
        // This is an example of how the modular structure enables easy testing
        const mockPool = {
            query: async () => ({ rows: [] }),
            connect: async () => ({
                query: async () => ({ rows: [] }),
                release: () => {}
            })
        };

        const DatabaseService = require('../services/DatabaseService');
        const dbService = new DatabaseService(mockPool);

        // Now you can test individual methods
        expect(dbService).to.have.property('getJobsWithStats');
        expect(dbService).to.have.property('getJobDetails');
        expect(dbService).to.have.property('deleteJob');
    });
});
