/**
 * Scheduler — Runs scraping automatically on a cron schedule.
 */

require('dotenv').config({ path: require('path').join(__dirname, 'config', '.env') });

const cron = require('node-cron');
const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs');

const { IndeedScraper } = require('./src/scrapers/indeed');
const { WTTJScraper } = require('./src/scrapers/wttj');
const { HelloWorkScraper } = require('./src/scrapers/hellowork');
const { LinkedInScraper } = require('./src/scrapers/linkedin');
const { JobDatabase } = require('./src/db/database');
const { JobMatcher } = require('./src/ai/matcher');
const { deduplicateJobs } = require('./src/utils/dedup');
const { startDashboard, setScrapingStatus } = require('./dashboard/server');

const criteriaPath = path.join(__dirname, 'config', 'search_criteria.yaml');
const criteria = yaml.load(fs.readFileSync(criteriaPath, 'utf-8'));

const db = new JobDatabase();
const matcher = new JobMatcher();

// Start dashboard
startDashboard(db);

// Schedule scraping
const intervalHours = criteria.schedule?.interval_hours || 6;
const cronExpr = `0 */${intervalHours} * * *`; // Every N hours

console.log(`\n⏰ Scraping planifié toutes les ${intervalHours}h (cron: ${cronExpr})`);
console.log('   Prochain scrape dans le prochain créneau horaire.\n');

// Run immediately on start
runScraping();

// Schedule recurring
cron.schedule(cronExpr, () => {
  console.log(`\n⏰ [${new Date().toLocaleString('fr-FR')}] Scrape planifié démarré...`);
  runScraping();
});

async function runScraping() {
  setScrapingStatus(true);
  console.log(`\n⏰ [${new Date().toLocaleString()}] Début du scraping programmé...`);

  const scrapers = [];
  const allSources = criteria.sources || ['indeed', 'wttj', 'hellowork', 'linkedin'];

  if (allSources.includes('indeed')) scrapers.push(new IndeedScraper());
  if (allSources.includes('wttj')) scrapers.push(new WTTJScraper());
  if (allSources.includes('hellowork')) scrapers.push(new HelloWorkScraper());
  if (allSources.includes('linkedin')) scrapers.push(new LinkedInScraper());

  const keywords = criteria.keywords || ['alternance devops'];
  const location = criteria.location || 'Toulouse';
  const radius = criteria.radius_km || 50;
  const maxPages = criteria.schedule?.max_pages_per_source || 5;

  // Run all scrapers IN PARALLEL
  console.log(`⚡ Lancement de ${scrapers.length} scraper(s) en parallèle...`);

  const scraperTasks = scrapers.map(async (scraper) => {
    const scraperJobs = [];
    console.log(`🕷️  [${scraper.name}] Scraping...`);

    for (const keyword of keywords) {
      try {
        const jobs = await scraper.search(keyword, location, radius, Math.min(maxPages, 3));
        scraperJobs.push(...jobs);
      } catch (error) {
        console.error(`   ❌ [${scraper.name}] "${keyword}": ${error.message}`);
      }
    }

    // Cleanup Puppeteer browser if applicable
    if (typeof scraper.cleanup === 'function') {
      await scraper.cleanup();
    }

    return scraperJobs;
  });

  const results = await Promise.allSettled(scraperTasks);
  let allJobs = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allJobs.push(...result.value);
    } else {
      console.error(`   ❌ Un scraper a échoué : ${result.reason?.message}`);
    }
  }

  // Deduplicate
  const existingJobs = db.getJobs();
  for (const j of existingJobs) {
    try { j.alternateUrls = j.alternate_urls ? JSON.parse(j.alternate_urls) : []; } catch(e) { j.alternateUrls = []; }
    try { j.alternateSources = j.alternate_sources ? JSON.parse(j.alternate_sources) : []; } catch(e) { j.alternateSources = []; }
  }

  const dedupResult = deduplicateJobs(allJobs, existingJobs);
  allJobs = dedupResult.newJobs;

  if (dedupResult.updatedExistingJobs.length > 0) {
    for (const existing of dedupResult.updatedExistingJobs) {
      db.updateJob(existing.id, {
        alternateUrls: JSON.stringify(existing.alternateUrls),
        alternateSources: JSON.stringify(existing.alternateSources)
      });
    }
  }

  // Score
  for (const job of allJobs) {
    const result = matcher.score(job);
    job.matchingScore = result.score;
    job.matchedSkills = result.matchedSkills;
    job.cvRecommended = matcher.recommendCV(job);
  }

  // Store
  const { inserted, skipped } = db.insertMany(allJobs);

  // Update scores
  for (const job of allJobs) {
    db.updateJob(job.id, {
      matchingScore: job.matchingScore,
      matchedSkills: JSON.stringify(job.matchedSkills),
      cvUsed: job.cvRecommended,
    });
  }

  const stats = db.getStats();
  console.log(`\n📊 Résultat : ${inserted} nouvelles offres (${skipped} doublons) — Total : ${stats.total}`);

  if (inserted > 0) {
    console.log('   Nouveautés disponibles dans le dashboard !');
  }
  
  setScrapingStatus(false);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Arrêt du scheduler...');
  db.close();
  process.exit(0);
});
