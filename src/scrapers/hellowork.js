/**
 * HelloWork scraper — Puppeteer Stealth edition.
 * Scrapes alternance job offers from hellowork.com using a headless browser.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { BaseScraper } = require('./base');

puppeteer.use(StealthPlugin());

class HelloWorkScraper extends BaseScraper {
  constructor() {
    super('hellowork', { minDelay: 2000, maxDelay: 5000 });
    this.baseUrl = 'https://www.hellowork.com';
    this.browser = null;
    this.page = null;
  }

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

  async _randomWait(min = 1500, max = 3500) {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Search for job offers on HelloWork via Puppeteer.
   */
  async search(keyword, location = 'Toulouse', radius = 50, maxPages = 5) {
    const jobs = [];

    try {
      await this._initBrowser();

      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({
          k: keyword,
          l: location,
          ray: radius.toString(),
          p: page.toString(),
          cod: 'alternance',
        });
        const url = `${this.baseUrl}/fr-fr/emploi/recherche.html?${params.toString()}`;

        this.log(`Scraping page ${page}/${maxPages}: ${keyword} @ ${location}`);

        try {
          const response = await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

          const status = response?.status();
          if (status === 403 || status === 429) {
            this.log(`Got ${status} on page ${page}, stopping.`);
            break;
          }

          await this._randomWait(1500, 3000);

          // Wait for job listings to render
          try {
            await this.page.waitForSelector('[data-testid="offer-card"], article, li a[href*="/emploi/"], [class*="offer"], [class*="card"]', {
              timeout: 8000,
            });
          } catch {
            this.log(`No job selectors found on page ${page}`);
          }

          // Extract jobs from the page
          const pageJobs = await this.page.evaluate((baseUrl) => {
            const results = [];

            // Strategy 1: Try specific offer cards
            const cardSelectors = [
              '[data-testid="offer-card"]',
              'article',
              'li[class*="offer"]',
              '[class*="JobCard"]',
              '.hw-card',
            ];

            let cards = [];
            for (const sel of cardSelectors) {
              const found = document.querySelectorAll(sel);
              // Filter to only cards containing job links
              const filtered = Array.from(found).filter(el =>
                el.querySelector('a[href*="/emploi/"], a[href*="/job/"]')
              );
              if (filtered.length > 0) {
                cards = filtered;
                break;
              }
            }

            if (cards.length > 0) {
              for (const card of cards) {
                try {
                  const linkEl = card.querySelector('a[href*="/emploi/"], a[href*="/job/"]');
                  if (!linkEl) continue;

                  let href = linkEl.getAttribute('href') || '';
                  if (href && !href.startsWith('http')) href = `${baseUrl}${href}`;

                  const title = linkEl.textContent?.trim() ||
                    card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '';
                  const company = card.querySelector('[class*="company"], [class*="entreprise"], [data-testid="company"]')?.textContent?.trim() || '';
                  const loc = card.querySelector('[class*="location"], [class*="lieu"], [data-testid="location"]')?.textContent?.trim() || '';
                  const salary = card.querySelector('[class*="salary"], [class*="salaire"]')?.textContent?.trim() || null;

                  if (title && href && title.length > 3 && title.length < 200) {
                    results.push({ title: title.split('\n')[0].trim(), company, location: loc, url: href, salary });
                  }
                } catch {}
              }
            }

            // Strategy 2: If no cards found, extract all job links directly
            if (results.length === 0) {
              const links = document.querySelectorAll('a[href*="/fr-fr/emploi/"], a[href*="/emploi/"]');
              links.forEach(link => {
                try {
                  const href = link.getAttribute('href') || '';
                  const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
                  const title = link.textContent?.trim() || '';

                  // Filter out navigation/menu links
                  if (!title || title.length < 5 || title.length > 200) return;
                  if (href.includes('recherche.html') || href.includes('/emploi/recherche')) return;

                  // Get parent for more context
                  const parent = link.closest('li, article, div[class*="card"], div[class*="offer"]');
                  const company = parent?.querySelector('[class*="company"], [class*="entreprise"]')?.textContent?.trim() || '';
                  const loc = parent?.querySelector('[class*="location"], [class*="lieu"]')?.textContent?.trim() || '';

                  results.push({ title: title.split('\n')[0].trim(), company, location: loc, url: fullUrl, salary: null });
                } catch {}
              });
            }

            return results;
          }, this.baseUrl);

          if (pageJobs.length === 0) {
            this.log(`No more results on page ${page}, stopping.`);
            break;
          }

          for (const raw of pageJobs) {
            jobs.push(this.createJobOffer({
              title: raw.title,
              company: raw.company,
              location: raw.location || location,
              description: '',
              url: raw.url,
              contractType: 'alternance',
              salary: raw.salary,
            }));
          }

          this.log(`Found ${pageJobs.length} offers on page ${page}`);
          await this._randomWait(2500, 5000);
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
        const el = document.querySelector('[class*="description"], [data-testid="job-description"], .job-description');
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

module.exports = { HelloWorkScraper };
