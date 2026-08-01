/**
 * Base scraper class — all scrapers inherit from this.
 * Provides common functionality: rate limiting, retry, user-agent rotation, error handling.
 */

const axios = require('axios');
const { RateLimiter } = require('../utils/rate-limiter');
const { generateJobId } = require('../utils/dedup');

// Realistic User-Agent strings (updated 2026)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

class BaseScraper {
  /**
   * @param {string} name - Scraper name (e.g., "indeed", "wttj")
   * @param {Object} options
   * @param {number} options.minDelay - Minimum delay between requests (ms)
   * @param {number} options.maxDelay - Maximum delay between requests (ms)
   * @param {number} options.maxRetries - Max retry attempts
   */
  constructor(name, options = {}) {
    this.name = name;
    this.rateLimiter = new RateLimiter(
      options.minDelay || 3000,
      options.maxDelay || 8000
    );
    this.maxRetries = options.maxRetries || 2;
    this.userAgent = this._randomUserAgent();
  }

  /**
   * Search for job offers. Must be implemented by subclasses.
   * @param {string} keyword - Search keyword
   * @param {string} location - Location
   * @param {number} radius - Search radius in km
   * @param {number} maxPages - Maximum pages to scrape
   * @returns {Promise<Array>} Array of job offers
   */
  async search(keyword, location, radius, maxPages) {
    throw new Error('search() must be implemented by subclass');
  }

  /**
   * Get detailed information for a specific job.
   * @param {string} url - Job URL
   * @returns {Promise<Object>} Job details
   */
  async getDetails(url) {
    throw new Error('getDetails() must be implemented by subclass');
  }

  /**
   * Make an HTTP GET request with rate limiting, retry, and user-agent rotation.
   * @param {string} url
   * @param {Object} options - Axios options
   * @returns {Promise<Object>} Axios response
   */
  async fetch(url, options = {}) {
    await this.rateLimiter.wait();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': this._randomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            ...options.headers,
          },
          timeout: 15000,
          ...options,
        });
        return response;
      } catch (error) {
        const status = error.response?.status;
        console.warn(`[${this.name}] Attempt ${attempt}/${this.maxRetries} failed for ${url}: ${error.message} (status: ${status})`);

        // Fast-fail on 403 — anti-bot blocks never resolve with retries
        if (status === 403) {
          console.error(`[${this.name}] 403 Forbidden (anti-bot) — skipping retries for ${url}`);
          return null;
        }

        if (attempt < this.maxRetries) {
          // Exponential backoff (reduced: 500ms base instead of 1000ms)
          const backoff = Math.pow(2, attempt) * 500 + Math.random() * 1000;
          console.log(`[${this.name}] Retrying in ${Math.round(backoff / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          console.error(`[${this.name}] All ${this.maxRetries} attempts failed for ${url}`);
          return null;
        }
      }
    }
  }

  /**
   * Create a standardized job offer object.
   * @param {Object} data
   * @returns {Object}
   */
  createJobOffer(data) {
    return {
      id: generateJobId(data.url),
      title: (data.title || '').trim(),
      company: (data.company || 'Entreprise non précisée').trim(),
      location: (data.location || '').trim(),
      description: (data.description || '').trim(),
      url: data.url,
      source: this.name,
      contractType: (data.contractType || 'alternance').trim(),
      salary: data.salary || null,
      publishedAt: data.publishedAt || null,
      scrapedAt: new Date().toISOString(),
    };
  }

  /**
   * Get a random user agent string.
   * @returns {string}
   */
  _randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Log a message with the scraper name prefix.
   * @param  {...any} args
   */
  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }
}

module.exports = { BaseScraper };
