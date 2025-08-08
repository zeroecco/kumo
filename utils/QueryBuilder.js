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
            this.whereConditions.push({
                condition: condition.replace('?', `$${this.paramIndex}`),
                value
            });
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

        let query = `SELECT ${this.selectFields.join(', ')} FROM ${this.fromTable}`;

        // Add joins
        this.joins.forEach(join => {
            query += ` ${join.type} JOIN ${join.table} ON ${join.condition}`;
        });

        // Add where clause
        if (this.whereConditions.length > 0) {
            const whereConditions = this.whereConditions
                .map(w => w.condition)
                .join(' AND ');
            query += ` WHERE ${whereConditions}`;
        }

        // Add group by
        if (this.groupByFields.length > 0) {
            query += ` GROUP BY ${this.groupByFields.join(', ')}`;
        }

        // Add order by
        if (this.orderByClauses.length > 0) {
            const orderClause = this.orderByClauses
                .map(o => `${o.field} ${o.direction}`)
                .join(', ');
            query += ` ORDER BY ${orderClause}`;
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

module.exports = QueryBuilder;
