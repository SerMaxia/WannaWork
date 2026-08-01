/**
 * Rate limiter with humanized random delays to avoid detection.
 * Adds jitter to make requests look more natural.
 */

class RateLimiter {
  constructor(minDelayMs = 3000, maxDelayMs = 8000) {
    this.minDelay = minDelayMs;
    this.maxDelay = maxDelayMs;
    this.lastRequestTime = 0;
  }

  /**
   * Wait a random delay before the next request.
   * @returns {Promise<void>}
   */
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const delay = this._randomDelay();

    if (elapsed < delay) {
      const waitTime = delay - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Generate a random delay between min and max with gaussian-like distribution.
   * @returns {number} Delay in milliseconds
   */
  _randomDelay() {
    // Use Box-Muller transform for more natural distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Map to our range with center at midpoint
    const mid = (this.minDelay + this.maxDelay) / 2;
    const range = (this.maxDelay - this.minDelay) / 4;
    const delay = mid + normal * range;

    return Math.max(this.minDelay, Math.min(this.maxDelay, delay));
  }
}

module.exports = { RateLimiter };
