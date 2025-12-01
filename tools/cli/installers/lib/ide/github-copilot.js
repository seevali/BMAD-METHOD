const path = require('node:path');
const { BaseIdeSetup } = require('./_base-ide');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { AgentCommandGenerator } = require('./shared/agent-command-generator');

/**
 * GitHub Copilot setup handler
 * Creates agents in .github/agents/ and configures VS Code settings
 */
class GitHubCopilotSetup extends BaseIdeSetup {
  constructor() {
    super('github-copilot', 'GitHub Copilot', true); // preferred IDE
    this.configDir = '.github';
    this.agentsDir = 'agents';
    this.vscodeDir = '.vscode';
  }

  /**
   * Collect configuration choices before installation
   * @param {Object} options - Configuration options
   * @returns {Object} Collected configuration
   */
  async collectConfiguration(options = {}) {
    const config = {};

    console.log('\n' + chalk.blue('  🔧 VS Code Settings Configuration'));
    console.log(chalk.dim('  GitHub Copilot works best with specific settings\n'));

    const response = await inquirer.prompt([
      {
        type: 'list',
        name: 'configChoice',
        message: 'How would you like to configure VS Code settings?',
        choices: [
          { name: 'Use recommended defaults (fastest)', value: 'defaults' },
          { name: 'Configure each setting manually', value: 'manual' },
          { name: 'Skip settings configuration', value: 'skip' },
        ],
        default: 'defaults',
      },
    ]);
    config.vsCodeConfig = response.configChoice;

    if (response.configChoice === 'manual') {
      config.manualSettings = await inquirer.prompt([
        {
          type: 'input',
          name: 'maxRequests',
          message: 'Maximum requests per session (1-50)?',
          default: '15',
          validate: (input) => {
            const num = parseInt(input, 10);
            if (isNaN(num)) return 'Enter a valid number 1-50';
            return (num >= 1 && num <= 50) || 'Enter 1-50';
          },
        },
        {
          type: 'confirm',
          name: 'runTasks',
          message: 'Allow running workspace tasks?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'mcpDiscovery',
          message: 'Enable MCP server discovery?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'autoFix',
          message: 'Enable automatic error fixing?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'autoApprove',
          message: 'Auto-approve tools (less secure)?',
          default: false,
        },
      ]);
    }

    return config;
  }

  /**
   * Setup GitHub Copilot configuration
   * @param {string} projectDir - Project directory
   * @param {string} bmadDir - BMAD installation directory
   * @param {Object} options - Setup options
   */
  async setup(projectDir, bmadDir, options = {}) {
    console.log(chalk.cyan(`Setting up ${this.name}...`));

    // Configure VS Code settings using pre-collected config if available
    const config = options.preCollectedConfig || {};
    await this.configureVsCodeSettings(projectDir, { ...options, ...config });

    // Create .github/agents directory
    const githubDir = path.join(projectDir, this.configDir);
    const agentsDir = path.join(githubDir, this.agentsDir);
    await this.ensureDir(agentsDir);

    // Clean up any existing BMAD files before reinstalling
    await this.cleanup(projectDir);

    // Generate agent launchers
    const agentGen = new AgentCommandGenerator(this.bmadFolderName);
    const { artifacts: agentArtifacts } = await agentGen.collectAgentArtifacts(bmadDir, options.selectedModules || []);

    // Create agent files with bmd- prefix
    let agentCount = 0;
    for (const artifact of agentArtifacts) {
      const content = artifact.content;
      const agentContent = await this.createAgentContent({ module: artifact.module, name: artifact.name }, content);

      // Use bmd- prefix: bmd-custom-{module}-{name}.agent.md
      const targetPath = path.join(agentsDir, `bmd-custom-${artifact.module}-${artifact.name}.agent.md`);
      await this.writeFile(targetPath, agentContent);
      agentCount++;

      console.log(chalk.green(`  ✓ Created agent: bmd-custom-${artifact.module}-${artifact.name}`));
    }

    console.log(chalk.green(`✓ ${this.name} configured:`));
    console.log(chalk.dim(`  - ${agentCount} agents created`));
    console.log(chalk.dim(`  - Agents directory: ${path.relative(projectDir, agentsDir)}`));
    console.log(chalk.dim(`  - VS Code settings configured`));
    console.log(chalk.dim('\n  Agents available in VS Code Chat view'));

    return {
      success: true,
      agents: agentCount,
      settings: true,
    };
  }

  /**
   * Configure VS Code settings for GitHub Copilot
   */
  async configureVsCodeSettings(projectDir, options) {
    const fs = require('fs-extra');
    const vscodeDir = path.join(projectDir, this.vscodeDir);
    const settingsPath = path.join(vscodeDir, 'settings.json');

    await this.ensureDir(vscodeDir);

    // Read existing settings
    let existingSettings = {};
    if (await fs.pathExists(settingsPath)) {
      try {
        const content = await fs.readFile(settingsPath, 'utf8');
        existingSettings = JSON.parse(content);
        console.log(chalk.yellow('  Found existing .vscode/settings.json'));
      } catch {
        console.warn(chalk.yellow('  Could not parse settings.json, creating new'));
      }
    }

    // Use pre-collected configuration or skip if not available
    let configChoice = options.vsCodeConfig;
    if (!configChoice) {
      // If no pre-collected config, skip configuration
      console.log(chalk.yellow('  ⚠ No configuration collected, skipping VS Code settings'));
      return;
    }

    if (configChoice === 'skip') {
      console.log(chalk.yellow('  ⚠ Skipping VS Code settings'));
      return;
    }

    let bmadSettings = {};

    if (configChoice === 'defaults') {
      bmadSettings = {
        'chat.agent.enabled': true,
        'chat.agent.maxRequests': 15,
        'github.copilot.chat.agent.runTasks': true,
        'chat.mcp.discovery.enabled': true,
        'github.copilot.chat.agent.autoFix': true,
        'chat.tools.autoApprove': false,
      };
      console.log(chalk.green('  ✓ Using recommended defaults'));
    } else {
      // Manual configuration - use pre-collected settings
      const manual = options.manualSettings || {};

      const maxRequests = parseInt(manual.maxRequests || '15', 10);
      bmadSettings = {
        'chat.agent.enabled': true,
        'chat.agent.maxRequests': isNaN(maxRequests) ? 15 : maxRequests,
        'github.copilot.chat.agent.runTasks': manual.runTasks === undefined ? true : manual.runTasks,
        'chat.mcp.discovery.enabled': manual.mcpDiscovery === undefined ? true : manual.mcpDiscovery,
        'github.copilot.chat.agent.autoFix': manual.autoFix === undefined ? true : manual.autoFix,
        'chat.tools.autoApprove': manual.autoApprove || false,
      };
    }

    // Merge settings (existing take precedence)
    const mergedSettings = { ...bmadSettings, ...existingSettings };

    // Write settings
    await fs.writeFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
    console.log(chalk.green('  ✓ VS Code settings configured'));
  }

  /**
   * Get handoffs configuration for a specific agent based on BMAD workflow
   * Handoffs enable guided transitions between agents with context preservation
   * Reference: https://code.visualstudio.com/docs/copilot/customization/custom-agents
   * @param {string} agentName - The agent name (e.g., 'pm', 'architect', 'dev')
   * @param {string} moduleName - The module name (e.g., 'bmm', 'core')
   * @returns {Array} Array of handoff configurations
   */
  getAgentHandoffs(agentName, moduleName) {
    // BMAD Method workflow handoffs for BMM module
    // The development workflow is: PM → Architect → PM → SM → Dev → SM
    const bmmHandoffs = {
      // Product Manager handoffs
      pm: [
        {
          to: 'bmd-custom-bmm-architect',
          label: 'Hand off to Architect',
          prompt: 'Review the PRD and create the system architecture document.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-sm',
          label: 'Hand off to Scrum Master',
          prompt: 'PRD and architecture are complete. Please run sprint planning and prepare stories.',
          send: false,
        },
      ],
      // Architect handoffs
      architect: [
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Hand off to PM',
          prompt: 'Architecture document is complete. Please create epics and user stories.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-sm',
          label: 'Hand off to Scrum Master',
          prompt: 'Architecture is ready. Please validate implementation readiness.',
          send: false,
        },
      ],
      // Scrum Master handoffs
      sm: [
        {
          to: 'bmd-custom-bmm-dev',
          label: 'Hand off to Developer',
          prompt: 'Story is ready for implementation. Please develop this story following the acceptance criteria.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Hand off to PM',
          prompt: 'Need product clarification on story requirements.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-architect',
          label: 'Hand off to Architect',
          prompt: 'Need technical guidance on implementation approach.',
          send: false,
        },
      ],
      // Developer handoffs
      dev: [
        {
          to: 'bmd-custom-bmm-sm',
          label: 'Hand off to Scrum Master',
          prompt: 'Story implementation complete. Please review and facilitate code review.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-tea',
          label: 'Hand off to Test Engineer',
          prompt: 'Code is ready for testing. Please validate the implementation.',
          send: false,
        },
      ],
      // Test Engineer handoffs
      tea: [
        {
          to: 'bmd-custom-bmm-dev',
          label: 'Hand off to Developer',
          prompt: 'Tests identified issues. Please fix the failing tests.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-sm',
          label: 'Hand off to Scrum Master',
          prompt: 'All tests passing. Story is complete and ready for review.',
          send: false,
        },
      ],
      // Analyst handoffs
      analyst: [
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Hand off to PM',
          prompt: 'Analysis complete. Please review findings and create the PRD.',
          send: false,
        },
      ],
      // UX Designer handoffs
      'ux-designer': [
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Hand off to PM',
          prompt: 'UX designs are complete. Please incorporate into the PRD.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-architect',
          label: 'Hand off to Architect',
          prompt: 'UX designs are ready for technical review.',
          send: false,
        },
      ],
      // Tech Writer handoffs
      'tech-writer': [
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Hand off to PM',
          prompt: 'Documentation is ready for review.',
          send: false,
        },
      ],
      // Quick Flow Solo Dev handoffs
      'quick-flow-solo-dev': [
        {
          to: 'bmd-custom-bmm-tea',
          label: 'Hand off to Test Engineer',
          prompt: 'Implementation complete. Please validate the code.',
          send: false,
        },
      ],
    };

    // Core module handoffs
    const coreHandoffs = {
      'bmad-master': [
        {
          to: 'bmd-custom-bmm-pm',
          label: 'Start with PM',
          prompt: 'Begin the BMAD workflow by creating a PRD.',
          send: false,
        },
        {
          to: 'bmd-custom-bmm-analyst',
          label: 'Start with Analyst',
          prompt: 'Begin with requirements analysis.',
          send: false,
        },
      ],
    };

    // BMGD (Game Development) module handoffs
    // The game dev workflow is: Game Designer → Game Architect → Game SM → Game Dev
    const bmgdHandoffs = {
      'game-designer': [
        {
          to: 'bmd-custom-bmgd-game-architect',
          label: 'Hand off to Game Architect',
          prompt: 'Game design is complete. Please create the technical architecture.',
          send: false,
        },
      ],
      'game-architect': [
        {
          to: 'bmd-custom-bmgd-game-designer',
          label: 'Hand off to Game Designer',
          prompt: 'Need design clarification for technical decisions.',
          send: false,
        },
        {
          to: 'bmd-custom-bmgd-game-scrum-master',
          label: 'Hand off to Game Scrum Master',
          prompt: 'Architecture is ready. Please prepare sprints and stories.',
          send: false,
        },
      ],
      'game-scrum-master': [
        {
          to: 'bmd-custom-bmgd-game-dev',
          label: 'Hand off to Game Developer',
          prompt: 'Story is ready for implementation.',
          send: false,
        },
        {
          to: 'bmd-custom-bmgd-game-architect',
          label: 'Hand off to Game Architect',
          prompt: 'Need technical guidance on implementation.',
          send: false,
        },
      ],
      'game-dev': [
        {
          to: 'bmd-custom-bmgd-game-scrum-master',
          label: 'Hand off to Game Scrum Master',
          prompt: 'Implementation complete. Ready for review.',
          send: false,
        },
      ],
    };

    // CIS (Creative & Innovation Studio) module handoffs
    // Creative agents can hand off between each other
    const cisHandoffs = {
      'brainstorming-coach': [
        {
          to: 'bmd-custom-cis-creative-problem-solver',
          label: 'Hand off to Problem Solver',
          prompt: 'Ideas generated. Please help refine and solve implementation challenges.',
          send: false,
        },
        {
          to: 'bmd-custom-cis-design-thinking-coach',
          label: 'Hand off to Design Thinking Coach',
          prompt: 'Brainstorming complete. Please apply design thinking methodology.',
          send: false,
        },
      ],
      'creative-problem-solver': [
        {
          to: 'bmd-custom-cis-innovation-strategist',
          label: 'Hand off to Innovation Strategist',
          prompt: 'Solutions identified. Please develop the innovation strategy.',
          send: false,
        },
      ],
      'design-thinking-coach': [
        {
          to: 'bmd-custom-cis-creative-problem-solver',
          label: 'Hand off to Problem Solver',
          prompt: 'Design thinking process complete. Please help solve remaining challenges.',
          send: false,
        },
      ],
      'innovation-strategist': [
        {
          to: 'bmd-custom-cis-presentation-master',
          label: 'Hand off to Presentation Master',
          prompt: 'Strategy is ready. Please help create the presentation.',
          send: false,
        },
        {
          to: 'bmd-custom-cis-storyteller',
          label: 'Hand off to Storyteller',
          prompt: 'Strategy complete. Please craft the narrative.',
          send: false,
        },
      ],
      'presentation-master': [
        {
          to: 'bmd-custom-cis-storyteller',
          label: 'Hand off to Storyteller',
          prompt: 'Presentation structure ready. Please enhance the storytelling.',
          send: false,
        },
      ],
      storyteller: [
        {
          to: 'bmd-custom-cis-presentation-master',
          label: 'Hand off to Presentation Master',
          prompt: 'Story is crafted. Please finalize the presentation.',
          send: false,
        },
      ],
    };

    // BMB (BMAD Builder) module handoffs - for building BMAD itself
    const bmbHandoffs = {
      'bmad-builder': [
        {
          to: 'bmd-custom-core-bmad-master',
          label: 'Hand off to BMAD Master',
          prompt: 'Module/agent creation complete. Please verify and orchestrate.',
          send: false,
        },
      ],
    };

    // Return appropriate handoffs based on module
    switch (moduleName) {
      case 'bmm': {
        return bmmHandoffs[agentName] || [];
      }
      case 'core': {
        return coreHandoffs[agentName] || [];
      }
      case 'bmgd': {
        return bmgdHandoffs[agentName] || [];
      }
      case 'cis': {
        return cisHandoffs[agentName] || [];
      }
      case 'bmb': {
        return bmbHandoffs[agentName] || [];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Create agent content
   */
  async createAgentContent(agent, content) {
    // Extract metadata from launcher frontmatter if present
    const descMatch = content.match(/description:\s*"([^"]+)"/);
    const title = descMatch ? descMatch[1] : this.formatTitle(agent.name);

    const description = `Activates the ${title} agent persona.`;

    // Strip any existing frontmatter from the content
    const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
    let cleanContent = content;
    if (frontmatterRegex.test(content)) {
      cleanContent = content.replace(frontmatterRegex, '').trim();
    }

    // Available GitHub Copilot tools (November 2025 - Official VS Code Documentation)
    // Reference: https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features#_chat-tools
    const tools = [
      'changes', // List of source control changes
      'edit', // Edit files in your workspace including: createFile, createDirectory, editNotebook, newJupyterNotebook and editFiles
      'fetch', // Fetch content from web page
      'githubRepo', // Perform code search in GitHub repo
      'problems', // Add workspace issues from Problems panel
      'runCommands', // Runs commands in the terminal including: getTerminalOutput, terminalSelection, terminalLastCommand and runInTerminal
      'runTasks', // Runs tasks and gets their output for your workspace
      'runTests', // Run unit tests in workspace
      'search', // Search and read files in your workspace, including:fileSearch, textSearch, listDirectory, readFile, codebase and searchResults
      'runSubagent', // Runs a task within an isolated subagent context. Enables efficient organization of tasks and context window management.
      'testFailure', // Get unit test failure information
      'todos', // Tool for managing and tracking todo items for task planning
      'usages', // Find references and navigate definitions
    ];

    // Get handoffs for this agent based on its module and name
    const handoffs = this.getAgentHandoffs(agent.name, agent.module);

    // Build the YAML frontmatter
    let frontmatter = `---
description: "${description.replaceAll('"', String.raw`\"`)}"
tools: ${JSON.stringify(tools)}`;

    // Add handoffs if available (VS Code Agents Framework feature)
    if (handoffs.length > 0) {
      frontmatter += `
handoffs:`;
      for (const handoff of handoffs) {
        frontmatter += `
  - to: "${handoff.to}"
    label: "${handoff.label}"
    prompt: "${handoff.prompt.replaceAll('"', String.raw`\"`)}"
    send: ${handoff.send}`;
      }
    }

    frontmatter += `
---`;

    let agentContent = `${frontmatter}

# ${title} Agent

${cleanContent}

`;

    return agentContent;
  }

  /**
   * Format name as title
   */
  formatTitle(name) {
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Cleanup GitHub Copilot configuration - surgically remove only BMAD files
   */
  async cleanup(projectDir) {
    const fs = require('fs-extra');

    // Clean up old chatmodes directory
    const chatmodesDir = path.join(projectDir, this.configDir, 'chatmodes');
    if (await fs.pathExists(chatmodesDir)) {
      const files = await fs.readdir(chatmodesDir);
      let removed = 0;

      for (const file of files) {
        if (file.startsWith('bmad-') && file.endsWith('.chatmode.md')) {
          await fs.remove(path.join(chatmodesDir, file));
          removed++;
        }
      }

      if (removed > 0) {
        console.log(chalk.dim(`  Cleaned up ${removed} old BMAD chat modes`));
      }
    }

    // Clean up new agents directory
    const agentsDir = path.join(projectDir, this.configDir, this.agentsDir);
    if (await fs.pathExists(agentsDir)) {
      const files = await fs.readdir(agentsDir);
      let removed = 0;

      for (const file of files) {
        if (file.startsWith('bmd-') && file.endsWith('.agent.md')) {
          await fs.remove(path.join(agentsDir, file));
          removed++;
        }
      }

      if (removed > 0) {
        console.log(chalk.dim(`  Cleaned up ${removed} existing BMAD agents`));
      }
    }
  }

  /**
   * Install a custom agent launcher for GitHub Copilot
   * @param {string} projectDir - Project directory
   * @param {string} agentName - Agent name (e.g., "fred-commit-poet")
   * @param {string} agentPath - Path to compiled agent (relative to project root)
   * @param {Object} metadata - Agent metadata
   * @returns {Object|null} Info about created command
   */
  async installCustomAgentLauncher(projectDir, agentName, agentPath, metadata) {
    const agentsDir = path.join(projectDir, this.configDir, this.agentsDir);

    if (!(await this.exists(path.join(projectDir, this.configDir)))) {
      return null; // IDE not configured for this project
    }

    await this.ensureDir(agentsDir);

    const launcherContent = `You must fully embody this agent's persona and follow all activation instructions exactly as specified. NEVER break character until given an exit command.

<agent-activation CRITICAL="TRUE">
1. LOAD the FULL agent file from @${agentPath}
2. READ its entire contents - this contains the complete agent persona, menu, and instructions
3. FOLLOW every step in the <activation> section precisely
4. DISPLAY the welcome/greeting as instructed
5. PRESENT the numbered menu
6. WAIT for user input before proceeding
</agent-activation>
`;

    // GitHub Copilot needs specific tools in frontmatter
    const copilotTools = [
      'changes',
      'codebase',
      'createDirectory',
      'createFile',
      'editFiles',
      'fetch',
      'fileSearch',
      'githubRepo',
      'listDirectory',
      'problems',
      'readFile',
      'runInTerminal',
      'runTask',
      'runTests',
      'runVscodeCommand',
      'search',
      'searchResults',
      'terminalLastCommand',
      'terminalSelection',
      'testFailure',
      'textSearch',
      'usages',
    ];

    const agentContent = `---
description: "Activates the ${metadata.title || agentName} agent persona."
tools: ${JSON.stringify(copilotTools)}
---

# ${metadata.title || agentName} Agent

${launcherContent}
`;

    const agentFilePath = path.join(agentsDir, `bmd-custom-${agentName}.agent.md`);
    await this.writeFile(agentFilePath, agentContent);

    return {
      path: agentFilePath,
      command: `bmd-custom-${agentName}`,
    };
  }
}

module.exports = { GitHubCopilotSetup };
