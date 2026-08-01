/**
 * SQLite database manager for job offers.
 * Uses better-sqlite3 for synchronous, high-performance queries.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class JobDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'jobs.db');

    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrent access
    this.db.pragma('foreign_keys = ON');

    this._initSchema();
  }

  /**
   * Initialize the database schema.
   */
  _initSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);

    // Migration for older DB versions: Add new columns if they don't exist
    try {
      this.db.exec('ALTER TABLE jobs ADD COLUMN alternate_urls TEXT');
    } catch (e) { /* Column already exists */ }
    try {
      this.db.exec('ALTER TABLE jobs ADD COLUMN alternate_sources TEXT');
    } catch (e) { /* Column already exists */ }
  }

  /**
   * Insert a job offer (ignore if URL already exists).
   * @param {Object} job
   * @returns {boolean} true if inserted, false if duplicate
   */
  insertJob(job) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO jobs (id, title, company, location, description, url, source, contract_type, salary, published_at, scraped_at, matching_score, matched_skills, alternate_urls, alternate_sources)
      VALUES (@id, @title, @company, @location, @description, @url, @source, @contractType, @salary, @publishedAt, @scrapedAt, @matchingScore, @matchedSkills, @alternateUrls, @alternateSources)
    `);

    const result = stmt.run({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location || '',
      description: job.description || '',
      url: job.url,
      source: job.source,
      contractType: job.contractType || 'alternance',
      salary: job.salary || null,
      publishedAt: job.publishedAt || null,
      scrapedAt: job.scrapedAt || new Date().toISOString(),
      matchingScore: job.matchingScore || 0,
      matchedSkills: job.matchedSkills ? JSON.stringify(job.matchedSkills) : null,
      alternateUrls: job.alternateUrls?.length ? JSON.stringify(job.alternateUrls) : null,
      alternateSources: job.alternateSources?.length ? JSON.stringify(job.alternateSources) : null,
    });

    return result.changes > 0;
  }

  /**
   * Insert multiple jobs in a transaction.
   * @param {Array} jobs
   * @returns {Object} { inserted, skipped }
   */
  insertMany(jobs) {
    let inserted = 0;
    let skipped = 0;

    const insertTransaction = this.db.transaction((jobList) => {
      for (const job of jobList) {
        const wasInserted = this.insertJob(job);
        if (wasInserted) inserted++;
        else skipped++;
      }
    });

    insertTransaction(jobs);
    return { inserted, skipped };
  }

  /**
   * Get all jobs, optionally filtered.
   * @param {Object} filters
   * @returns {Array}
   */
  getJobs(filters = {}) {
    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params = {};

    if (filters.status) {
      query += ' AND status = @status';
      params.status = filters.status;
    }
    if (filters.source) {
      query += ' AND source = @source';
      params.source = filters.source;
    }
    if (filters.minScore !== undefined) {
      query += ' AND matching_score >= @minScore';
      params.minScore = filters.minScore;
    }
    if (filters.search) {
      query += ' AND (title LIKE @search OR company LIKE @search OR description LIKE @search)';
      params.search = `%${filters.search}%`;
    }

    // Sorting
    const sortBy = filters.sortBy || 'matching_score';
    const sortOrder = filters.sortOrder || 'DESC';
    const validSorts = ['matching_score', 'scraped_at', 'title', 'company', 'source'];
    const validOrders = ['ASC', 'DESC'];

    if (validSorts.includes(sortBy) && validOrders.includes(sortOrder.toUpperCase())) {
      query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    } else {
      query += ' ORDER BY matching_score DESC';
    }

    // Pagination
    if (filters.limit) {
      query += ' LIMIT @limit';
      params.limit = filters.limit;
    }
    if (filters.offset) {
      query += ' OFFSET @offset';
      params.offset = filters.offset;
    }

    return this.db.prepare(query).all(params);
  }

  /**
   * Get a single job by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getJob(id) {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null;
  }

  /**
   * Update a job's fields.
   * @param {string} id
   * @param {Object} updates
   */
  updateJob(id, updates) {
    const allowedFields = [
      'status', 'cover_letter', 'cv_used', 'notes', 'matching_score',
      'matched_skills', 'full_description', 'applied_at', 'response_at', 'response_type',
      'alternate_urls', 'alternate_sources'
    ];

    const setClauses = [];
    const params = { id };

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
      if (allowedFields.includes(dbKey)) {
        setClauses.push(`${dbKey} = @${key}`);
        params[key] = value;
      }
    }

    if (setClauses.length === 0) return;

    const query = `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = @id`;
    this.db.prepare(query).run(params);
  }

  /**
   * Get aggregated statistics.
   * @returns {Object}
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
    const byStatus = this.db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
    const bySource = this.db.prepare('SELECT source, COUNT(*) as count FROM jobs GROUP BY source').all();
    const avgScore = this.db.prepare('SELECT AVG(matching_score) as avg FROM jobs WHERE matching_score > 0').get().avg || 0;
    const todayCount = this.db.prepare("SELECT COUNT(*) as count FROM jobs WHERE date(scraped_at) = date('now')").get().count;
    const highMatch = this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE matching_score >= 70').get().count;

    return {
      total,
      todayCount,
      highMatch,
      avgScore: Math.round(avgScore),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
      bySource: Object.fromEntries(bySource.map(r => [r.source, r.count])),
    };
  }

  /**
   * Delete old jobs (older than N days).
   * @param {number} days
   * @returns {number} Deleted count
   */
  cleanup(days = 60) {
    const result = this.db.prepare(`
      DELETE FROM jobs WHERE scraped_at < datetime('now', '-' || ? || ' days') AND status = 'new'
    `).run(days);
    return result.changes;
  }

  /**
   * Close the database connection.
   */
  close() {
    this.db.close();
  }
}

module.exports = { JobDatabase };
