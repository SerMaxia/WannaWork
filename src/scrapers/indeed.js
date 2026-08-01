/**
 * Indeed France scraper — Puppeteer Stealth edition.
 * Uses puppeteer-extra with stealth plugin to bypass anti-bot protections.
 * Falls back to Google search via the same stealth browser if direct access fails.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { BaseScraper } = require('./base');

// Apply stealth plugin globally (patches 10+ detection vectors)
puppeteer.use(StealthPlugin());

class IndeedScraper extends BaseScraper {
  constructor() {
    super('indeed', { minDelay: 3000, maxDelay: 6000 });
    this.baseUrl = 'https://fr.indeed.com';
    this.browser = null;
    this.page = null;
  }

  /**
   * Launch a stealth headless browser for the scraping session.
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
        '--disable-infobars',
        '--window-size=1366,768',
        '--disable-dev-shm-usage',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Visit Indeed homepage first to warm cookies
    try {
      this.log('Visiting Indeed homepage for session cookies...');
      await this.page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 25000 });
      await this._randomWait(2000, 4000);
      this.log('Session initialized.');
    } catch (err) {
      this.log('Homepage visit timed out, continuing anyway...');
    }
  }

  /**
   * Close the browser after scraping is done.
   */
  async _closeBrowser() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Wait a random amount of time to simulate human behavior.
   */
  async _randomWait(min = 1500, max = 3500) {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Search for job offers on Indeed.
   * Uses Puppeteer stealth for direct scraping, falls back to Google via the same browser.
   */
  async search(keyword, location = 'Toulouse', radius = 50, maxPages = 5) {
    let jobs = [];

    try {
      await this._initBrowser();
      jobs = await this._searchDirect(keyword, location, radius, maxPages);
    } catch (err) {
      this.log(`Puppeteer error: ${err.message}`);
    }

    // If Puppeteer direct fails (0 results), fallback to Google via Puppeteer
    if (jobs.length === 0) {
      this.log('Direct scraping got 0 results, trying Google fallback via Puppeteer...');
      try {
        jobs = await this._searchViaGooglePuppeteer(keyword, location);
      } catch (err) {
        this.log(`Google Puppeteer fallback error: ${err.message}`);
      }
    }

    return jobs;
  }

  /**
   * Direct Indeed scraping with Puppeteer stealth.
   */
  async _searchDirect(keyword, location, radius, maxPages) {
    const jobs = [];

    for (let page = 0; page < maxPages; page++) {
      const start = page * 10;
      const url = `${this.baseUrl}/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}&radius=${radius}&start=${start}&fromage=14`;

      this.log(`Scraping page ${page + 1}/${maxPages}: ${keyword} @ ${location}`);

      try {
        const response = await this.page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 25000,
        });

        const status = response?.status();
        if (status === 403 || status === 429) {
          this.log(`Got ${status} on page ${page + 1} — Indeed is blocking.`);
          break;
        }

        // Wait for job results to render
        try {
          await this.page.waitForSelector('.job_seen_beacon, .jobsearch-ResultsList, [data-jk], .tapItem, .result, .mosaic-provider-jobcards', {
            timeout: 8000,
          });
        } catch {
          // Check if we got a CAPTCHA or interstitial
          const pageContent = await this.page.content();
          if (pageContent.includes('captcha') || pageContent.includes('unusual traffic')) {
            this.log('CAPTCHA detected, stopping direct scraping.');
            break;
          }
          this.log(`No job results selector found on page ${page + 1}`);
        }

        // Extract jobs from the page
        const pageJobs = await this.page.evaluate((baseUrl) => {
          const results = [];

          const selectors = [
            '.job_seen_beacon',
            '.jobsearch-ResultsList > li',
            '[data-jk]',
            '.result',
            '.tapItem',
            '.css-1m4cuuf',
            '.mosaic-provider-jobcards .job_seen_beacon',
          ];

          let jobCards = [];
          for (const selector of selectors) {
            jobCards = document.querySelectorAll(selector);
            if (jobCards.length > 0) break;
          }

          for (const card of jobCards) {
            try {
              const titleEl = card.querySelector('h2.jobTitle a, .jobTitle a, a[data-jk], .jcs-JobTitle, h2 a');
              const title = titleEl?.textContent?.trim() || card.querySelector('h2')?.textContent?.trim() || '';
              const company = card.querySelector('[data-testid="company-name"], .companyName, .company, [class*="company"]')?.textContent?.trim() || '';
              const loc = card.querySelector('[data-testid="text-location"], .companyLocation, .location, [class*="location"]')?.textContent?.trim() || '';
              let url = titleEl?.getAttribute('href') || '';

              if (url && !url.startsWith('http')) url = `${baseUrl}${url}`;

              const description = card.querySelector('.job-snippet, .underShelfFooter, [class*="snippet"]')?.textContent?.trim() || '';
              const salary = card.querySelector('[class*="salary"], .salary-snippet, [class*="salaryText"]')?.textContent?.trim() || null;

              if (title && url) {
                results.push({ title, company, location: loc, description, url, salary });
              }
            } catch (err) {
              // Skip malformed entries
            }
          }

          return results;
        }, this.baseUrl);

        if (pageJobs.length === 0) {
          this.log(`No results on page ${page + 1}, stopping.`);
          break;
        }

        for (const raw of pageJobs) {
          jobs.push(this.createJobOffer({
            title: raw.title,
            company: raw.company,
            location: raw.location,
            description: raw.description,
            url: raw.url,
            contractType: 'alternance',
            salary: raw.salary,
          }));
        }

        this.log(`Found ${pageJobs.length} offers on page ${page + 1}`);

        // Human-like delay between pages
        await this._randomWait(3000, 6000);
      } catch (err) {
        this.log(`Error on page ${page + 1}: ${err.message}`);
        break;
      }
    }

    return jobs;
  }

  /**
   * Fallback: search Indeed results via Google, using the SAME stealth Puppeteer browser.
   * This avoids the 429 rate-limiting that axios gets from Google.
   */
  async _searchViaGooglePuppeteer(keyword, location) {
    const jobs = [];

    if (!this.page) {
      this.log('No browser page available for Google fallback');
      return jobs;
    }

    const query = `site:fr.indeed.com/viewjob ${keyword} ${location}`;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&hl=fr`;

    this.log(`Google fallback (Puppeteer): searching "${query}"`);

    try {
      await this.page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await this._randomWait(1500, 3000);

      // Check for CAPTCHA
      const pageContent = await this.page.content();
      if (pageContent.includes('captcha') || pageContent.includes('unusual traffic') || pageContent.includes('recaptcha')) {
        this.log('Google CAPTCHA detected, skipping fallback');
        return jobs;
      }

      // Extract Indeed links from Google results
      const results = await this.page.evaluate(() => {
        const found = [];

        document.querySelectorAll('a[href*="indeed.com"]').forEach(el => {
          try {
            let href = el.getAttribute('href') || '';

            // Extract actual URL from Google redirect
            if (href.includes('/url?')) {
              const match = href.match(/[?&]q=([^&]+)/);
              if (match) href = decodeURIComponent(match[1]);
            }

            if (!href.includes('indeed.com') || !href.includes('viewjob')) return;

            const title = el.textContent?.trim() || '';
            if (!title || title.length < 5 || title.length > 200) return;

            // Get snippet from parent
            const parentDiv = el.closest('div');
            const snippet = parentDiv?.textContent || '';

            found.push({
              title: title.replace(/ - Indeed$/, '').replace(/ - .+$/, '').trim(),
              url: href.split('&')[0],
              snippet: snippet.substring(0, 300),
            });
          } catch (err) {
            // Skip
          }
        });

        return found;
      });

      for (const r of results) {
        jobs.push(this.createJobOffer({
          title: r.title,
          company: '',
          location: location,
          description: r.snippet,
          url: r.url,
          contractType: 'alternance',
        }));
      }

      this.log(`Google fallback: found ${jobs.length} results`);
    } catch (err) {
      this.log(`Google fallback error: ${err.message}`);
    }

    return jobs;
  }

  async getDetails(url) {
    if (!this.page) return null;

    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await this._randomWait(1000, 2000);

      const fullDescription = await this.page.evaluate(() => {
        const el = document.querySelector('#jobDescriptionText, .jobsearch-jobDescriptionText');
        return el ? el.textContent.trim() : '';
      });

      return { fullDescription };
    } catch (err) {
      this.log(`Error getting details for ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Cleanup: close browser. Called when scraping is done.
   */
  async cleanup() {
    await this._closeBrowser();
  }
}

module.exports = { IndeedScraper };
