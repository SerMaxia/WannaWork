/**
 * Cover letter generator.
 * Generates personalized cover letters using an LLM API.
 * Supports: Anthropic Claude, OpenAI, Google Gemini, or Ollama (local).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');

class CoverLetterGenerator {
  constructor(options = {}) {
    this.profilePath = options.profilePath || path.join(__dirname, '..', '..', 'config', 'profile.yaml');
    this.promptPath = options.promptPath || path.join(__dirname, 'prompts', 'cover-letter.md');

    // Load profile
    this.profile = yaml.load(fs.readFileSync(this.profilePath, 'utf-8'));
    this.promptTemplate = fs.readFileSync(this.promptPath, 'utf-8');

    // Determine which LLM to use
    this.provider = this._detectProvider();
  }

  /**
   * Detect which LLM provider is configured.
   * @returns {string} 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'none'
   */
  _detectProvider() {
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    // Check if Ollama is running locally
    return 'ollama'; // Default fallback
  }

  /**
   * Generate a cover letter for a specific job.
   * @param {Object} job - Job offer
   * @param {Array<string>} matchedSkills - Skills that matched
   * @returns {Promise<string>} Generated cover letter
   */
  async generate(job, matchedSkills = []) {
    // Build the prompt
    const profileSummary = this._buildProfileSummary();
    const prompt = this.promptTemplate
      .replace('{{PROFILE}}', profileSummary)
      .replace('{{JOB_TITLE}}', job.title)
      .replace('{{COMPANY}}', job.company)
      .replace('{{LOCATION}}', job.location || 'Non précisée')
      .replace('{{DESCRIPTION}}', job.description || job.fullDescription || 'Description non disponible')
      .replace('{{MATCHED_SKILLS}}', matchedSkills.join(', ') || 'Analyse en cours');

    // Call the LLM
    try {
      const response = await this._callLLM(prompt);
      return response;
    } catch (error) {
      console.error(`[cover-letter] Error generating cover letter: ${error.message}`);
      return this._generateFallback(job, matchedSkills);
    }
  }

  /**
   * Build a concise profile summary for the prompt.
   * @returns {string}
   */
  _buildProfileSummary() {
    const p = this.profile;
    const lines = [
      `Nom: ${p.prenom} ${p.nom}`,
      `Formation: ${p.formation.diplome} à ${p.formation.ecole} (${p.formation.niveau})`,
      `Localisation: ${p.localisation}`,
      '',
      'Compétences techniques:',
    ];

    const comp = p.competences || {};
    for (const [category, skills] of Object.entries(comp)) {
      if (Array.isArray(skills) && skills.length > 0) {
        const label = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`  ${label}: ${skills.join(', ')}`);
      }
    }

    lines.push('', 'Expériences:');
    for (const exp of (p.experiences || []).slice(0, 3)) {
      lines.push(`  - ${exp.poste} chez ${exp.entreprise} (${exp.periode}): ${exp.description.substring(0, 200)}`);
    }

    lines.push('', 'Projets personnels:');
    for (const proj of (p.projets || []).slice(0, 3)) {
      lines.push(`  - ${proj.nom}: ${proj.description.substring(0, 150)}`);
    }

    lines.push('', `Soft skills: ${(p.soft_skills || []).join(', ')}`);

    return lines.join('\n');
  }

  /**
   * Call the appropriate LLM API.
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async _callLLM(prompt) {
    switch (this.provider) {
      case 'anthropic':
        return this._callAnthropic(prompt);
      case 'openai':
        return this._callOpenAI(prompt);
      case 'gemini':
        return this._callGemini(prompt);
      case 'ollama':
        return this._callOllama(prompt);
      default:
        throw new Error(`No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY in .env, or install Ollama.`);
    }
  }

  async _callAnthropic(prompt) {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    return response.data.content[0].text;
  }

  async _callOpenAI(prompt) {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.choices[0].message.content;
  }

  async _callGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data.candidates[0].content.parts[0].text;
  }

  async _callOllama(prompt) {
    try {
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3',
        prompt: prompt,
        stream: false,
      }, { timeout: 120000 }); // 2 min timeout for local models
      return response.data.response;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama is not running. Start it with `ollama serve` or configure a cloud API key.');
      }
      throw error;
    }
  }

  /**
   * Fallback: generate a basic template-based cover letter without LLM.
   * @param {Object} job
   * @param {Array<string>} matchedSkills
   * @returns {string}
   */
  _generateFallback(job, matchedSkills) {
    const p = this.profile;
    const skills = matchedSkills.length > 0 ? matchedSkills.slice(0, 5).join(', ') : 'Docker, Linux, CI/CD';

    return `Madame, Monsieur,

Actuellement en ${p.formation.niveau} ${p.formation.diplome} à ${p.formation.ecole}, je suis à la recherche d'une alternance à partir de ${p.recherche.date_debut}. L'offre de ${job.title} chez ${job.company} a retenu toute mon attention.

Au cours de ma formation et de mes projets personnels, j'ai développé des compétences solides en ${skills}. Mon home-lab personnel, composé de 18 conteneurs Docker orchestrés avec Ansible, témoigne de mon investissement concret dans les technologies d'infrastructure et de conteneurisation.

Mon stage chez ED&DISCE m'a permis de mettre en pratique mes compétences en développement (Next.js 14, React, TypeScript) dans un contexte professionnel en totale autonomie et en télétravail. Cette expérience a renforcé ma capacité à livrer des solutions techniques de qualité de manière indépendante.

Je serais ravi de mettre mes compétences au service de ${job.company} et d'approfondir mon expertise dans le cadre de cette alternance.

Dans l'attente de votre retour, je reste disponible pour un entretien à votre convenance.

Cordialement,
${p.prenom} ${p.nom}`;
  }
}

module.exports = { CoverLetterGenerator };
