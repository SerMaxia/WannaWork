/**
 * Job matching engine.
 * Calculates a relevance score (0-100) between a job offer and the candidate profile.
 * Uses keyword matching with synonym support and weighted scoring.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Synonym mapping for tech skills
const SYNONYMS = {
  'kubernetes': ['k8s', 'kube'],
  'javascript': ['js'],
  'typescript': ['ts'],
  'docker': ['conteneur', 'conteneurisation', 'container'],
  'ci/cd': ['cicd', 'ci cd', 'continuous integration', 'intégration continue', 'déploiement continu', 'pipeline'],
  'github actions': ['github action', 'gh actions'],
  'gitlab ci': ['gitlab-ci', 'gitlab ci/cd'],
  'react': ['reactjs', 'react.js'],
  'next.js': ['nextjs', 'next'],
  'node.js': ['nodejs', 'node'],
  'ansible': ['playbook ansible'],
  'terraform': ['iac', 'infrastructure as code'],
  'linux': ['ubuntu', 'debian', 'centos', 'rhel', 'arch'],
  'windows server': ['active directory', 'ad', 'gpo'],
  'sql': ['mysql', 'postgresql', 'postgres', 'mariadb'],
  'mongodb': ['mongo', 'nosql'],
  'grafana': ['monitoring', 'supervision'],
  'prometheus': ['alertmanager'],
  'nginx': ['reverse proxy'],
  'python': ['py'],
  'bash': ['shell', 'scripting shell'],
  'devops': ['dev ops', 'sre', 'site reliability'],
  'sysadmin': ['administrateur système', 'admin sys', 'system administrator'],
  'fullstack': ['full stack', 'full-stack'],
  'api rest': ['restful', 'api restful', 'rest api'],
  'git': ['github', 'gitlab', 'versionning'],
  'vpn': ['tailscale', 'wireguard', 'openvpn'],
  'firewall': ['pare-feu', 'iptables', 'pfsense', 'dynfi'],
  'vmware': ['virtualisation', 'proxmox', 'hyper-v'],
};

class JobMatcher {
  constructor(profilePath) {
    const resolvedPath = profilePath || path.join(__dirname, '..', '..', 'config', 'profile.yaml');
    const profileContent = fs.readFileSync(resolvedPath, 'utf-8');
    this.profile = yaml.load(profileContent);

    // Build flat skills list from profile
    this.profileSkills = this._buildSkillsList();
  }

  /**
   * Build a flat, normalized list of all skills from the profile.
   * @returns {Array<string>}
   */
  _buildSkillsList() {
    const skills = [];
    const competences = this.profile.competences || {};

    for (const category of Object.values(competences)) {
      if (Array.isArray(category)) {
        skills.push(...category.map(s => s.toLowerCase().trim()));
      }
    }

    return [...new Set(skills)];
  }

  /**
   * Calculate matching score for a job offer.
   * @param {Object} job - Job offer object
   * @returns {Object} { score, matchedSkills, details }
   */
  score(job) {
    const text = `${job.title} ${job.description} ${job.fullDescription || ''}`.toLowerCase();

    // 1. Skills matching (40%)
    const skillsResult = this._matchSkills(text);

    // 2. Location matching (20%)
    const locationScore = this._matchLocation(job.location);

    // 3. Contract type matching (15%)
    const contractScore = this._matchContractType(text, job.contractType);

    // 4. Level matching (15%)
    const levelScore = this._matchLevel(text);

    // 5. Title relevance (10%)
    const titleScore = this._matchTitle(job.title);

    // 6. Exclusion of schools / training centers (Fake jobs)
    const isFakeSchoolJob = this._isSchoolFakeJob(text, job.company);

    // Weighted average
    let totalScore = Math.round(
      skillsResult.score * 0.40 +
      locationScore * 0.20 +
      contractScore * 0.15 +
      levelScore * 0.15 +
      titleScore * 0.10
    );

    if (isFakeSchoolJob) {
      totalScore = 0; // Exclude completely
    }

    return {
      score: Math.min(100, Math.max(0, totalScore)),
      matchedSkills: skillsResult.matched,
      details: {
        skills: { score: skillsResult.score, matched: skillsResult.matched, total: skillsResult.total },
        location: { score: locationScore, value: job.location },
        contract: { score: contractScore },
        level: { score: levelScore },
        title: { score: titleScore },
      },
    };
  }

  /**
   * Match skills between job description and profile.
   * @param {string} text - Lowercase job text
   * @returns {Object} { score, matched, total }
   */
  _matchSkills(text) {
    const matched = [];
    const demanded = this._extractDemandedSkills(text);

    if (demanded.length === 0) {
      // No specific skills found — try profile skills directly
      for (const skill of this.profileSkills) {
        const skillLower = skill.toLowerCase();
        if (text.includes(skillLower) || this._matchWithSynonyms(skillLower, text)) {
          matched.push(skill);
        }
      }
      return {
        score: matched.length > 0 ? Math.min(100, matched.length * 15) : 30,
        matched,
        total: matched.length,
      };
    }

    for (const skill of demanded) {
      if (this._isProfileSkill(skill)) {
        matched.push(skill);
      }
    }

    const score = demanded.length > 0 ? (matched.length / demanded.length) * 100 : 50;
    return { score: Math.round(score), matched, total: demanded.length };
  }

  /**
   * Extract demanded skills from job text.
   * @param {string} text
   * @returns {Array<string>}
   */
  _extractDemandedSkills(text) {
    const allSkills = Object.keys(SYNONYMS);
    const found = [];

    for (const skill of allSkills) {
      if (text.includes(skill) || (SYNONYMS[skill] || []).some(syn => text.includes(syn))) {
        found.push(skill);
      }
    }

    return found;
  }

  /**
   * Check if a skill (or its synonym) is in the profile.
   * @param {string} skill
   * @returns {boolean}
   */
  _isProfileSkill(skill) {
    const skillLower = skill.toLowerCase();

    // Direct match
    if (this.profileSkills.some(ps => ps.includes(skillLower) || skillLower.includes(ps))) {
      return true;
    }

    // Synonym match
    const synonyms = SYNONYMS[skillLower] || [];
    for (const syn of synonyms) {
      if (this.profileSkills.some(ps => ps.includes(syn) || syn.includes(ps))) {
        return true;
      }
    }

    // Reverse synonym match
    for (const [canonical, syns] of Object.entries(SYNONYMS)) {
      if (syns.includes(skillLower) && this.profileSkills.some(ps => ps.includes(canonical))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if text contains a skill or its synonyms.
   */
  _matchWithSynonyms(skill, text) {
    for (const [canonical, syns] of Object.entries(SYNONYMS)) {
      if (canonical === skill || syns.includes(skill)) {
        if (text.includes(canonical) || syns.some(s => text.includes(s))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Match location.
   * @param {string} location
   * @returns {number} 0-100
   */
  _matchLocation(location) {
    if (!location) return 50; // Unknown = neutral

    const loc = location.toLowerCase();
    const zones = this.profile.recherche?.zone_geographique || ['Toulouse', 'Occitanie', 'Remote'];

    if (loc.includes('toulouse') || loc.includes('31')) return 100;
    if (loc.includes('remote') || loc.includes('télétravail') || loc.includes('distanciel')) return 90;
    if (loc.includes('occitanie') || loc.includes('midi-pyrénées')) return 85;
    // Nearby cities
    if (loc.includes('montauban') || loc.includes('albi') || loc.includes('castres') || loc.includes('tarbes')) return 75;
    if (loc.includes('bordeaux') || loc.includes('montpellier') || loc.includes('perpignan')) return 55;
    if (loc.includes('paris') || loc.includes('lyon') || loc.includes('marseille')) return 30;

    // Check if any configured zone matches
    for (const zone of zones) {
      if (loc.includes(zone.toLowerCase())) return 85;
    }

    return 20; // Unknown location
  }

  /**
   * Match contract type.
   * @param {string} text
   * @param {string} contractType
   * @returns {number} 0-100
   */
  _matchContractType(text, contractType) {
    const combined = `${text} ${contractType || ''}`.toLowerCase();

    if (combined.includes('alternance') || combined.includes('apprentissage') || combined.includes('apprenticeship')) return 100;
    if (combined.includes('professionnalisation') || combined.includes('contrat pro')) return 90;
    if (combined.includes('stage') && combined.includes('alternance')) return 80;
    if (combined.includes('stage')) return 30;
    if (combined.includes('cdi') || combined.includes('cdd')) return 10;

    return 50; // Unknown
  }

  /**
   * Match experience level.
   * @param {string} text
   * @returns {number} 0-100
   */
  _matchLevel(text) {
    // Bac+3 student — best match is junior/débutant/bac+3
    if (text.includes('bac+3') || text.includes('bac +3') || text.includes('licence') || text.includes('but')) return 100;
    if (text.includes('junior') || text.includes('débutant') || text.includes('0 à 2 ans') || text.includes('débutant accepté')) return 95;
    if (text.includes('bac+2') || text.includes('bts') || text.includes('dut')) return 75;
    if (text.includes('bac+4') || text.includes('bac+5') || text.includes('ingénieur')) return 50;
    if (text.includes('senior') || text.includes('5 ans') || text.includes('expérimenté')) return 10;
    if (text.includes('confirmé') || text.includes('3 ans')) return 20;

    return 60; // No level specified = neutral
  }

  /**
   * Match title relevance.
   * @param {string} title
   * @returns {number} 0-100
   */
  _matchTitle(title) {
    const t = title.toLowerCase();
    const domaines = this.profile.recherche?.domaines || [];

    let score = 0;

    // High relevance keywords
    const highRelevance = ['devops', 'sre', 'infrastructure', 'sysadmin', 'système', 'réseau', 'admin sys'];
    const medRelevance = ['développeur', 'fullstack', 'full stack', 'backend', 'cloud', 'infra'];
    const lowRelevance = ['web', 'frontend', 'front-end', 'support', 'technicien'];

    if (highRelevance.some(kw => t.includes(kw))) score += 50;
    if (medRelevance.some(kw => t.includes(kw))) score += 30;
    if (lowRelevance.some(kw => t.includes(kw))) score += 15;

    if (t.includes('alternance') || t.includes('apprenti')) score += 30;
    if (t.includes('junior') || t.includes('débutant')) score += 20;

    return Math.min(100, score);
  }

  /**
   * Check if the job offer is likely from a school/training center acting as recruiter.
   * @param {string} text - The combined title and description text
   * @param {string} company - The company name
   * @returns {boolean}
   */
  _isSchoolFakeJob(text, company) {
    const t = text.toLowerCase();
    const c = (company || '').toLowerCase();

    // Specific training centers often posting these
    const schoolNames = ['openclassrooms', 'mydigitalschool', 'epitech', 'epsi', 'wild code school', 'simplon', 'isitech', 'campus', 'école de', 'ecole de'];
    
    // Check if company name explicitly matches known school patterns
    if (schoolNames.some(name => c.includes(name))) return true;

    // Typical phrases used by schools looking for students to place in their partner companies
    const fakeIndicators = [
      'entreprise partenaire',
      'notre partenaire',
      'école partenaire',
      'ecole partenaire',
      'frais de scolarité',
      'recherche pour une entreprise',
      'recherche pour l\'un de ses partenaires',
      'recherche pour un de ses partenaires',
      'formation financée',
      'intégrez notre école',
      'rejoignez notre campus'
    ];

    // If we find multiple indicators or a strong one, we consider it fake
    let indicatorCount = 0;
    for (const indicator of fakeIndicators) {
      if (t.includes(indicator)) {
        indicatorCount++;
      }
    }

    if (indicatorCount >= 1) return true; // Strict exclusion on any match of these very specific school recruiter phrases

    return false;
  }

  /**
   * Determine which CV to use based on the job.
   * @param {Object} job
   * @returns {string} 'devops' or 'dev'
   */
  recommendCV(job) {
    const text = `${job.title} ${job.description || ''}`.toLowerCase();
    const devopsKeywords = ['devops', 'sysadmin', 'système', 'réseau', 'infrastructure', 'linux', 'docker', 'kubernetes', 'ansible', 'sre', 'admin'];
    const devKeywords = ['développeur', 'fullstack', 'frontend', 'backend', 'react', 'next', 'node', 'api', 'web', 'javascript'];

    const devopsCount = devopsKeywords.filter(kw => text.includes(kw)).length;
    const devCount = devKeywords.filter(kw => text.includes(kw)).length;

    return devopsCount >= devCount ? 'devops' : 'dev';
  }
}

module.exports = { JobMatcher };
