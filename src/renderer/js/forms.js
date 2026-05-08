'use strict';

let allDocs = [];
let filteredDocs = [];
let currentDocsPage = 1;
const DOCS_PER_PAGE = 10;
let allTemplates = [];
let currentTemplatesPage = 1;
const TEMPLATES_PER_PAGE = 6;
let refreshTimer = null;
let isInitialLoad = true;

window.initForms = async function () {
  isInitialLoad = true;
  bindFormsEvents();
  await loadTemplates();
  await loadDocuments();
  await checkDriveStatus();
  updateStatsBar();
  startAutoRefresh();
  isInitialLoad = false;
  bindKeyboardShortcuts();
};

window.destroyForms = function () {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  document.removeEventListener('keydown', _formsKeyHandler);
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', _formsKeyHandler);
}

function _formsKeyHandler(e) {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('delete-confirm-overlay');
    if (overlay && overlay.classList.contains('active')) {
       // Logic to close confirm modal if it was open
       // Since it's a promise, it's a bit tricky but we can trigger the cancel button
       document.getElementById('delete-modal-cancel')?.click();
    }
  }
  if (e.key === 'Enter') {
    const overlay = document.getElementById('delete-confirm-overlay');
    if (overlay && overlay.classList.contains('active')) {
       e.preventDefault();
       document.getElementById('delete-modal-confirm')?.click();
    }
  }
}

function bindFormsEvents() {
  document.getElementById('btn-add-document')?.addEventListener('click', () => {
    handleAddDocument();
  });

  document.getElementById('btn-drive-retry')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-drive-retry');
    btn.textContent = 'Uploading...';
    btn.disabled = true;
    try {
      await window.api.driveUploadPending();
      showToast('Batch upload initiated.', 'info');
    } catch (e) {
      showToast('Error during batch upload.', 'error');
    } finally {
      await loadDocuments();
      await checkDriveStatus();
      updateStatsBar();
    }
  });


  document.getElementById('btn-add-template')?.addEventListener('click', () => {
    handleAddTemplate();
  });

  document.getElementById('docs-search-input')?.addEventListener('input', (e) => {
    currentDocsPage = 1;
    filterDocuments(e.target.value);
  });
}

window.changeDocsPage = function(page) {
  currentDocsPage = page;
  renderDocuments(filteredDocs);
};

window.changeTemplatesPage = function(page) {
  currentTemplatesPage = page;
  renderTemplates(allTemplates);
};

function startAutoRefresh() {
  refreshTimer = setInterval(() => {
    loadTemplates();
    loadDocuments();
    checkDriveStatus();
    updateStatsBar();
  }, 10000); // 10s is better for drive status checks
}



function updateStatsBar() {
  const templatesEl = document.getElementById('stat-templates-count');
  const docsEl = document.getElementById('stat-docs-count');
  const driveEl = document.getElementById('stat-drive-count');

  if (templatesEl) templatesEl.textContent = allTemplates.length || 0;
  if (docsEl) docsEl.textContent = allDocs.length || 0;
  if (driveEl) {
    const onDrive = allDocs.filter(d => d.driveStatus === 'uploaded').length;
    driveEl.textContent = onDrive;
  }
}

async function checkDriveStatus() {
  const banner = document.getElementById('drive-retry-banner');
  const text = document.getElementById('drive-retry-text');
  if (!banner || !text) return;

  try {
    const status = await window.api.driveGetStatus();
    if (status.connected && status.pendingCount > 0) {
      text.textContent = `${status.pendingCount} file(s) not yet on Drive.`;
      banner.style.display = 'flex';
      const btn = document.getElementById('btn-drive-retry');
      if (btn) {
        btn.textContent = 'Upload all now';
        btn.disabled = false;
      }
    } else {
      banner.style.display = 'none';
    }
  } catch (e) {
    banner.style.display = 'none';
  }
}

async function loadTemplates() {
  try {
    const templates = await window.api.getTemplates();
    allTemplates = templates || [];
    renderTemplates(allTemplates);
    updateStatsBar();
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function renderTemplates(templates) {
  const grid = document.getElementById('templates-grid');
  const paginationEl = document.getElementById('templates-pagination');
  if (!grid) return;

  if (templates.length === 0) {
    grid.innerHTML = `
      <div class="templates-empty">
        <div class="templates-empty-icon">📄</div>
        <div class="templates-empty-text">No templates found</div>
        <div class="templates-empty-hint">Click "Add Template" to upload a .docx format form template</div>
      </div>`;
    if (paginationEl) paginationEl.style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(templates.length / TEMPLATES_PER_PAGE) || 1;
  if (currentTemplatesPage > totalPages) currentTemplatesPage = totalPages;

  const startIndex = (currentTemplatesPage - 1) * TEMPLATES_PER_PAGE;
  const endIndex = startIndex + TEMPLATES_PER_PAGE;
  const pageTemplates = templates.slice(startIndex, endIndex);

  const colors = ['blue', 'green', 'orange', 'purple', 'pink', 'teal'];
  const icons = ['📄', '📝', '📃', '📐', '📋', '📑'];

  grid.innerHTML = pageTemplates.map((tmpl, i) => {
    const globalIdx = startIndex + i;
    const color = colors[globalIdx % colors.length];
    const icon = icons[globalIdx % icons.length];
    const displayName = tmpl.name
      .replace(/\.[^/.]+$/, "")           // Remove extension
      .replace(/^template[-_]/i, "");     // Remove "template-" or "template_" prefix
    const ext = tmpl.name.split('.').pop().toUpperCase();
    
    // Waterfall stagger delay (starts after section header reveals)
    const staggerDelay = 280 + (i * 70);
    const animClass = isInitialLoad ? 'reveal-wf' : '';
    const animStyle = isInitialLoad ? `style="animation-delay: ${staggerDelay}ms"` : '';
    
    return `
      <div class="forms-template-card ${animClass}" 
           data-filename="${tmpl.name}" 
           data-color="${color}" 
           ${animStyle}>
        <div class="ftc-body">
          <div class="ftc-val">${displayName}</div>
          <div class="ftc-sub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Opens in Microsoft Word
          </div>
        </div>
        <div class="ftc-icon">
          ${icon}
        </div>
        <button class="ftc-delete-btn" title="Delete template">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Render templates pagination
  if (paginationEl) {
    if (totalPages > 1) {
      paginationEl.style.display = 'flex';
      const start = startIndex + 1;
      const end = Math.min(endIndex, templates.length);
      const pageInfoEl = document.getElementById('templates-page-info');
      if (pageInfoEl) {
        pageInfoEl.innerHTML = `Showing <strong>${start}-${end}</strong> of <strong>${templates.length}</strong> templates`;
      }
      renderTemplatesPagination(templates.length, totalPages);
    } else {
      paginationEl.style.display = 'none';
    }
  }

  grid.querySelectorAll('.forms-template-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open template if they clicked the delete button
      if (e.target.closest('.ftc-delete-btn')) return;
      window.api.openTemplate(card.dataset.filename);
    });
  });

  grid.querySelectorAll('.ftc-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.forms-template-card');
      const filename = card.dataset.filename;
      
      const confirmed = await showDeleteConfirmModal(
        'Delete Template',
        filename,
        'This action **cannot be undone**. All related template data and access will be removed.'
      );

      if (confirmed) {
        await window.api.deleteTemplate(filename);
        await loadTemplates();
        showToast('Template deleted successfully.', 'success');
      }
    });
  });
}

function renderTemplatesPagination(totalItems, totalPages) {
  const container = document.getElementById('templates-pagination-container');
  if (!container) return;

  if (totalItems === 0 || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="pagination">`;

  html += `
    <button class="pg-btn pg-prev ${currentTemplatesPage === 1 ? 'pg-disabled' : ''}" onclick="changeTemplatesPage(${currentTemplatesPage - 1})" ${currentTemplatesPage === 1 ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
  `;

  const pages = _buildDocsPageNumbers(currentTemplatesPage, totalPages);
  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `
        <button class="pg-btn pg-num ${p === currentTemplatesPage ? 'pg-active' : ''}" onclick="changeTemplatesPage(${p})">
          ${p}
        </button>
      `;
    }
  });

  html += `
    <button class="pg-btn pg-next ${currentTemplatesPage === totalPages ? 'pg-disabled' : ''}" onclick="changeTemplatesPage(${currentTemplatesPage + 1})" ${currentTemplatesPage === totalPages ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  `;

  html += `</div>`;
  container.innerHTML = html;
}

async function handleAddTemplate() {
  try {
    const result = await window.api.addTemplate();
    if (!result || !result.success) {
      if (result?.error) showToast(result.error, 'error');
      return;
    }
    await loadTemplates();
    const count = result.count || 1;
    showToast(`${count} template${count > 1 ? 's' : ''} added successfully.`, 'success');
  } catch (err) {
    showToast('Upload failed. Please try again.', 'error');
    console.error('Add template error:', err);
  }
}

async function loadDocuments() {
  try {
    const banner = document.getElementById('drive-retry-banner');
    try {
      const res = await window.api.listDriveFiles();
      if (res.success) {
        allDocs = (res.files || []).filter(doc => !doc.fileName.startsWith('~$'));
        if (banner) banner.style.display = 'none';
      } else {
        throw new Error(res.error);
      }
    } catch (e) {
      console.warn("Drive not connected or failed, falling back to local docs cache", e);
      if (banner) {
        const text = document.getElementById('drive-retry-text');
        if (text) text.textContent = 'Drive not connected — showing local files only.';
        banner.style.display = 'flex';
        const btn = document.getElementById('btn-drive-retry');
        if (btn) btn.style.display = 'none';
      }
      const docs = await window.api.getAllDocuments();
      allDocs = (docs || []).filter(doc => !doc.fileName.startsWith('~$'));
    }
    
    filterDocuments(document.getElementById('docs-search-input')?.value || '');
    updateStatsBar();
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}


function filterDocuments(query) {
  const lowerQuery = query.toLowerCase().trim();
  
  // Always exclude Word temporary owner files (~$filename.docx)
  const baseDocs = allDocs.filter(doc => !doc.fileName.startsWith('~$'));

  if (!lowerQuery) {
    filteredDocs = [...baseDocs];
  } else {
    filteredDocs = baseDocs.filter(doc => doc.fileName.toLowerCase().includes(lowerQuery));
  }
  renderDocuments(filteredDocs);
}

function getFileTypeClass(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'type-pdf';
  if (['doc', 'docx'].includes(ext)) return 'type-doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'type-xls';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return 'type-img';
  return 'type-other';
}

function renderDocuments(docs) {
  const emptyState = document.getElementById('docs-empty-state');
  const fileList = document.getElementById('docs-file-list');
  const pagination = document.getElementById('docs-pagination');
  const pageInfo = document.getElementById('docs-page-info');

  if (docs.length === 0) {
    emptyState.style.display = 'flex';
    fileList.innerHTML = '';
    if (pagination) pagination.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  
  const totalPages = Math.ceil(docs.length / DOCS_PER_PAGE) || 1;
  if (currentDocsPage > totalPages) currentDocsPage = totalPages;
  
  const startIndex = (currentDocsPage - 1) * DOCS_PER_PAGE;
  const endIndex = startIndex + DOCS_PER_PAGE;
  const pageDocs = docs.slice(startIndex, endIndex);

  fileList.innerHTML = pageDocs.map((doc, i) => {
    const typeClass = getFileTypeClass(doc.fileName);
    
    // Waterfall stagger delay
    const staggerDelay = 420 + (i * 70);
    const animClass = isInitialLoad ? 'reveal-wf' : '';
    const animStyle = isInitialLoad ? `style="animation-delay: ${staggerDelay}ms"` : '';
    
    // Dynamic Status Badge
    let statusBadge = '';
    if (doc.driveStatus === 'uploaded') {
      statusBadge = '<span class="doc-status-badge badge-cloud">☁️ Synced</span>';
    } else if (doc.driveStatus === 'failed') {
      statusBadge = '<span class="doc-status-badge badge-failed">⚠️ Drive Error</span>';
    } else {
      statusBadge = '<span class="doc-status-badge badge-local">💻 Local only</span>';
    }

    // Dynamic Drive Action
    let driveAction = '';
    if (doc.driveLink) {
      driveAction = `
        <button class="doc-action-btn btn-drive-action doc-drive-link-btn" data-link="${doc.driveLink}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Drive
        </button>`;
    }

    return `
    <div class="doc-row ${animClass}" 
         data-id="${doc.id || ''}" 
         data-drive-id="${doc.driveFileId || ''}"
         data-path="${doc.localPath}"
         ${animStyle}>
      <div class="doc-icon-wrap ${typeClass}">${getFileIcon(doc.fileName)}</div>
      <div class="doc-info">
        <div class="doc-name">${doc.fileName}</div>
        <div class="doc-meta">
          ${formatSize(doc.fileSize)} &nbsp;·&nbsp; Added ${formatDate(doc.addedAt)} 
          ${statusBadge}
        </div>
      </div>
      <div class="doc-actions">
        ${doc.localPath ? `
        <button class="doc-action-btn btn-open doc-open-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Open
        </button>` : ''}
        ${driveAction}
        <button class="doc-action-btn btn-delete-doc doc-delete-btn" title="Delete forever">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `}).join('');


  if (pagination) {
    pagination.style.display = totalPages > 1 ? 'flex' : (docs.length > 0 ? 'flex' : 'none');
    
    const start = (currentDocsPage - 1) * DOCS_PER_PAGE + 1;
    const end = Math.min(currentDocsPage * DOCS_PER_PAGE, docs.length);
    if (pageInfo) {
      pageInfo.innerHTML = docs.length > 0 
        ? `Showing <strong>${start}-${end}</strong> of <strong>${docs.length}</strong>`
        : `Showing 0 of 0 documents`;
    }
    
    renderDocsPagination(docs.length, totalPages);
  }

  fileList.querySelectorAll('.doc-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.closest('.doc-row').dataset.path;
      if (path && path !== 'undefined') {
        window.api.openPath(path);
      } else {
        showToast('Local file path not found.', 'info');
      }
    });
  });

  fileList.querySelectorAll('.doc-drive-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const link = btn.dataset.link;
      if (link) window.api.openExternal(link);
    });
  });

  fileList.querySelectorAll('.doc-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.doc-row');
      const id = row.dataset.id;
      const driveId = row.dataset.driveId;
      
      const doc = filteredDocs.find(d => {
        const d_id = d.id ? String(d.id) : '';
        const d_driveId = d.driveFileId ? String(d.driveFileId) : '';
        return (id && d_id === id) || (driveId && d_driveId === driveId);
      });
      
      if (!doc) {
        showToast('Error: Document not found in current list.', 'error');
        return;
      }

      const driveFileId = doc.driveFileId;
      
      const confirmed = await showDeleteConfirmModal(
        'Delete Document',
        doc.fileName,
        'This action **cannot be undone**. The file will be removed from local cache and Drive shared folder.'
      );

      if (confirmed) {
        try {
          if (driveFileId) {
            await window.api.deleteDriveFile(driveFileId);
          } else {
            await window.api.deleteDocument(doc.id);
          }
          await loadDocuments();
          showToast('Document deleted successfully.', 'success');
        } catch (err) {
          showToast('Failed to delete document.', 'error');
          console.error('Delete error:', err);
        }
      }
    });
  });
}


function renderDocsPagination(totalDocs, totalPages) {
  const container = document.getElementById('docs-pagination-container');
  if (!container) return;

  if (totalDocs === 0 || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="pagination">`;

  // Prev button
  html += `
    <button class="pg-btn pg-prev ${currentDocsPage === 1 ? 'pg-disabled' : ''}" onclick="changeDocsPage(${currentDocsPage - 1})" ${currentDocsPage === 1 ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
  `;

  // Page numbers with ellipsis
  const pages = _buildDocsPageNumbers(currentDocsPage, totalPages);
  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `
        <button class="pg-btn pg-num ${p === currentDocsPage ? 'pg-active' : ''}" onclick="changeDocsPage(${p})">
          ${p}
        </button>
      `;
    }
  });

  // Next button
  html += `
    <button class="pg-btn pg-next ${currentDocsPage === totalPages ? 'pg-disabled' : ''}" onclick="changeDocsPage(${currentDocsPage + 1})" ${currentDocsPage === totalPages ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  `;

  html += `</div>`;
  container.innerHTML = html;
}

function _buildDocsPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}


async function handleAddDocument() {
  try {
    const filePaths = await window.api.openAnyFileDialog();
    if (!filePaths || filePaths.length === 0) return;
    
    const total = filePaths.length;
    showToast(`Uploading ${total} file${total > 1 ? 's' : ''} to Google Drive…`, 'info');
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const fileName = filePath.split('\\').pop().split('/').pop();
      
      try {
        const res = await window.api.uploadDriveFile(filePath, fileName, null, null);
        if (res && res.success) {
          successCount++;
        } else {
          failCount++;
          console.error(`Upload failed for ${fileName}:`, res?.error);
        }
      } catch (err) {
        failCount++;
        console.error(`Upload error for ${fileName}:`, err);
      }
    }
    
    await loadDocuments();
    checkDriveStatus();
    
    if (failCount === 0) {
      showToast(`${successCount} document${successCount > 1 ? 's' : ''} uploaded successfully.`, 'success');
    } else {
      showToast(`${successCount} uploaded, ${failCount} failed.`, 'error');
    }
  } catch (err) {
    showToast('Upload failed. Please try again.', 'error');
    console.error('Add document error:', err);
  }
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  
  const icons = {
    pdf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <path d="M10 12h4"></path>
            <path d="M10 16h4"></path>
            <path d="M9 14h6"></path>
          </svg>`,
    docx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
             <polyline points="14 2 14 8 20 8"></polyline>
             <line x1="16" y1="13" x2="8" y2="13"></line>
             <line x1="16" y1="17" x2="8" y2="17"></line>
             <polyline points="10 9 9 9 8 9"></polyline>
           </svg>`,
    doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>`,
    xlsx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
             <polyline points="14 2 14 8 20 8"></polyline>
             <path d="M8 13h2"></path>
             <path d="M14 13h2"></path>
             <path d="M8 17h2"></path>
             <path d="M14 17h2"></path>
           </svg>`,
    xls: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <path d="M8 13h8"></path>
            <path d="M8 17h8"></path>
          </svg>`,
    jpg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>`,
    jpeg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
             <circle cx="8.5" cy="8.5" r="1.5"></circle>
             <polyline points="21 15 16 10 5 21"></polyline>
           </svg>`,
    png: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>`,
    webp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
             <circle cx="8.5" cy="8.5" r="1.5"></circle>
             <polyline points="21 15 16 10 5 21"></polyline>
           </svg>`,
    txt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <line x1="10" y1="9" x2="8" y2="9"></line>
          </svg>`,
    pptx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
             <line x1="2" y1="20" x2="22" y2="20"></line>
             <polyline points="10 7 15 10 10 13 10 7"></polyline>
           </svg>`,
  };

  return icons[ext] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                        </svg>`;
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showToast(message, type = 'info') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
  }
}

// ── Delete Confirmation Modal ─────────────────────────
function showDeleteConfirmModal(title, itemName, warningText) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) return resolve(false);

    const modalHtml = `
      <div class="modal-overlay" id="delete-confirm-overlay">
        <div class="modal delete-confirm-modal">
          <div class="delete-confirm-header">
            <div class="delete-confirm-icon-outer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
            <h2 class="delete-confirm-title">${title}</h2>
            <button class="delete-confirm-close" id="delete-modal-close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div class="delete-confirm-body">
            <p class="delete-confirm-desc">
              You are about to permanently delete <strong>${esc(itemName)}</strong>.
            </p>
            
            <div class="delete-confirm-alert">
              <div class="delete-confirm-alert-icon">⚠️</div>
              <div class="delete-confirm-alert-text">
                ${warningText.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}
              </div>
            </div>
          </div>

          <div class="delete-confirm-footer">
            <button class="btn-delete-cancel" id="delete-modal-cancel">
              Cancel
            </button>
            <button class="btn-delete-confirm" id="delete-modal-confirm">
              Yes, Delete Forever
            </button>
          </div>
        </div>
      </div>
    `;

    root.innerHTML = modalHtml;

    const overlay = document.getElementById('delete-confirm-overlay');
    const closeBtn = document.getElementById('delete-modal-close');
    const cancelBtn = document.getElementById('delete-modal-cancel');
    const confirmBtn = document.getElementById('delete-modal-confirm');

    // Trigger entrance animation
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    const closeModal = (result) => {
      overlay.classList.remove('active');
      setTimeout(() => {
        root.innerHTML = '';
        resolve(result);
      }, 300);
    };

    closeBtn.addEventListener('click', () => closeModal(false));
    cancelBtn.addEventListener('click', () => closeModal(false));
    confirmBtn.addEventListener('click', () => closeModal(true));
    
    // ESC-only close - backdrop click disabled
    // overlay.addEventListener('click', (e) => {
    //   if (e.target === overlay) closeModal(false);
    // });
  });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}