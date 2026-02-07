// Options page JavaScript

let templates = [];
let editingTemplateId = null;

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const modelSelect = document.getElementById('model');
const templateList = document.getElementById('templateList');
const addTemplateBtn = document.getElementById('addTemplate');
const templateModal = document.getElementById('templateModal');
const modalTitle = document.getElementById('modalTitle');
const templateNameInput = document.getElementById('templateName');
const templateModelSelect = document.getElementById('templateModel');
const templateShortcutInput = document.getElementById('templateShortcut');
const templatePromptInput = document.getElementById('templatePrompt');
const saveTemplateBtn = document.getElementById('saveTemplate');
const cancelTemplateBtn = document.getElementById('cancelTemplate');
const closeModalBtn = document.getElementById('closeModal');
const statusEl = document.getElementById('status');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
});

async function loadSettings() {
  // Load API key
  const apiKey = await getApiKey();
  apiKeyInput.value = apiKey;

  // Load model
  const model = await getModel();
  modelSelect.value = model;

  // Load templates
  templates = await getTemplates();
  renderTemplates();

  // Load theme
  const theme = await getTheme();
  document.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
  await initTheme(); // Apply immediately
}

function setupEventListeners() {
  // Theme change
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      await setTheme(e.target.value);
      showStatus('Theme saved', 'success');
    });
  });

  // Toggle API key visibility
  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.innerHTML = isPassword
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>`;
  });

  // Save API key on change
  apiKeyInput.addEventListener('change', async () => {
    await setApiKey(apiKeyInput.value);
    showStatus('API key saved', 'success');
  });

  // Save model on change
  modelSelect.addEventListener('change', async () => {
    await setModel(modelSelect.value);
    showStatus('Model saved', 'success');
  });

  // Add template button
  addTemplateBtn.addEventListener('click', () => {
    editingTemplateId = null;
    modalTitle.textContent = 'Add Template';
    templateNameInput.value = '';
    templatePromptInput.value = '';
    templateModal.classList.add('active');
  });

  // Modal controls
  closeModalBtn.addEventListener('click', closeModal);
  cancelTemplateBtn.addEventListener('click', closeModal);

  templateModal.addEventListener('click', (e) => {
    if (e.target === templateModal) closeModal();
  });

  // Shortcut Recording
  templateShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore alone modifier keys
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    // Key names like "s" should be uppercase
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();

    parts.push(key);
    templateShortcutInput.value = parts.join('+');
  });

  templateShortcutInput.addEventListener('click', () => {
    templateShortcutInput.value = '';
    templateShortcutInput.placeholder = 'Press keys...';
  });

  // Save template
  saveTemplateBtn.addEventListener('click', saveTemplate);
}

function renderTemplates() {
  templateList.innerHTML = templates.map(template => `
    <div class="template-item" data-id="${template.id}">
      <div class="template-info">
        <div class="template-name">
          ${escapeHtml(template.name)}
          ${template.isDefault ? '<span class="template-badge">Built-in</span>' : ''}
          ${template.shortcut ? `<span class="shortcut-badge">${escapeHtml(template.shortcut)}</span>` : ''}
        </div>
        <div class="template-preview">
          ${template.model ? `<span class="model-tag">${escapeHtml(template.model)}</span> ` : ''}
          ${escapeHtml(template.prompt.substring(0, 60))}...
        </div>
      </div>
      <div class="template-actions">
        <button class="btn-icon edit-template" data-id="${template.id}" title="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        ${!template.isDefault ? `
          <button class="btn-icon btn-danger delete-template" data-id="${template.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Add event listeners for edit/delete buttons
  document.querySelectorAll('.edit-template').forEach(btn => {
    btn.addEventListener('click', () => editTemplate(btn.dataset.id));
  });

  document.querySelectorAll('.delete-template').forEach(btn => {
    btn.addEventListener('click', () => deleteTemplate(btn.dataset.id));
  });
}

function editTemplate(id) {
  const template = templates.find(t => t.id === id);
  if (!template) return;

  editingTemplateId = id;
  modalTitle.textContent = 'Edit Template';
  templateNameInput.value = template.name;
  templateModelSelect.value = template.model || '';
  templateShortcutInput.value = template.shortcut || '';
  templatePromptInput.value = template.prompt;
  templateModal.classList.add('active');
}

async function saveTemplate() {
  const name = templateNameInput.value.trim();
  const prompt = templatePromptInput.value.trim();
  const model = templateModelSelect.value;
  const shortcut = templateShortcutInput.value;

  if (!name || !prompt) {
    showStatus('Please fill in all fields', 'error');
    return;
  }

  const templateData = {
    name,
    prompt,
    model: model || undefined,
    shortcut: shortcut || undefined
  };

  if (editingTemplateId) {
    // Update existing template
    const index = templates.findIndex(t => t.id === editingTemplateId);
    if (index !== -1) {
      templates[index] = {
        ...templates[index],
        ...templateData
      };
    }
  } else {
    // Add new template
    templates.push({
      id: generateId(),
      ...templateData,
      isDefault: false
    });
  }

  await setTemplates(templates);
  renderTemplates();
  closeModal();
  showStatus('Template saved', 'success');
}

async function deleteTemplate(id) {
  if (!confirm('Are you sure you want to delete this template?')) return;

  templates = templates.filter(t => t.id !== id);
  await setTemplates(templates);
  renderTemplates();
  showStatus('Template deleted', 'success');
}

function closeModal() {
  templateModal.classList.remove('active');
  editingTemplateId = null;
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status show ${type}`;

  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
