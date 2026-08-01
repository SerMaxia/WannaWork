/**
 * LinkedIn Jobs scraper (guest/public API only).
 * Uses LinkedIn's public job search API — NO credentials needed.
 * Most conservative scraper to avoid bans.
 */

const cheerio = require('cheerio');
const { BaseScraper } = require('./base');

class LinkedInScraper extends BaseScraper {
  constructor() {
    super('linkedin', { minDelay: 4000, maxDelay: 8000 }); // Conservative but reduced
    this.baseUrl = 'https://www.linkedin.com';
  }

  /**
   * Search for jobs on LinkedIn using the guest API.
   * @param {string} keyword
   * @param {string} location
   * @param {number} radius
   * @param {number} maxPages - Max 3 for LinkedIn (strict rate limiting)
   * @returns {Promise<Array>}
   */
  async search(keyword, location = 'Toulouse', radius = 50, maxPages = 3) {
    const jobs = [];
    const safeMaxPages = Math.min(maxPages, 3); // Never more than 3 pages on LinkedIn

    for (let page = 0; page < safeMaxPages; page++) {
      const start = page * 25;

      // LinkedIn guest API endpoint
      const url = `${this.baseUrl}/jobs-guest/jobs/api/seeMoreJobPostings/search?` + new URLSearchParams({
        keywords: keyword,
        location: location,
        f_TPR: 'r604800', // Last 7 days
        f_JT: 'I',         // Internship/Alternance type
        start: start.toString(),
      }).toString();

      this.log(`Scraping page ${page + 1}/${safeMaxPages}: ${keyword} @ ${location}`);
      const response = await this.fetch(url, {
        headers: {
          'Accept': 'text/html',
          'Referer': 'https://www.linkedin.com/jobs/search/',
        },
      });

      if (!response || !response.data) {
        this.log(`No response for page ${page + 1}, stopping.`);
        break;
      }

      const $ = cheerio.load(response.data);
      const pageJobs = this._parseSearchResults($);

      if (pageJobs.length === 0) {
        this.log(`No more results on page ${page + 1}, stopping.`);
        break;
      }

      jobs.push(...pageJobs);
      this.log(`Found ${pageJobs.length} offers on page ${page + 1}`);
    }

    return jobs;
  }

  /**
   * Parse LinkedIn guest job search results.
   * @param {Object} $
   * @returns {Array}
   */
  _parseSearchResults($) {
    const jobs = [];

    $('li, .base-card, .job-search-card, [class*="result-card"]').each((_, element) => {
      try {
        const $el = $(element);

        const title = $el.find('.base-search-card__title, h3, [class*="job-title"]').first().text().trim();
        const company = $el.find('.base-search-card__subtitle, h4, [class*="company"]').first().text().trim();
        const location = $el.find('.job-search-card__location, [class*="location"]').first().text().trim();

        const linkEl = $el.find('a.base-card__full-link, a[href*="/jobs/view/"]').first();
        let url = linkEl.attr('href') || '';

        // Clean up LinkedIn tracking params
        if (url) {
          try {
            const parsed = new URL(url.startsWith('http') ? url : `${this.baseUrl}${url}`);
            parsed.search = ''; // Remove tracking params
            url = parsed.toString();
          } catch {
            if (!url.startsWith('http')) url = `${this.baseUrl}${url}`;
          }
        }

        const dateText = $el.find('time, [class*="date"]').first().attr('datetime') || '';

        if (title && url) {
          jobs.push(this.createJobOffer({
            title,
            company,
            location,
            description: '',
            url,
            contractType: 'alternance',
            publishedAt: dateText || null,
          }));
        }
      } catch (err) {
        // Skip
      }
    });

    return jobs;
  }

  async getDetails(url) {
    // LinkedIn blocks most detail page scraping for guests
    // Return minimal info
    this.log(`Detail fetching limited for LinkedIn (anti-scraping). URL: ${url}`);
    return { fullDescription: '' };
  }
}

module.exports = { LinkedInScraper };
