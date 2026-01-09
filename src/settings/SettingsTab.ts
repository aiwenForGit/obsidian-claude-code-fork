import { App, PluginSettingTab, Setting, Modal, TextComponent, ButtonComponent } from "obsidian";
import type ClaudeCodePlugin from "../main";
import { McpServerConfig } from "../types";

export class ClaudeCodeSettingTab extends PluginSettingTab {
  plugin: ClaudeCodePlugin;

  constructor(app: App, plugin: ClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claude Code Settings" });

    // API Configuration Section.
    containerEl.createEl("h3", { text: "Authentication" });

    // Check for environment variables.
    const hasEnvApiKey = !!process.env.ANTHROPIC_API_KEY;
    const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (hasEnvApiKey || hasOAuthToken) {
      const envNotice = containerEl.createDiv({ cls: "claude-code-env-notice" });
      envNotice.createEl("p", {
        text: hasOAuthToken
          ? "Using Claude Max subscription via CLAUDE_CODE_OAUTH_TOKEN environment variable."
          : "Using API key from ANTHROPIC_API_KEY environment variable.",
        cls: "mod-success",
      });
    }

    new Setting(containerEl)
      .setName("API Key")
      .setDesc(
        hasEnvApiKey || hasOAuthToken
          ? "Optional: Override the environment variable with a specific key"
          : "Your Anthropic API key. Get one at console.anthropic.com"
      )
      .addText((text) =>
        text
          .setPlaceholder(hasEnvApiKey ? "(using env var)" : "sk-ant-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      )
      .then((setting) => {
        // Make the input a password field.
        const inputEl = setting.controlEl.querySelector("input");
        if (inputEl) {
          inputEl.type = "password";
        }
      });

    // Claude Max subscription info.
    const authInfoEl = containerEl.createDiv({ cls: "claude-code-auth-info" });
    authInfoEl.createEl("details", {}, (details) => {
      details.createEl("summary", { text: "Using Claude Max subscription?" });
      details.createEl("p", {
        text: "If you have a Claude Pro or Max subscription, you can use it instead of an API key:",
      });
      const steps = details.createEl("ol");
      steps.createEl("li", {
        text: "Run 'claude setup-token' in your terminal to authenticate with your subscription",
      });
      steps.createEl("li", {
        text: "This creates a CLAUDE_CODE_OAUTH_TOKEN environment variable",
      });
      steps.createEl("li", { text: "Restart Obsidian to pick up the token" });
      details.createEl("p", {
        text: "Note: If ANTHROPIC_API_KEY is also set, the API key takes precedence.",
        cls: "mod-warning",
      });
    });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Claude model to use for conversations")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sonnet", "Sonnet (Faster)")
          .addOption("opus", "Opus (More capable)")
          .addOption("haiku", "Haiku (Fastest)")
          .setValue(this.plugin.settings.model || "sonnet")
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    // Permissions Section.
    containerEl.createEl("h3", { text: "Permissions" });

    new Setting(containerEl)
      .setName("Auto-approve vault reads")
      .setDesc("Automatically allow Claude to read files in your vault")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveVaultReads).onChange(async (value) => {
          this.plugin.settings.autoApproveVaultReads = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-approve vault writes")
      .setDesc("Automatically allow Claude to create and edit files in your vault")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveVaultWrites).onChange(async (value) => {
          this.plugin.settings.autoApproveVaultWrites = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Require approval for commands")
      .setDesc("Require explicit approval before executing shell commands")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.requireBashApproval).onChange(async (value) => {
          this.plugin.settings.requireBashApproval = value;
          await this.plugin.saveSettings();
        })
      );

    // Always-allowed tools section.
    if (this.plugin.settings.alwaysAllowedTools.length > 0) {
      const alwaysAllowedEl = containerEl.createDiv({ cls: "claude-code-always-allowed" });
      alwaysAllowedEl.createEl("h4", { text: "Always Allowed Tools" });
      alwaysAllowedEl.createEl("p", {
        text: "These tools have been permanently approved. Click to remove.",
        cls: "setting-item-description",
      });

      const toolsList = alwaysAllowedEl.createDiv({ cls: "claude-code-tools-list" });
      for (const tool of this.plugin.settings.alwaysAllowedTools) {
        const toolChip = toolsList.createDiv({ cls: "claude-code-tool-chip" });
        toolChip.createSpan({ text: tool });
        const removeBtn = toolChip.createEl("button", { text: "×", cls: "claude-code-tool-chip-remove" });
        removeBtn.addEventListener("click", async () => {
          this.plugin.settings.alwaysAllowedTools = this.plugin.settings.alwaysAllowedTools.filter(
            (t) => t !== tool
          );
          await this.plugin.saveSettings();
          this.display(); // Re-render settings.
        });
      }
    }

    // Agent SDK Section.
    containerEl.createEl("h3", { text: "Agent Settings" });

    new Setting(containerEl)
      .setName("Max budget per session")
      .setDesc("Maximum cost in USD before requiring confirmation to continue")
      .addText((text) =>
        text
          .setPlaceholder("10.00")
          .setValue(String(this.plugin.settings.maxBudgetPerSession))
          .onChange(async (value) => {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxBudgetPerSession = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max turns per query")
      .setDesc("Maximum conversation turns (tool use cycles) per query")
      .addText((text) =>
        text
          .setPlaceholder("50")
          .setValue(String(this.plugin.settings.maxTurns))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxTurns = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    // MCP Servers Section.
    containerEl.createEl("h3", { text: "MCP Servers" });

    const mcpDescEl = containerEl.createDiv({ cls: "setting-item-description" });
    mcpDescEl.createEl("p", {
      text: "Add external MCP (Model Context Protocol) servers to extend Claude's capabilities. Each server provides additional tools that Claude can use.",
    });

    // Add new MCP server button.
    new Setting(containerEl)
      .setName("Add MCP Server")
      .setDesc("Add a new MCP server configuration")
      .addButton((button) =>
        button
          .setButtonText("+ Add Server")
          .setCta()
          .onClick(() => {
            const modal = new McpServerModal(this.app, null, async (server) => {
              if (!this.plugin.settings.mcpServers) {
                this.plugin.settings.mcpServers = [];
              }
              this.plugin.settings.mcpServers.push(server);
              await this.plugin.saveSettings();
              this.display(); // Re-render settings.
            });
            modal.open();
          })
      );

    // List existing MCP servers.
    const servers = this.plugin.settings.mcpServers || [];
    if (servers.length > 0) {
      const serversEl = containerEl.createDiv({ cls: "claude-code-mcp-servers" });

      for (const server of servers) {
        const serverEl = serversEl.createDiv({ cls: "claude-code-mcp-server-item" });

        // Server info.
        const infoEl = serverEl.createDiv({ cls: "claude-code-mcp-server-info" });
        const headerEl = infoEl.createDiv({ cls: "claude-code-mcp-server-header" });

        // Enable/disable toggle.
        const toggleEl = headerEl.createEl("input", { type: "checkbox" });
        toggleEl.checked = server.enabled;
        toggleEl.addEventListener("change", async () => {
          server.enabled = toggleEl.checked;
          await this.plugin.saveSettings();
        });

        headerEl.createEl("span", { text: server.name, cls: "claude-code-mcp-server-name" });

        const detailsEl = infoEl.createDiv({ cls: "claude-code-mcp-server-details" });
        detailsEl.createEl("code", { text: `${server.command} ${server.args.join(" ")}` });

        // Actions.
        const actionsEl = serverEl.createDiv({ cls: "claude-code-mcp-server-actions" });

        // Edit button.
        const editBtn = actionsEl.createEl("button", { text: "Edit", cls: "mod-cta" });
        editBtn.addEventListener("click", () => {
          const modal = new McpServerModal(this.app, server, async (updated) => {
            Object.assign(server, updated);
            await this.plugin.saveSettings();
            this.display();
          });
          modal.open();
        });

        // Delete button.
        const deleteBtn = actionsEl.createEl("button", { text: "Delete", cls: "mod-warning" });
        deleteBtn.addEventListener("click", async () => {
          this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter(
            (s) => s.id !== server.id
          );
          await this.plugin.saveSettings();
          this.display();
        });
      }
    }

    // MCP server presets/examples.
    const presetsEl = containerEl.createDiv({ cls: "claude-code-mcp-presets" });
    presetsEl.createEl("details", {}, (details) => {
      details.createEl("summary", { text: "Common MCP Server Examples" });

      const examplesEl = details.createDiv({ cls: "claude-code-mcp-examples" });

      // Filesystem server example.
      examplesEl.createEl("h5", { text: "Filesystem Server" });
      examplesEl.createEl("pre", {
        text: `Command: npx
Args: -y @anthropic-ai/mcp-server-filesystem /path/to/directory`,
      });

      // GitHub server example.
      examplesEl.createEl("h5", { text: "GitHub Server" });
      examplesEl.createEl("pre", {
        text: `Command: npx
Args: -y @anthropic-ai/mcp-server-github
Env: GITHUB_TOKEN=your_token`,
      });

      // Web search server example.
      examplesEl.createEl("h5", { text: "Brave Search Server" });
      examplesEl.createEl("pre", {
        text: `Command: npx
Args: -y @anthropic-ai/mcp-server-brave-search
Env: BRAVE_API_KEY=your_key`,
      });

      // Database server example.
      examplesEl.createEl("h5", { text: "SQLite Server" });
      examplesEl.createEl("pre", {
        text: `Command: npx
Args: -y @anthropic-ai/mcp-server-sqlite /path/to/database.db`,
      });
    });

    // About Section.
    containerEl.createEl("h3", { text: "About" });

    const aboutEl = containerEl.createDiv({ cls: "claude-code-settings-about" });
    aboutEl.createEl("p", {
      text: "Claude Code brings AI-powered assistance to your Obsidian vault using the Claude Agent SDK. Ask questions, automate tasks, search notes semantically, and get help with your knowledge base.",
    });
    aboutEl.createEl("p", {
      text: "Features: Built-in tools (Read, Write, Bash, Grep), skill loading from .claude/skills/, Obsidian-specific tools (open files, run commands), and semantic vault search.",
    });
  }
}

// Modal for adding/editing MCP server configuration.
class McpServerModal extends Modal {
  private server: McpServerConfig | null;
  private onSave: (server: McpServerConfig) => void;

  // Form fields.
  private nameInput!: TextComponent;
  private commandInput!: TextComponent;
  private argsInput!: TextComponent;
  private envInput!: HTMLTextAreaElement;

  constructor(app: App, server: McpServerConfig | null, onSave: (server: McpServerConfig) => void) {
    super(app);
    this.server = server;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.server ? "Edit MCP Server" : "Add MCP Server" });

    // Name field.
    new Setting(contentEl)
      .setName("Server Name")
      .setDesc("A unique name to identify this server")
      .addText((text) => {
        this.nameInput = text;
        text
          .setPlaceholder("e.g., filesystem, github")
          .setValue(this.server?.name || "");
      });

    // Command field.
    new Setting(contentEl)
      .setName("Command")
      .setDesc("The command to run (e.g., npx, node, python)")
      .addText((text) => {
        this.commandInput = text;
        text
          .setPlaceholder("npx")
          .setValue(this.server?.command || "npx");
      });

    // Args field.
    new Setting(contentEl)
      .setName("Arguments")
      .setDesc("Space-separated arguments (e.g., -y @anthropic-ai/mcp-server-filesystem /path)")
      .addText((text) => {
        this.argsInput = text;
        text
          .setPlaceholder("-y @anthropic-ai/mcp-server-xxx")
          .setValue(this.server?.args?.join(" ") || "");
        // Make input wider.
        text.inputEl.style.width = "300px";
      });

    // Environment variables field.
    const envSetting = new Setting(contentEl)
      .setName("Environment Variables")
      .setDesc("One per line: KEY=value");

    this.envInput = envSetting.controlEl.createEl("textarea", {
      cls: "claude-code-mcp-env-input",
      attr: {
        placeholder: "GITHUB_TOKEN=xxx\nAPI_KEY=yyy",
        rows: "4",
      },
    });
    this.envInput.style.width = "300px";
    this.envInput.style.fontFamily = "monospace";

    // Populate env if editing.
    if (this.server?.env) {
      this.envInput.value = Object.entries(this.server.env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }

    // Buttons.
    const buttonEl = contentEl.createDiv({ cls: "claude-code-modal-buttons" });
    buttonEl.style.display = "flex";
    buttonEl.style.justifyContent = "flex-end";
    buttonEl.style.gap = "8px";
    buttonEl.style.marginTop = "16px";

    const cancelBtn = buttonEl.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = buttonEl.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => this.save());
  }

  private save() {
    const name = this.nameInput.getValue().trim();
    const command = this.commandInput.getValue().trim();
    const argsStr = this.argsInput.getValue().trim();

    // Validation.
    if (!name) {
      new (require("obsidian").Notice)("Server name is required");
      return;
    }
    if (!command) {
      new (require("obsidian").Notice)("Command is required");
      return;
    }

    // Parse args.
    const args = argsStr ? argsStr.split(/\s+/) : [];

    // Parse env.
    const env: Record<string, string> = {};
    const envLines = this.envInput.value.split("\n").filter((l) => l.trim());
    for (const line of envLines) {
      const eqIndex = line.indexOf("=");
      if (eqIndex > 0) {
        const key = line.slice(0, eqIndex).trim();
        const value = line.slice(eqIndex + 1).trim();
        if (key) {
          env[key] = value;
        }
      }
    }

    const server: McpServerConfig = {
      id: this.server?.id || `mcp-${Date.now()}`,
      name,
      command,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
      enabled: this.server?.enabled ?? true,
    };

    this.onSave(server);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
