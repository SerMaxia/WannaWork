/**
 * Dashboard server — Express API + static file serving.
 */

const express = require('express');
const path = require('path');

let isScraping = false;

function setScrapingStatus(status) {
  isScraping = !!status;
}

function startDashboard(db) {
  const app = express();
  const port = process.env.DASHBOARD_PORT || 3000;

  app.use(express.json());
  app.use(express.static(path.join(__dirname)));

  // ===== API Routes =====

  // GET /api/jobs — List all jobs with filters
  app.get('/api/jobs', (req, res) => {
    try {
      const filters = {
        status: req.query.status || undefined,
        source: req.query.source || undefined,
        minScore: req.query.minScore ? parseInt(req.query.minScore) : undefined,
        search: req.query.search || undefined,
        sortBy: req.query.sortBy || 'matching_score',
        sortOrder: req.query.sortOrder || 'DESC',
        limit: req.query.limit ? parseInt(req.query.limit) : 200,
        offset: req.query.offset ? parseInt(req.query.offset) : 0,
      };
      const jobs = db.getJobs(filters);
      res.json({ success: true, count: jobs.length, jobs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/jobs/:id — Get single job
  app.get('/api/jobs/:id', (req, res) => {
    try {
      const job = db.getJob(req.params.id);
      if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
      res.json({ success: true, job });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PATCH /api/jobs/:id — Update job (status, notes, cover letter)
  app.patch('/api/jobs/:id', (req, res) => {
    try {
      db.updateJob(req.params.id, req.body);
      const job = db.getJob(req.params.id);
      res.json({ success: true, job });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/stats — Dashboard statistics
  app.get('/api/stats', (req, res) => {
    try {
      const stats = db.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/jobs/:id/generate-cover-letter — Generate cover letter for a job
  app.post('/api/jobs/:id/generate-cover-letter', async (req, res) => {
    try {
      const { CoverLetterGenerator } = require('../src/ai/cover-letter');
      const { JobMatcher } = require('../src/ai/matcher');

      const job = db.getJob(req.params.id);
      if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

      const matcher = new JobMatcher();
      const matchResult = matcher.score(job);

      const generator = new CoverLetterGenerator();
      const coverLetter = await generator.generate(job, matchResult.matchedSkills);

      db.updateJob(req.params.id, {
        coverLetter: coverLetter,
        status: 'lm_generated',
      });

      res.json({ success: true, coverLetter });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/status — Check if scraper is currently running
  app.get('/api/status', (req, res) => {
    res.json({ success: true, isScraping });
  });

  // POST /api/scrape — Trigger a background scrape
  app.post('/api/scrape', (req, res) => {
    if (isScraping) {
      return res.json({ success: true, message: 'Scraping is already running' });
    }
    
    try {
      isScraping = true;
      const { spawn } = require('child_process');
      const scrapeProcess = spawn('node', ['main.js', '--scrape'], {
        detached: false, // Wait for exit to update status
      });
      
      scrapeProcess.on('close', () => {
        isScraping = false;
      });
      
      res.json({ success: true, message: 'Scraping started' });
    } catch (error) {
      isScraping = false;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start server
  app.listen(port, () => {
    console.log(`\n🌐 Dashboard disponible sur : http://localhost:${port}`);
    console.log(`   API disponible sur       : http://localhost:${port}/api/jobs`);
    console.log('\n   Ctrl+C pour arrêter.\n');
  });

  return app;
}

module.exports = { startDashboard, setScrapingStatus };
