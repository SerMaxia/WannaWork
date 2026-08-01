/**
 * Welcome to the Jungle scraper — Puppeteer Stealth edition.
 * WTTJ's API has changed, so we scrape their HTML search pages directly.
 * Uses puppeteer-extra with stealth plugin for reliability.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { BaseScraper } = require('./base');

puppeteer.use(StealthPlugin());

class WTTJScraper extends BaseScraper {
  constructor() {
    super('wttj', { minDelay: 1500, maxDelay: 3000 });
    this.baseUrl = 'https://www.welcometothejungle.com';
    this.browser = null;
    this.page = null;
  }

  /**
   * Launch a stealth headless browser.
   */
  async _initBrowser() {
    if (this.browser) return;

    this.log('Launching stealth headless browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
        '--disable-dev-shm-usage',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    });
  }

  async _closeBrowser() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
  }

  async _randomWait(min = 1500, max = 3000) {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Search for jobs on WTTJ via HTML scraping.
   */
  async search(keyword, location = 'Toulouse', radius = 50, maxPages = 5) {
    const jobs = [];

    try {
      await this._initBrowser();

      for (let page = 1; page <= maxPages; page++) {
        this.log(`Searching page ${page}/${maxPages}: ${keyword} @ ${location}`);

        // Build WTTJ search URL
        const params = new URLSearchParams({
          query: keyword,
          page: page.toString(),
          aroundQuery: location,
        });
        // Add contract type filter for alternance/apprenticeship
        const url = `${this.baseUrl}/fr/jobs?${params.toString()}&refinementList%5Bcontract_type%5D%5B%5D=apprenticeship`;

        try {
          await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
          await this._randomWait(2000, 4000);

          // Wait for job cards to render (React SSR)
          try {
            await this.page.waitForSelector('[data-testid="search-results-list-item-wrapper"], [class*="ais-Hits"] li, article, [role="list"] > div, main a[href*="/jobs/"]', {
              timeout: 8000,
            });
          } catch {
            this.log(`No job cards found on page ${page}`);
          }

          // Extract jobs from the page
          const pageJobs = await this.page.evaluate((baseUrl) => {
            const results = [];

            // Try multiple selectors for WTTJ's React-based layout
            const cardSelectors = [
              '[data-testid="search-results-list-item-wrapper"]',
              '[class*="ais-Hits"] li',
              'div[class*="sc-"] > a[href*="/jobs/"]',
              'main li',
              'article',
            ];

            let cards = [];
            for (const sel of cardSelectors) {
              cards = document.querySelectorAll(sel);
              if (cards.length > 0) break;
            }

            // If no cards found, try extracting job links directly
            if (cards.length === 0) {
              const links = document.querySelectorAll('a[href*="/companies/"][href*="/jobs/"]');
              links.forEach(link => {
                try {
                  const href = link.getAttribute('href') || '';
                  const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

                  // Try to get title from link text or heading inside
                  const heading = link.querySelector('h3, h4, [class*="title"], [role="heading"]');
                  const title = heading?.textContent?.trim() || link.textContent?.trim() || '';

                  if (title && title.length > 3 && title.length < 200 && fullUrl.includes('/jobs/')) {
                    // Look for company and location nearby
                    const parent = link.closest('li, article, div[class]');
                    const company = parent?.querySelector('[class*="company"], [class*="organization"], span + span')?.textContent?.trim() || '';
                    const loc = parent?.querySelector('[class*="location"], [class*="city"]')?.textContent?.trim() || '';

                    results.push({
                      title: title.split('\n')[0].trim(),
                      company,
                      location: loc,
                      url: fullUrl,
                    });
                  }
                } catch {}
              });
              return results;
            }

            for (const card of cards) {
              try {
                const linkEl = card.querySelector('a[href*="/jobs/"]') || card.closest('a[href*="/jobs/"]');
                if (!linkEl) continue;

                let href = linkEl.getAttribute('href') || '';
                if (href && !href.startsWith('http')) href = `${baseUrl}${href}`;
                if (!href.includes('/jobs/')) continue;

                // Extract data
                const titleEl = card.querySelector('h3, h4, [class*="title"], [role="heading"]');
                const title = titleEl?.textContent?.trim() || linkEl.textContent?.trim() || '';
                const company = card.querySelector('[class*="company"], [class*="organization"]')?.textContent?.trim() || '';
                const loc = card.querySelector('[class*="location"], [class*="city"]')?.textContent?.trim() || '';
                const contractEl = card.querySelector('[class*="contract"], [class*="tag"]');
                const contract = contractEl?.textContent?.trim() || '';

                if (title && title.length > 3) {
                  results.push({
                    title: title.split('\n')[0].trim(),
                    company,
                    location: loc,
                    url: href,
                    contract,
                  });
                }
              } catch {}
            }

            return results;
          }, this.baseUrl);

          if (pageJobs.length === 0) {
            this.log(`No results on page ${page}, stopping.`);
            break;
          }

          for (const raw of pageJobs) {
            jobs.push(this.createJobOffer({
              title: raw.title,
              company: raw.company,
              location: raw.location || location,
              description: '',
              url: raw.url,
              contractType: raw.contract || 'alternance',
            }));
          }

          this.log(`Found ${pageJobs.length} offers on page ${page}`);
          await this._randomWait(2000, 4000);
        } catch (err) {
          this.log(`Error on page ${page}: ${err.message}`);
          break;
        }
      }
    } catch (err) {
      this.log(`Browser error: ${err.message}`);
    }

    return jobs;
  }

  async getDetails(url) {
    if (!this.page) return null;

    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await this._randomWait(1000, 2000);

      const fullDescription = await this.page.evaluate(() => {
        const el = document.querySelector('[data-testid="job-section-description"], [class*="description"], [class*="sc-"]');
        return el ? el.textContent.trim() : '';
      });

      return { fullDescription };
    } catch (err) {
      this.log(`Error getting details: ${err.message}`);
      return null;
    }
  }

  async cleanup() {
    await this._closeBrowser();
  }
}

module.exports = { WTTJScraper };
