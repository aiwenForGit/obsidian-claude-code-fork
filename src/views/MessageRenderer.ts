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

    // First, process Obsidian-style internal links [[link]] that weren't rendered properly.
    this.processObsidianLinks(this.contentEl);

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

    // Also look for text nodes that contain file paths.
    this.processTextNodes(this.contentEl);
  }

  // Process Obsidian-style internal links [[link]] or [[link|display text]].
  private processObsidianLinks(element: HTMLElement) {
    // Pattern to match [[link]] or [[link|display]]
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const nodesToReplace: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const matches = [...text.matchAll(wikiLinkPattern)];
      if (matches.length > 0) {
        const parent = node.parentElement;
        if (parent && !parent.matches("a, code, .claude-code-vault-link")) {
          nodesToReplace.push({ node, matches });
        }
      }
    }

    for (const { node, matches } of nodesToReplace) {
      const text = node.textContent || "";
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of matches) {
        const fullMatch = match[0];
        const linkPath = match[1];  // The actual path/filename.
        const displayText = match[2] || linkPath;  // Display text or fallback to path.
        const startIndex = match.index!;

        // Add text before the match.
        if (startIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
        }

        // Create clickable link.
        const span = document.createElement("span");
        span.textContent = displayText;
        span.className = "claude-code-vault-link";
        span.title = linkPath;  // Show full path on hover.
        this.makeClickable(span, linkPath);
        fragment.appendChild(span);

        lastIndex = startIndex + fullMatch.length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.replaceWith(fragment);
    }
  }

  // Check if a string looks like a vault file path.
  private isVaultPath(text: string): boolean {
    // Skip external URLs.
    if (text.includes("://") || text.startsWith("http")) {
      return false;
    }

    // Skip empty or very short strings.
    if (!text || text.length < 3) {
      return false;
    }

    // Common vault file extensions.
    const extensions = [".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".canvas"];
    const lowerText = text.toLowerCase();

    // Check if it ends with a known extension - always treat as vault path.
    if (extensions.some((ext) => lowerText.endsWith(ext))) {
      return true;
    }

    // Check if it looks like a relative path (contains / or \).
    if ((text.includes("/") || text.includes("\\")) && !text.includes(" ")) {
      return true;
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
    const allFiles = this.plugin.app.vault.getFiles();

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
    const filenameWithoutExt = filename.replace(/\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas)$/i, "");

    // Search through all files with multiple matching strategies.
    const match = allFiles.find((f) => {
      // Exact path match.
      if (f.path === normalized) return true;

      // Path ends with our normalized path.
      if (f.path.endsWith("/" + normalized)) return true;

      // Exact filename match.
      if (f.name === filename) return true;

      // Basename match (without extension).
      if (f.basename === filenameWithoutExt) return true;

      // Case-insensitive path match.
      if (f.path.toLowerCase() === normalized.toLowerCase()) return true;

      // Case-insensitive filename match.
      if (f.name.toLowerCase() === filename.toLowerCase()) return true;

      return false;
    });

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
    // Multiple patterns to match different file path formats:
    // 1. Paths ending with known extensions (supports spaces in path for Chinese filenames).
    // 2. Markdown-style links [text](path).
    const patterns = [
      // Pattern 1: File paths with extensions - match until we hit certain delimiters.
      // This captures paths like "文档/我的笔记.md" or "pages/my note.md".
      /([^\n\r\[\]<>"`]+\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas))(?=[\s\n\r,;:)\]<>"]|$)/gi,

      // Pattern 2: Markdown links [text](path) where path looks like a vault file.
      /\[([^\]]+)\]\(([^)]+\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas))\)/gi,
    ];

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const nodesToProcess: Text[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const parent = node.parentElement;
      if (parent && !parent.matches("a, code, pre, .claude-code-vault-link")) {
        nodesToProcess.push(node);
      }
    }

    for (const textNode of nodesToProcess) {
      let text = textNode.textContent || "";
      let hasMatch = false;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      // Find all matches from all patterns.
      interface PathMatch {
        index: number;
        length: number;
        path: string;
        displayText: string;
      }
      const allMatches: PathMatch[] = [];

      // Pattern 1: Simple file paths.
      const pattern1 = /([^\n\r\[\]<>"`|]+\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas))(?=[\s\n\r,;:)\]<>"|]|$)/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern1.exec(text)) !== null) {
        const path = match[1].trim();
        // Skip if path starts with http or contains ://.
        if (path.includes("://") || path.startsWith("http")) continue;
        // Skip very short paths.
        if (path.length < 3) continue;

        allMatches.push({
          index: match.index,
          length: match[0].length,
          path: path,
          displayText: path,
        });
      }

      // Pattern 2: Markdown links [text](path.md).
      const pattern2 = /\[([^\]]+)\]\(([^)]+\.(md|txt|pdf|png|jpg|jpeg|gif|svg|canvas))\)/gi;
      while ((match = pattern2.exec(text)) !== null) {
        const displayText = match[1];
        const path = match[2];
        if (path.includes("://") || path.startsWith("http")) continue;

        allMatches.push({
          index: match.index,
          length: match[0].length,
          path: path,
          displayText: displayText,
        });
      }

      // Sort matches by index and remove overlaps.
      allMatches.sort((a, b) => a.index - b.index);
      const filteredMatches: PathMatch[] = [];
      let lastEnd = 0;
      for (const m of allMatches) {
        if (m.index >= lastEnd) {
          filteredMatches.push(m);
          lastEnd = m.index + m.length;
        }
      }

      if (filteredMatches.length === 0) continue;

      hasMatch = true;
      for (const m of filteredMatches) {
        // Add text before the match.
        if (m.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
        }

        // Create clickable link.
        const span = document.createElement("span");
        span.textContent = m.displayText;
        span.className = "claude-code-vault-link";
        if (m.path !== m.displayText) {
          span.title = m.path;
        }
        this.makeClickable(span, m.path);
        fragment.appendChild(span);

        lastIndex = m.index + m.length;
      }

      // Add remaining text.
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      if (hasMatch) {
        textNode.replaceWith(fragment);
      }
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
