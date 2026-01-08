import { MarkdownRenderer, setIcon, TFile } from "obsidian";
import { ChatMessage, ToolCall } from "../types";
import type ClaudeCodePlugin from "../main";
import { ToolCallDisplay } from "./ToolCallDisplay";

export class MessageRenderer {
  private containerEl: HTMLElement;
  private message: ChatMessage;
  private plugin: ClaudeCodePlugin;
  private contentEl: HTMLElement | null = null;
  private toolCallDisplays: Map<string, ToolCallDisplay> = new Map();

  constructor(containerEl: HTMLElement, message: ChatMessage, plugin: ClaudeCodePlugin) {
    this.containerEl = containerEl;
    this.message = message;
    this.plugin = plugin;
  }

  render() {
    this.containerEl.empty();
    this.containerEl.addClass("claude-code-message");
    this.containerEl.addClass(`claude-code-message-${this.message.role}`);

    // Role indicator.
    const roleEl = this.containerEl.createDiv({ cls: "claude-code-message-role" });
    roleEl.setText(this.message.role === "user" ? "You" : "Claude");

    // Content area.
    this.contentEl = this.containerEl.createDiv({ cls: "claude-code-message-content" });
    this.renderContent();

    // Tool calls if any.
    if (this.message.toolCalls && this.message.toolCalls.length > 0) {
      this.renderToolCalls();
    }

    // Streaming indicator.
    if (this.message.isStreaming) {
      this.renderStreamingIndicator();
    }
  }

  private renderContent() {
    if (!this.contentEl) return;
    this.contentEl.empty();

    // Render markdown content.
    // Use "/" as source path so relative links resolve from vault root.
    MarkdownRenderer.render(
      this.plugin.app,
      this.message.content,
      this.contentEl,
      "/",
      this.plugin,
    );

    // Post-process to make vault file paths clickable.
    this.makeVaultPathsClickable();
  }

  // Make vault file paths clickable in the rendered content.
  private makeVaultPathsClickable() {
    if (!this.contentEl) return;

    // Find all code elements and links that might contain file paths.
    const codeElements = this.contentEl.querySelectorAll("code");
    const linkElements = this.contentEl.querySelectorAll("a");

    // Process inline code elements that look like file paths.
    codeElements.forEach((codeEl) => {
      const text = codeEl.textContent || "";
      // Check if it looks like a vault file path (ends in common extensions or is a relative path).
      if (this.isVaultPath(text)) {
        this.makeClickable(codeEl as HTMLElement, text);
      }
    });

    // Process link elements that aren't already working external links.
    linkElements.forEach((linkEl) => {
      const href = linkEl.getAttribute("href") || "";
      const text = linkEl.textContent || "";
      // If it's not an external link and looks like a vault path, make it work.
      if (!href.startsWith("http") && !href.startsWith("#") && this.isVaultPath(href || text)) {
        this.makeClickable(linkEl as HTMLElement, href || text);
      }
    });

    // Also look for text nodes that contain file paths in backticks (already processed) or plain text.
    // This handles paths that Claude outputs as plain text like "pages/ark.md".
    this.processTextNodes(this.contentEl);
  }

  // Check if a string looks like a vault file path.
  private isVaultPath(text: string): boolean {
    // Skip external URLs.
    if (text.includes("://") || text.startsWith("http")) {
      return false;
    }

    // Common vault file extensions.
    const extensions = [".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".canvas"];
    const lowerText = text.toLowerCase();

    // Check if it ends with a known extension.
    if (extensions.some((ext) => lowerText.endsWith(ext))) {
      // Verify the file exists in the vault.
      return this.findFile(text) !== null;
    }

    // Check if it looks like a relative path (contains /).
    if (text.includes("/") || text.includes("\\")) {
      // Verify the file exists in the vault.
      return this.findFile(text) !== null;
    }

    return false;
  }

  // Normalize a file path for vault lookup.
  private normalizePath(path: string): string {
    // Remove leading slashes and backslashes.
    let normalized = path.replace(/^[/\\]+/, "");

    // Replace backslashes with forward slashes (Windows paths).
    normalized = normalized.replace(/\\/g, "/");

    // Remove URL encoding.
    try {
      normalized = decodeURIComponent(normalized);
    } catch (e) {
      // Ignore decode errors.
    }

    // Remove vault path prefix if present.
    const vaultBasePath = (this.plugin.app.vault.adapter as any).basePath;
    if (vaultBasePath && normalized.startsWith(vaultBasePath)) {
      normalized = normalized.slice(vaultBasePath.length);
      normalized = normalized.replace(/^[/\\]+/, "");
    }

    return normalized;
  }

  // Try to find a file by path with various fallbacks.
  private findFile(path: string): TFile | null {
    const normalized = this.normalizePath(path);

    // Try exact path.
    let file = this.plugin.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) return file;

    // Try with .md extension if not present.
    if (!normalized.endsWith(".md")) {
      file = this.plugin.app.vault.getAbstractFileByPath(normalized + ".md");
      if (file instanceof TFile) return file;
    }

    // Try without leading folder paths (search by filename).
    const filename = normalized.split("/").pop() || normalized;
    const allFiles = this.plugin.app.vault.getFiles();
    const match = allFiles.find((f) =>
      f.path === normalized ||
      f.path.endsWith("/" + normalized) ||
      f.name === filename ||
      f.basename === filename.replace(/\.md$/, "")
    );

    return match || null;
  }

  // Make an element clickable to open a vault file.
  private makeClickable(element: HTMLElement, path: string) {
    element.addClass("claude-code-vault-link");
    element.style.cursor = "pointer";
    element.style.textDecoration = "underline";

    element.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Try to find and open the file.
      const file = this.findFile(path);
      if (file) {
        await this.plugin.app.workspace.getLeaf(false).openFile(file);
      } else {
        // Show a notice that file wasn't found.
        new (require("obsidian").Notice)(`File not found: ${path}`);
      }
    });
  }

  // Process text nodes to find and wrap file paths.
  private processTextNodes(element: HTMLElement) {
    // Pattern to match file paths like "pages/ark.md" or "journals/2025-07-29.md".
    const pathPattern = /\b([a-zA-Z0-9_\-./]+\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas))\b/g;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const nodesToReplace: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const matches = [...text.matchAll(pathPattern)];
      if (matches.length > 0) {
        // Check if parent is already a link or code element.
        const parent = node.parentElement;
        if (parent && !parent.matches("a, code, .claude-code-vault-link")) {
          nodesToReplace.push({ node, matches });
        }
      }
    }

    // Replace text nodes with clickable spans.
    for (const { node, matches } of nodesToReplace) {
      const text = node.textContent || "";
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of matches) {
        const path = match[1];
        const startIndex = match.index!;

        // Add text before the match.
        if (startIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
        }

        // Check if this path exists in the vault before making it clickable.
        const file = this.findFile(path);
        if (file) {
          // Create clickable span.
          const span = document.createElement("span");
          span.textContent = path;
          span.className = "claude-code-vault-link";
          this.makeClickable(span, path);
          fragment.appendChild(span);
        } else {
          // Just add the text as-is if file doesn't exist.
          fragment.appendChild(document.createTextNode(path));
        }

        lastIndex = startIndex + match[0].length;
      }

      // Add remaining text.
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.replaceWith(fragment);
    }
  }

  private renderToolCalls() {
    const toolCallsContainer = this.containerEl.createDiv({ cls: "claude-code-tool-calls" });

    for (const toolCall of this.message.toolCalls || []) {
      const toolCallEl = toolCallsContainer.createDiv();
      const display = new ToolCallDisplay(toolCallEl, toolCall);
      display.render();
      this.toolCallDisplays.set(toolCall.id, display);
    }
  }

  private renderStreamingIndicator() {
    const streamingEl = this.containerEl.createDiv({ cls: "claude-code-streaming" });

    const dotsEl = streamingEl.createDiv({ cls: "claude-code-streaming-dots" });
    dotsEl.createDiv({ cls: "claude-code-streaming-dot" });
    dotsEl.createDiv({ cls: "claude-code-streaming-dot" });
    dotsEl.createDiv({ cls: "claude-code-streaming-dot" });

    streamingEl.createSpan({ text: "Thinking..." });
  }

  update(updates: Partial<ChatMessage>) {
    Object.assign(this.message, updates);
    this.render();
  }

  appendContent(content: string) {
    this.message.content += content;
    this.renderContent();
  }

  updateToolCall(toolCallId: string, updates: Partial<ToolCall>) {
    const display = this.toolCallDisplays.get(toolCallId);
    if (display) {
      display.update(updates);
    }
  }
}
