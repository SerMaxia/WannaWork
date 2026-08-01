/**
 * Deduplication utility for job offers.
 * Detects duplicate offers across different platforms.
 */

const crypto = require('crypto');

/**
 * Generate a normalized ID for a job offer based on title + company.
 * This catches the same offer posted on multiple platforms.
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @returns {string} Normalized hash
 */
function generateJobId(url) {
  return crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
}

/**
 * Normalize a string for comparison (lowercase, remove accents, trim, collapse spaces).
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, '')    // Remove special chars
    .replace(/\s+/g, ' ')            // Collapse spaces
    .trim();
}

/**
 * Check if two job offers are likely duplicates.
 * @param {Object} job1
 * @param {Object} job2
 * @returns {boolean}
 */
function isDuplicate(job1, job2) {
  const title1 = normalize(job1.title);
  const title2 = normalize(job2.title);
  const company1 = normalize(job1.company);
  const company2 = normalize(job2.company);

  // Exact match on normalized title + company
  if (title1 === title2 && company1 === company2) return true;

  // Fuzzy match: same company and similar title (> 80% overlap)
  if (company1 === company2 && similarity(title1, title2) > 0.8) return true;

  return false;
}

/**
 * Simple Jaccard similarity between two strings (word-level).
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
function similarity(a, b) {
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Deduplicate an array of job offers and group cross-platform duplicates.
 * Keeps the first occurrence and appends alternative links to it.
 * @param {Array} jobs - New jobs to deduplicate
 * @param {Array} existingJobs - Optional jobs already in DB to deduplicate against
 * @returns {Array} Deduplicated jobs with alternate links
 */
function deduplicateJobs(jobs, existingJobs = []) {
  const unique = [...existingJobs];
  const newUnique = [];

  for (const job of jobs) {
    // Check if it's a duplicate of something we already have (either from DB or from this batch)
    const existingIndex = unique.findIndex(existing => isDuplicate(existing, job));
    
    if (existingIndex !== -1) {
      // It's a duplicate! We GROUP it instead of dropping it.
      const existing = unique[existingIndex];
      
      // Ensure arrays exist
      if (!existing.alternateUrls) existing.alternateUrls = [];
      if (!existing.alternateSources) existing.alternateSources = [];
      
      // Avoid adding the exact same URL again
      if (existing.url !== job.url && !existing.alternateUrls.includes(job.url)) {
        existing.alternateUrls.push(job.url);
        existing.alternateSources.push(job.source);
      }
      
      // Also update existing in the output if it was from DB and got new links
      if (!newUnique.includes(existing) && existingJobs.includes(existing)) {
        // We don't push DB jobs to newUnique to avoid re-inserting, but we need to update them.
        // The DB update logic will handle saving updated alternateUrls.
      }
    } else {
      // It's a truly new job
      job.alternateUrls = [];
      job.alternateSources = [];
      unique.push(job);
      newUnique.push(job);
    }
  }

  // We return both the newly discovered unique jobs AND the updated DB jobs
  return {
    newJobs: newUnique,
    updatedExistingJobs: unique.filter(j => existingJobs.includes(j) && j.alternateUrls?.length > 0)
  };
}

module.exports = { generateJobId, normalize, isDuplicate, similarity, deduplicateJobs };
