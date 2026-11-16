
const API = "http://127.0.0.1:8000";

let token = localStorage.getItem("rr_token");
let selectedImage = null;
let speechMuted = false;
let authMode = "login";
let recognition = null;

const $ = (id) => document.getElementById(id);

// =====================================================
// 1. STYLING
// =====================================================

const formattingStyles = document.createElement("style");

formattingStyles.textContent = `
.assistant-message .message-content {
  min-width: 0;
  max-width: 100%;
  flex: 1;
}

.assistant-message .bubble {
  line-height: 1.7;
  overflow-wrap: anywhere;
  word-break: normal;
}

.assistant-message .bubble h2,
.assistant-message .bubble h3,
.assistant-message .bubble h4 {
  color: #294b37;
  font-weight: 700;
  line-height: 1.4;
  margin: 16px 0 8px;
}

.assistant-message .bubble h2 {
  font-size: 1.2rem;
}

.assistant-message .bubble h3 {
  font-size: 1.08rem;
}

.assistant-message .bubble h4 {
  font-size: 1rem;
}

.assistant-message .bubble p {
  margin: 0 0 12px;
}

.assistant-message .bubble p:last-child {
  margin-bottom: 0;
}

.assistant-message .bubble ul,
.assistant-message .bubble ol {
  padding-left: 24px;
  margin: 8px 0 14px;
}

.assistant-message .bubble li {
  margin-bottom: 7px;
  padding-left: 3px;
}

.assistant-message .bubble strong {
  color: #294b37;
  font-weight: 700;
}

.assistant-message .bubble em {
  font-style: italic;
}

.assistant-message .bubble code {
  background: #edf1e9;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

.assistant-message .bubble pre {
  background: #f1f3ed;
  padding: 12px;
  border-radius: 9px;
  overflow-x: auto;
  margin: 10px 0;
}

.assistant-message .bubble pre code {
  background: transparent;
  padding: 0;
}

.assistant-message .bubble blockquote {
  border-left: 3px solid #8da68e;
  padding: 5px 12px;
  margin: 12px 0;
  color: #536455;
  background: #f4f6f1;
  border-radius: 0 7px 7px 0;
}

.assistant-message .bubble hr {
  border: 0;
  border-top: 1px solid #dce4d9;
  margin: 14px 0;
}

/* TABLE FORMATTING */

.assistant-message .table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 14px 0;
  border: 1px solid #dce5da;
  border-radius: 10px;
  -webkit-overflow-scrolling: touch;
}

.assistant-message .bubble table {
  width: 100%;
  min-width: 430px;
  border-collapse: collapse;
  font-size: 0.92rem;
  text-align: left;
  background: #fff;
}

.assistant-message .bubble th {
  background: #eaf0e7;
  color: #294b37;
  font-weight: 700;
  padding: 11px 13px;
  border-bottom: 1px solid #d5dfd2;
  white-space: nowrap;
}

.assistant-message .bubble td {
  padding: 10px 13px;
  border-bottom: 1px solid #e8ede6;
  vertical-align: top;
  min-width: 100px;
}

.assistant-message .bubble tr:last-child td {
  border-bottom: none;
}

.assistant-message .bubble tbody tr:nth-child(even) {
  background: #f7f9f5;
}

.assistant-message .bubble tbody tr:hover {
  background: #f0f4ed;
}

/* SPEAKER BUTTON */

.message-speak-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 20px;
  padding: 5px 9px;
  margin-top: 6px;
  background: #edf2e9;
  color: #294b37;
  cursor: pointer;
  font-size: 14px;
}

.message-speak-button:hover {
  background: #dce8d9;
}

.message-speak-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;

document.head.appendChild(formattingStyles);


// =====================================================
// 2. GENERAL HELPERS
// =====================================================

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => toast.classList.remove("show"), 2600);
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.remove("active-view");
  });

  document.querySelectorAll(".nav-item, .mobile-nav button").forEach(b => {
    b.classList.remove("active");
  });

  const view = $(name + "View");
  if (view) view.classList.add("active-view");

  document.querySelectorAll(`[data-view="${name}"]`).forEach(b => {
    if (b.classList.contains("nav-item") || b.closest(".mobile-nav")) {
      b.classList.add("active");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    const name = button.dataset.view;
    showView(name);

    if (button.dataset.prompt) {
      $("messageInput").value = button.dataset.prompt;
      showView("chat");
      $("messageInput").focus();
    }
  });
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    $("messageInput").value = button.dataset.prompt;
    showView("chat");
    $("messageInput").focus();
  });
});

if ($("todayLabel")) {
  $("todayLabel").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date());
}


// =====================================================
// 3. MARKDOWN FORMATTING
// =====================================================

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatInline(text) {
  let value = escapeHTML(text);

  // Inline code
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  value = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italics
  value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  // Strikethrough
  value = value.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return value;
}

function splitTableRow(line) {
  let row = line.trim();

  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);

  return row.split("|").map(cell => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);

  return cells.length > 1 &&
    cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function formatTable(headerLine, separatorLine, bodyLines) {
  const headers = splitTableRow(headerLine);
  const alignments = splitTableRow(separatorLine);

  const alignmentStyle = alignments.map(cell => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });

  let html = '<div class="table-wrap"><table><thead><tr>';

  headers.forEach((header, index) => {
    const align = alignmentStyle[index] || "left";

    html += `<th style="text-align:${align}">${formatInline(header)}</th>`;
  });

  html += "</tr></thead><tbody>";

  bodyLines.forEach(line => {
    const cells = splitTableRow(line);

    html += "<tr>";

    headers.forEach((_, index) => {
      const cell = cells[index] || "";
      const align = alignmentStyle[index] || "left";

      html += `<td style="text-align:${align}">${formatInline(cell)}</td>`;
    });

    html += "</tr>";
  });

  html += "</tbody></table></div>";

  return html;
}

function formatMessage(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const output = [];

  let paragraph = [];
  let listType = null;
  let codeLines = [];
  let insideCode = false;

  function closeParagraph() {
    if (paragraph.length) {
      output.push(`<p>${paragraph.map(formatInline).join("<br>")}</p>`);
      paragraph = [];
    }
  }

  function closeList() {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  }

  function closeCode() {
    if (insideCode) {
      output.push(
        `<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`
      );

      codeLines = [];
      insideCode = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Code blocks
    if (line.startsWith("```")) {
      closeParagraph();
      closeList();

      if (!insideCode) {
        insideCode = true;
        codeLines = [];
      } else {
        closeCode();
      }

      continue;
    }

    if (insideCode) {
      codeLines.push(lines[i]);
      continue;
    }

    // Blank line
    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }

    // Markdown table: header + separator + rows
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1].trim())
    ) {
      closeParagraph();
      closeList();

      const header = line;
      const separator = lines[i + 1].trim();
      const body = [];

      i += 2;

      while (i < lines.length && lines[i].trim().includes("|")) {
        body.push(lines[i].trim());
        i++;
      }

      i--;

      output.push(formatTable(header, separator, body));
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,4})\s+(.+)$/);

    if (heading) {
      closeParagraph();
      closeList();

      const level = Math.min(heading[1].length + 1, 4);

      output.push(
        `<h${level}>${formatInline(heading[2])}</h${level}>`
      );

      continue;
    }

    // Horizontal divider
    if (/^[-*_]{3,}$/.test(line)) {
      closeParagraph();
      closeList();
      output.push("<hr>");
      continue;
    }

    // Blockquotes
    if (line.startsWith(">")) {
      closeParagraph();
      closeList();

      output.push(
        `<blockquote>${formatInline(line.replace(/^>\s?/, ""))}</blockquote>`
      );

      continue;
    }

    // Unordered lists
    const bullet = line.match(/^[-*+•]\s+(.+)$/);

    // Ordered lists
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);

    if (bullet || numbered) {
      closeParagraph();

      const type = bullet ? "ul" : "ol";

      if (listType !== type) {
        closeList();
        listType = type;
        output.push(`<${type}>`);
      }

      const content = bullet ? bullet[1] : numbered[1];

      output.push(`<li>${formatInline(content)}</li>`);

      continue;
    }

    closeList();
    paragraph.push(line);
  }

  closeParagraph();
  closeList();
  closeCode();

  return output.join("");
}


// =====================================================
// 4. SPEECH
// =====================================================

function speak(text) {
  if (speechMuted) {
    showToast("Spoken replies are muted. Unmute first.");
    return;
  }

  if (!("speechSynthesis" in window)) {
    showToast("Speech is not supported in this browser.");
    return;
  }

  window.speechSynthesis.cancel();

  const cleanText = String(text)
    .replace(/\s+/g, " ")
    .trim();

  const utterance = new SpeechSynthesisUtterance(cleanText);

  utterance.lang = "en-IN";
  utterance.rate = 1;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}

// Master mute control. Speech is never automatic.
if ($("speakToggle")) {
  $("speakToggle").textContent = "🔊";

  $("speakToggle").addEventListener("click", () => {
    speechMuted = !speechMuted;

    $("speakToggle").textContent = speechMuted ? "🔇" : "🔊";

    if (speechMuted && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    showToast(speechMuted ? "Spoken replies muted" : "Speech unmuted");
  });
}


// =====================================================
// 5. CHAT MESSAGES
// =====================================================

function addMessage(text, role) {
  const messages = $("chatMessages");

  const row = document.createElement("div");

  row.className = `message ${
    role === "user" ? "user-message" : "assistant-message"
  }`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "☺" : "🌿";

  const content = document.createElement("div");
  content.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "assistant") {
    bubble.innerHTML = formatMessage(text);
  } else {
    bubble.textContent = text;
  }

  content.appendChild(bubble);

  if (role === "assistant") {
    const speakerButton = document.createElement("button");

    speakerButton.type = "button";
    speakerButton.className = "message-speak-button";
    speakerButton.textContent = "🔊";
    speakerButton.title = "Listen to this reply";
    speakerButton.setAttribute("aria-label", "Listen to this reply");

    speakerButton.addEventListener("click", () => {
      speak(bubble.textContent);
    });

    content.appendChild(speakerButton);
  }

  row.append(avatar, content);
  messages.appendChild(row);

  messages.scrollTop = messages.scrollHeight;

  return bubble;
}

function setLoading(loading) {
  $("sendButton").disabled = loading;
  $("sendButton").textContent = loading ? "…" : "↑";
}


// =====================================================
// 6. SEND CHAT MESSAGE
// =====================================================

async function sendMessage(message) {
  if (!message.trim() && !selectedImage) {
    showToast("Write a message or attach a photo first.");
    return;
  }

  const prompt = message.trim() ||
    "Please examine this image and help me understand it.";

  addMessage(
    selectedImage ? prompt + " [Photo attached]" : prompt,
    "user"
  );

  $("messageInput").value = "";
  setLoading(true);

  const form = new FormData();

  form.append("message", prompt);

  if (selectedImage) {
    form.append("image", selectedImage);
  }

  selectedImage = null;

  $("attachmentPreview").hidden = true;
  $("galleryInput").value = "";
  $("cameraInput").value = "";

  const waiting = addMessage("Let me think about that... 🌱", "assistant");

  try {
    const headers = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API}/chat`, {
      method: "POST",
      headers,
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Something went wrong.");
    }

    // Format the actual AI response.
    waiting.innerHTML = formatMessage(data.reply);

    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;

    // No automatic speech. Click the speaker button to listen.

  } catch (error) {
    waiting.textContent =
      "I couldn't reach the assistant. " + error.message;

    showToast("Chat request failed. Check that your backend is running.");

  } finally {
    setLoading(false);
  }
}

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  sendMessage($("messageInput").value);
});

$("messageInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chatForm").requestSubmit();
  }
});


// =====================================================
// 7. IMAGE UPLOAD
// =====================================================

function handleImage(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image.");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    showToast("Please choose an image smaller than 8 MB.");
    return;
  }

  selectedImage = file;

  $("previewImage").src = URL.createObjectURL(file);
  $("attachmentPreview").hidden = false;
}

$("galleryButton").addEventListener("click", () => {
  $("galleryInput").click();
});

$("cameraButton").addEventListener("click", () => {
  $("cameraInput").click();
});

$("galleryInput").addEventListener("change", event => {
  handleImage(event.target.files[0]);
});

$("cameraInput").addEventListener("change", event => {
  handleImage(event.target.files[0]);
});

$("removeImage").addEventListener("click", () => {
  selectedImage = null;

  $("attachmentPreview").hidden = true;
  $("galleryInput").value = "";
  $("cameraInput").value = "";
});


// =====================================================
// 8. MICROPHONE INPUT
// =====================================================

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();

  recognition.lang = "en-IN";
  recognition.interimResults = false;

  recognition.onresult = event => {
    $("messageInput").value +=
      ($("messageInput").value ? " " : "") +
      event.results[0][0].transcript;

    $("messageInput").focus();
  };

  recognition.onerror = () => {
    showToast("Microphone input was not available.");
  };

  recognition.onend = () => {
    $("micButton").classList.remove("recording");
  };
}

$("micButton").addEventListener("click", () => {
  if (!recognition) {
    showToast("Voice input is not supported in this browser.");
    return;
  }

  try {
    $("micButton").classList.add("recording");
    recognition.start();

  } catch {
    $("micButton").classList.remove("recording");
    showToast("Microphone is already active.");
  }
});


// =====================================================
// 9. LOGIN AND REGISTRATION
// =====================================================

function openAuth() {
  $("authModal").hidden = false;
  $("authStatus").textContent = "";
}

$("accountButton").addEventListener("click", openAuth);
$("topAccountButton").addEventListener("click", openAuth);

$("closeAuth").addEventListener("click", () => {
  $("authModal").hidden = true;
});

$("authModal").addEventListener("click", event => {
  if (event.target === $("authModal")) {
    $("authModal").hidden = true;
  }
});

function updateAuthMode() {
  $("authTitle").textContent =
    authMode === "login"
      ? "Welcome back"
      : "Join our little community";

  $("authDescription").textContent =
    authMode === "login"
      ? "Sign in to save your conversations and personal space."
      : "Create an account to keep your chats and garden notes.";

  $("authSubmit").textContent =
    authMode === "login"
      ? "Sign in"
      : "Create account";

  $("authSwitch").innerHTML =
    authMode === "login"
      ? 'New here? <button type="button" id="switchAuth">Create an account</button>'
      : 'Already a member? <button type="button" id="switchAuth">Sign in</button>';
}

$("authSwitch").addEventListener("click", event => {
  if (event.target.id !== "switchAuth") return;

  authMode = authMode === "login" ? "register" : "login";

  updateAuthMode();
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("authEmail").value;
  const password = $("authPassword").value;

  const endpoint =
    authMode === "login"
      ? "/auth/login"
      : "/auth/register";

  $("authSubmit").disabled = true;
  $("authStatus").textContent = "Please wait...";

  try {
    const response = await fetch(API + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Authentication failed.");
    }

    token = data.access_token;

    localStorage.setItem("rr_token", token);

    $("authModal").hidden = true;
    $("authForm").reset();

    showToast("Welcome to Roots & Rations! 🌿");

    await loadHistory();

  } catch (error) {
    $("authStatus").textContent = error.message;

  } finally {
    $("authSubmit").disabled = false;
  }
});


// =====================================================
// 10. CHAT HISTORY
// =====================================================

async function loadHistory() {
  if (!token) return;

  try {
    const response = await fetch(`${API}/chat/history`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      token = null;
      localStorage.removeItem("rr_token");
      return;
    }

    if (!response.ok) return;

    const history = await response.json();

    const messages = $("chatMessages");
    messages.innerHTML = "";

    if (!history.length) {
      addMessage(
        "Welcome back! What shall we grow, cook or create today? 🌱",
        "assistant"
      );

      return;
    }

    history.forEach(item => {
      addMessage(item.content, item.role);
    });

  } catch (error) {
    console.error("Could not load chat history:", error);
  }
}


// =====================================================
// 11. INITIALIZATION
// =====================================================

updateAuthMode();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(console.error);
  });
}
