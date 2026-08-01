/**
 * Alternance Hunter — Main orchestrator.
 * Coordinates scraping, matching, cover letter generation, and the dashboard.
 */

require('dotenv').config({ path: require('path').join(__dirname, 'config', '.env') });

const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs');

const { IndeedScraper } = require('./src/scrapers/indeed');
const { WTTJScraper } = require('./src/scrapers/wttj');
const { HelloWorkScraper } = require('./src/scrapers/hellowork');
const { LinkedInScraper } = require('./src/scrapers/linkedin');
const { JobDatabase } = require('./src/db/database');
const { JobMatcher } = require('./src/ai/matcher');
const { CoverLetterGenerator } = require('./src/ai/cover-letter');
const { deduplicateJobs } = require('./src/utils/dedup');

// Load search criteria
const criteriaPath = path.join(__dirname, 'config', 'search_criteria.yaml');
const criteria = yaml.load(fs.readFileSync(criteriaPath, 'utf-8'));

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shouldServe = args.includes('--serve');
const scrapeOnly = args.includes('--scrape');
const generateLM = args.includes('--generate-lm');
const specificSources = args.filter(a => ['--indeed', '--wttj', '--hellowork', '--linkedin'].includes(a)).map(a => a.replace('--', ''));

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     🚀 ALTERNANCE HUNTER v1.0               ║');
  console.log('║     Automatisation de recherche d\'alternance ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const db = new JobDatabase();
  const matcher = new JobMatcher();

  // ===== STEP 1: Scrape =====
  if (!shouldServe || scrapeOnly) {
    console.log('📡 Étape 1 : Scraping des offres...\n');
    await runScraping(db, matcher);
  }

  // ===== STEP 2: Generate cover letters =====
  if (generateLM || (!shouldServe && !scrapeOnly)) {
    console.log('\n✍️  Étape 2 : Génération des lettres de motivation...\n');
    await runCoverLetterGeneration(db, matcher);
  }

  // ===== STEP 3: Print summary =====
  printSummary(db);

  // ===== STEP 4: Start dashboard =====
  if (shouldServe || (!scrapeOnly && !isDryRun)) {
    console.log('\n📊 Démarrage du dashboard...\n');
    const { startDashboard } = require('./dashboard/server');
    startDashboard(db);
  } else {
    db.close();
  }
}

/**
 * Run all scrapers and store results.
 * Scrapers run IN PARALLEL for speed.
 */
async function runScraping(db, matcher) {
  const scrapers = [];

  // Determine which scrapers to run
  const allSources = specificSources.length > 0 ? specificSources : ['indeed', 'wttj', 'hellowork', 'linkedin'];

  if (allSources.includes('indeed')) scrapers.push(new IndeedScraper());
  if (allSources.includes('wttj')) scrapers.push(new WTTJScraper());
  if (allSources.includes('hellowork')) scrapers.push(new HelloWorkScraper());
  if (allSources.includes('linkedin')) scrapers.push(new LinkedInScraper());

  const keywords = criteria.keywords || ['alternance devops'];
  const location = criteria.location || 'Toulouse';
  const radius = criteria.radius_km || 50;
  const maxPages = criteria.schedule?.max_pages_per_source || 5;

  // Run all scrapers IN PARALLEL
  console.log(`\n⚡ Lancement de ${scrapers.length} scraper(s) en parallèle...`);

  const scraperTasks = scrapers.map(async (scraper) => {
    const scraperJobs = [];
    console.log(`\n🕷️  [${scraper.name}] Démarrage du scraping...`);

    for (const keyword of keywords) {
      try {
        const jobs = await scraper.search(keyword, location, radius, maxPages);
        scraperJobs.push(...jobs);
        console.log(`   ✅ [${scraper.name}] "${keyword}" → ${jobs.length} offres trouvées`);
      } catch (error) {
        console.error(`   ❌ [${scraper.name}] "${keyword}" → Erreur: ${error.message}`);
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
  console.log(`\n🔄 Déduplication : ${allJobs.length} offres brutes...`);
  const existingJobs = db.getJobs(); // Fetch all existing jobs from DB for cross-deduplication
  
  // Convert DB JSON strings back to arrays for the dedup logic
  for (const j of existingJobs) {
    try { j.alternateUrls = j.alternate_urls ? JSON.parse(j.alternate_urls) : []; } catch(e) { j.alternateUrls = []; }
    try { j.alternateSources = j.alternate_sources ? JSON.parse(j.alternate_sources) : []; } catch(e) { j.alternateSources = []; }
  }

  const dedupResult = deduplicateJobs(allJobs, existingJobs);
  allJobs = dedupResult.newJobs;
  console.log(`   → ${allJobs.length} nouvelles offres uniques après déduplication`);

  // Update existing jobs that received new alternate links
  if (!isDryRun && dedupResult.updatedExistingJobs.length > 0) {
    console.log(`   → ${dedupResult.updatedExistingJobs.length} offres existantes mises à jour avec de nouveaux liens alternatifs`);
    for (const existing of dedupResult.updatedExistingJobs) {
      db.updateJob(existing.id, {
        alternateUrls: JSON.stringify(existing.alternateUrls),
        alternateSources: JSON.stringify(existing.alternateSources)
      });
    }
  }

  // Score each NEW job
  console.log('\n🧠 Calcul des scores de matching...');
  for (const job of allJobs) {
    const result = matcher.score(job);
    job.matchingScore = result.score;
    job.matchedSkills = result.matchedSkills;
    job.cvRecommended = matcher.recommendCV(job);
  }

  // Sort by score
  allJobs.sort((a, b) => b.matchingScore - a.matchingScore);

  // Store in database
  if (!isDryRun) {
    const { inserted, skipped } = db.insertMany(allJobs);
    console.log(`💾 Base de données : ${inserted} nouvelles offres insérées, ${skipped} doublons ignorés`);

    // Update matching scores for existing jobs
    for (const job of allJobs) {
      db.updateJob(job.id, {
        matchingScore: job.matchingScore,
        matchedSkills: JSON.stringify(job.matchedSkills),
        cvUsed: job.cvRecommended,
      });
    }
  } else {
    console.log(`🏃 Mode dry-run : ${allJobs.length} offres trouvées (non sauvegardées)`);
    // Print top 10
    console.log('\n🏆 Top 10 des offres :');
    for (const job of allJobs.slice(0, 10)) {
      console.log(`   ${job.matchingScore}% | ${job.title} @ ${job.company} (${job.source}) — ${job.matchedSkills.join(', ')}`);
    }
  }
}

/**
 * Generate cover letters for high-matching jobs.
 */
async function runCoverLetterGeneration(db, matcher) {
  const threshold = criteria.matching_threshold || 55;

  // Get jobs that need cover letters
  const jobs = db.getJobs({ minScore: threshold, status: 'new' });
  const jobsNeedingLM = jobs.filter(j => !j.cover_letter);

  if (jobsNeedingLM.length === 0) {
    console.log('   Aucune offre nécessitant une LM (toutes déjà générées ou score trop bas).');
    return;
  }

  console.log(`   ${jobsNeedingLM.length} offres avec score >= ${threshold}% nécessitent une LM`);

  try {
    const generator = new CoverLetterGenerator();
    let generated = 0;

    for (const job of jobsNeedingLM) {
      const matchedSkills = job.matched_skills ? JSON.parse(job.matched_skills) : [];
      console.log(`   ✍️  Génération LM pour : ${job.title} @ ${job.company} (${job.matching_score}%)...`);

      const coverLetter = await generator.generate(job, matchedSkills);
      db.updateJob(job.id, { coverLetter: coverLetter, status: 'lm_generated' });
      generated++;

      console.log(`   ✅ LM générée (${coverLetter.length} caractères)`);
    }

    console.log(`\n   📝 ${generated} lettres de motivation générées`);
  } catch (error) {
    console.error(`   ❌ Erreur de génération : ${error.message}`);
    console.log('   💡 Configurez une clé API dans config/.env ou installez Ollama');
  }
}

/**
 * Print a summary of the database.
 */
function printSummary(db) {
  const stats = db.getStats();
  console.log('\n');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║              📊 RÉSUMÉ                      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Total offres     : ${String(stats.total).padStart(5)}                  ║`);
  console.log(`║  Aujourd'hui      : ${String(stats.todayCount).padStart(5)}                  ║`);
  console.log(`║  Score moyen      : ${String(stats.avgScore + '%').padStart(5)}                  ║`);
  console.log(`║  Match >= 70%     : ${String(stats.highMatch).padStart(5)}                  ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Par source :                                ║');
  for (const [source, count] of Object.entries(stats.bySource)) {
    console.log(`║    ${source.padEnd(15)} : ${String(count).padStart(5)}                ║`);
  }
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Par statut :                                ║');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`║    ${status.padEnd(15)} : ${String(count).padStart(5)}                ║`);
  }
  console.log('╚══════════════════════════════════════════════╝');
}

main().catch(error => {
  console.error('💥 Erreur fatale :', error);
  process.exit(1);
});
