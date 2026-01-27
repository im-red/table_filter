(() => {
    const STORAGE_KEY_PREFIX = 'table_filter_state::';
    let overlay = null;
    let state = null;

    async function hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function getStorageKey() {
        const hashedOrigin = await hashString(location.origin);
        return STORAGE_KEY_PREFIX + hashedOrigin;
    }

    function createOverlay() {
        if (document.getElementById('table-filter-overlay')) return;

        overlay = document.createElement('div');
        overlay.id = 'table-filter-overlay';
        overlay.style.cssText = `position:fixed;top:10px;right:10px;z-index:2147483647;width:520px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:Arial,sans-serif;font-size:13px;padding:12px;border-radius:6px`;

        overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong>Table Filter Overlay</strong>
        <div>
          <button id="tf-close">Close</button>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Table selector</label>
        <input id="tf-table-selector" style="width:100%;margin-top:4px;padding:6px" placeholder="e.g. table.my-table or table" />
      </div>
      <div style="margin-bottom:8px">
        <div style="background:#f0f8ff;padding:8px;border-radius:4px;margin-bottom:8px;color:#333;font-size:12px">
          <strong>Table info:</strong> Total rows: <span id="tf-total-rows">-</span>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Variables (selector is relative to row)</label>
        <div id="tf-vars"></div>
        <button id="tf-add-var">Add variable</button>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Filter expression</label>
        <textarea id="tf-filter-expr" style="width:100%;height:64px;padding:6px;margin-top:4px" placeholder="e.g. parseFloat(v1) > 10 && v2.length > 2"></textarea>
        <div style="margin-top:4px">
          <div style="cursor:pointer;user-select:none;padding:4px;background:#e8e8e8;border-radius:2px;margin-bottom:4px" id="tf-filter-preview-toggle">
            <span style="font-weight:600;color:#333">Preview:</span> <span id="tf-filter-preview-summary" style="color:#666">-</span>
          </div>
          <div id="tf-filter-preview-detail" style="display:none;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;border:1px solid #d0d0d0;padding:4px;background:#fff;border-radius:2px;font-size:12px;font-family:monospace;color:#555;"></div>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-weight:600">Sort Expression (leave empty for no sorting)</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
          <input id="tf-sort-expression" style="padding:4px;border:1px solid #ccc;border-radius:2px;flex:1;" placeholder="Enter sort expression (e.g., parseFloat(v1) or v1)" />
        </div>
        <div style="margin-top:4px">
          <div style="cursor:pointer;user-select:none;padding:4px;background:#f0f8f0;border-radius:2px;margin-bottom:4px" id="tf-sort-preview-toggle">
            <span style="font-weight:600;color:#333">Sort Preview:</span> <span id="tf-sort-preview-summary" style="color:#666">-</span>
          </div>
          <div id="tf-sort-preview-detail" style="display:none;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;border:1px solid #d0e0d0;padding:4px;background:#f8fff8;border-radius:2px;font-size:12px;font-family:monospace;color:#555;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
        <span id="tf-filtered-count" style="font-size:12px;color:#666;display:none">Filtered: -</span>
        <button id="tf-apply">Apply</button>
        <button id="tf-export">Export JSON</button>
        <button id="tf-import">Import JSON</button>
        <input id="tf-import-file" type="file" accept=".json" style="display:none" />
      </div>
      <div style="margin-top:8px;color:#666;font-size:12px">
        Tips: define variables with a name and a selector like \`td:nth-child(1)\`. The value will be extracted using \`el.textContent.trim()\`.
      </div>
    `;

        document.body.appendChild(overlay);

        document.getElementById('tf-close').addEventListener('click', hideOverlay);
        document.getElementById('tf-add-var').addEventListener('click', addVarRow);
        document.getElementById('tf-apply').addEventListener('click', applyAndShow);
        document.getElementById('tf-export').addEventListener('click', exportConfig);
        document.getElementById('tf-import').addEventListener('click', () => {
            document.getElementById('tf-import-file').click();
        });
        document.getElementById('tf-import-file').addEventListener('change', importConfig);

        // Add click listener to toggle filter preview expand/collapse
        document.getElementById('tf-filter-preview-toggle').addEventListener('click', () => {
            const detailDiv = document.getElementById('tf-filter-preview-detail');
            const isHidden = detailDiv.style.display === 'none';
            detailDiv.style.display = isHidden ? 'block' : 'none';
        });

        // Add click listener to toggle sort preview expand/collapse
        document.getElementById('tf-sort-preview-toggle').addEventListener('click', () => {
            const detailDiv = document.getElementById('tf-sort-preview-detail');
            const isHidden = detailDiv.style.display === 'none';
            detailDiv.style.display = isHidden ? 'block' : 'none';
        });

        loadState().then(async () => {
            await renderVars();
        });
    }

    async function showOverlay() {
        if (!overlay) createOverlay();
        overlay.style.display = 'block';
        // load last state each time
        await loadState();
        renderVars();
        updateTableInfo();
        updateVarPreviews();
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.style.display = 'none';
        // restore any hidden rows' display to original? We leave rows as-is; user can reapply
    }

    function addVarRow(def) {
        const container = document.getElementById('tf-vars');
        const div = document.createElement('div');
        div.style = 'border:1px solid #eee;padding:8px;margin:6px 0;border-radius:4px;background:#fafafa';

        const idx = container.children.length;
        // Provide defaults for type if not specified
        const d = def || { name: `v${idx + 1}`, selector: `td:nth-child(${idx + 1})`, type: 'number' };

        div.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <input class="tf-var-name" placeholder="name" style="width:100px;padding:4px" value="${escapeHtml(d.name)}" />
        <input class="tf-var-selector" placeholder="selector (relative to row)" style="flex:1;padding:4px" value="${escapeHtml(d.selector)}" />
        <select class="tf-var-type" style="padding:4px;border:1px solid #ccc;border-radius:2px;">
          <option value="number" ${d.type === 'number' ? 'selected' : ''}>Number</option>
          <option value="text" ${d.type === 'text' ? 'selected' : ''}>Text</option>
        </select>
        <button class="tf-remove-var">Remove</button>
      </div>
      <div style="margin-top:6px;padding:6px;background:#f5f5f5;border-radius:3px;border:1px solid #e0e0e0;font-size:11px;font-family:monospace;color:#555">
        <div>
          <span style="font-weight:600;color:#333">Preview:</span> <span class="tf-preview-summary" style="color:#666">-</span>
        </div>
      </div>
    `;

        container.appendChild(div);
        div.querySelector('.tf-remove-var').addEventListener('click', () => { div.remove(); });



        // Add blur/change listeners to update table info and previews
        div.querySelector('.tf-var-name').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            updateVarPreviews();
        });
        div.querySelector('.tf-var-selector').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            updateVarPreviews();
        });
        div.querySelector('.tf-var-type').addEventListener('change', async () => {
            await persistState();
            updateTableInfo();
            updateVarPreviews();
        });
    }

    function renderVars() {
        const varsContainer = document.getElementById('tf-vars');
        varsContainer.innerHTML = '';
        if (!state) state = getDefaultState();
        document.getElementById('tf-table-selector').value = state.tableSelector || 'table';
        document.getElementById('tf-filter-expr').value = state.filterExpr || 'true';

        // Set sort expression
        const sortExpressionInput = document.getElementById('tf-sort-expression');
        sortExpressionInput.value = state.sortExpression || '';

        (state.vars || []).forEach(v => addVarRow(v));

        // Add blur listener to table selector input
        document.getElementById('tf-table-selector').addEventListener('blur', async () => {
            await persistState();
            updateTableInfo();
            updateVarPreviews();
        });

        // Add input listener to filter expression for real-time save
        document.getElementById('tf-filter-expr').addEventListener('change', async () => {
            await persistState();
            updateFilterPreview();
        });

        // Also add input listener for live preview updates
        document.getElementById('tf-filter-expr').addEventListener('input', () => {
            updateFilterPreview();
            updateSortPreview(); // Also update sort preview when filter changes
        });

        // Add change listener for sort expression
        document.getElementById('tf-sort-expression').addEventListener('change', async () => {
            await persistState();
            updateSortPreview(); // Update sort preview when sort expression changes
        });

        // Update preview initially
        updateFilterPreview();
        updateSortPreview();
    }

    function gatherVarsFromUI() {
        const rows = Array.from(document.querySelectorAll('#tf-vars > div'));
        return rows.map(div => {
            return {
                name: div.querySelector('.tf-var-name').value.trim() || 'v',
                selector: div.querySelector('.tf-var-selector').value.trim() || '',
                type: div.querySelector('.tf-var-type').value || 'number'
            };
        });
    }

    function gatherSortConfigFromUI() {
        return {
            sortExpression: document.getElementById('tf-sort-expression').value || ''
        };
    }

    async function updateFilterPreview() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const tables = Array.from(document.querySelectorAll(tableSelector));

        const previewResults = [];
        const previewSummary = [];
        let rowCount = 0;

        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                if (rowCount >= 10) break;

                try {
                    // compute variables - extract values using el.textContent.trim()
                    const ctx = {};
                    for (const v of vars) {
                        let el = null;
                        if (v.selector) {
                            el = row.querySelector(v.selector);
                        }

                        let rawValue = el ? el.textContent.trim() : '';

                        // Process value based on variable type
                        if (v.type === 'number') {
                            // Parse as number, fallback to 0 if NaN
                            const parsedValue = Number(rawValue);
                            ctx[v.name] = isNaN(parsedValue) ? 0 : parsedValue;
                        } else {
                            // Default to text
                            ctx[v.name] = rawValue;
                        }
                    }

                    // evaluate filter expression for preview
                    let result = false;
                    try {
                        result = Boolean(await evalExpressionInBackground(filterExpr, ctx));
                    } catch (err) {
                        result = false;
                    }

                    previewResults.push(`Row ${rowCount + 1}: ${result ? 'PASS' : 'FAIL'} (vars: ${JSON.stringify(ctx)})`);
                    previewSummary.push(result ? 'PASS' : 'FAIL');
                    rowCount++;
                } catch (err) {
                    previewResults.push(`Row ${rowCount + 1}: ERROR - ${err.message}`);
                    previewSummary.push('ERROR');
                    rowCount++;
                }
            }
            if (rowCount >= 10) break;
        }

        // Update summary (collapsed view)
        const summaryDiv = document.getElementById('tf-filter-preview-summary');
        if (summaryDiv) {
            if (previewSummary.length > 0) {
                summaryDiv.textContent = previewSummary.join(', ');
                summaryDiv.title = 'Click to expand';
            } else {
                summaryDiv.textContent = 'No data';
            }
        }

        // Update detailed preview (expanded view)
        const detailDiv = document.getElementById('tf-filter-preview-detail');
        if (detailDiv) {
            if (previewResults.length > 0) {
                detailDiv.innerHTML = previewResults.join('<br>');
            } else {
                detailDiv.innerHTML = '<div style="color:#999">No data</div>';
            }
        }
    }

    async function updateSortPreview() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const sortConfig = gatherSortConfigFromUI();
        const vars = gatherVarsFromUI();
        const tables = Array.from(document.querySelectorAll(tableSelector));

        if (!tables.length) {
            // Update sort preview with no data
            const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
            if (sortSummaryDiv) {
                sortSummaryDiv.textContent = 'No tables found';
            }
            const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
            if (sortDetailDiv) {
                sortDetailDiv.innerHTML = '<div style="color:#999">No tables found</div>';
            }
            return;
        }

        // Don't show preview if no sorting is configured (empty expression)
        if (!sortConfig.sortExpression || sortConfig.sortExpression === '') {
            const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
            if (sortSummaryDiv) {
                sortSummaryDiv.textContent = 'No sorting applied';
            }
            const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
            if (sortDetailDiv) {
                sortDetailDiv.innerHTML = '<div style="color:#999">No sorting applied</div>';
            }
            return;
        }

        const previewResults = [];
        const previewSummary = [];
        let rowCount = 0;

        // Collect sample rows to show sort preview
        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            for (const row of rows) {
                if (rowCount >= 10) break; // Limit to first 5 rows for preview

                try {
                    // Compute variables for this row
                    const ctx = {};
                    for (const v of vars) {
                        let el = null;
                        if (v.selector) {
                            el = row.querySelector(v.selector);
                        }

                        let rawValue = el ? el.textContent.trim() : '';

                        // Process value based on variable type
                        if (v.type === 'number') {
                            // Parse as number, fallback to 0 if NaN
                            const parsedValue = Number(rawValue);
                            ctx[v.name] = isNaN(parsedValue) ? 0 : parsedValue;
                        } else {
                            // Default to text
                            ctx[v.name] = rawValue;
                        }
                    }

                    // Evaluate filter expression to see if row would pass
                    let passesFilter = false;
                    try {
                        passesFilter = Boolean(await evalExpressionInBackground(filterExpr, ctx));
                    } catch (err) {
                        passesFilter = false;
                    }

                    let sortValue = 'N/A';
                    if (sortConfig.sortExpression) {
                        try {
                            const result = Number(await evalExpressionInBackground(sortConfig.sortExpression, ctx));
                            console.debug('Sort expression result:', result, 'expression:', sortConfig.sortExpression, 'context:', ctx);
                            sortValue = result;
                        } catch (err) {
                            console.error('Sort expression error:', err, 'expression:', sortConfig.sortExpression, 'context:', ctx);
                            sortValue = 'ERROR';
                        }
                    }

                    previewResults.push(`Row ${rowCount + 1}: Sort Value: ${sortValue}, (vars: ${JSON.stringify(ctx)})`);
                    previewSummary.push(`${sortValue}`);
                    rowCount++;
                } catch (err) {
                    console.error('Sort expression error:', err, 'expression:', sortConfig.sortExpression, 'context:', ctx);
                    previewResults.push(`Row ${rowCount + 1}: ERROR - ${err.message}`);
                    previewSummary.push(0);
                    rowCount++;
                }
            }
        }

        // Update sort preview summary (collapsed view)
        const sortSummaryDiv = document.getElementById('tf-sort-preview-summary');
        if (sortSummaryDiv) {
            if (previewSummary.length > 0) {
                sortSummaryDiv.textContent = previewSummary.join(', ');
                sortSummaryDiv.title = 'Click to expand sort preview';
            } else {
                sortSummaryDiv.textContent = 'No data';
            }
        }

        // Update sort detailed preview (expanded view)
        const sortDetailDiv = document.getElementById('tf-sort-preview-detail');
        if (sortDetailDiv) {
            if (previewResults.length > 0) {
                sortDetailDiv.innerHTML = previewResults.join('<br>');
            } else {
                sortDetailDiv.innerHTML = '<div style="color:#999">No data</div>';
            }
        }
    }

    function applyAndShow() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const sortConfig = gatherSortConfigFromUI();

        // Save temporarily to state
        state = { tableSelector, filterExpr, vars, ...sortConfig };
        updateTableInfo(); // Update total count
        updateVarPreviews();
        applyFilter(state);
    }

    async function applyFilter(s) {
        console.log('applyFilter called with:', s);
        const tables = Array.from(document.querySelectorAll(s.tableSelector));
        console.log('Found tables:', tables.length);
        if (!tables.length) return;

        const allPromises = [];
        let passedCount = 0; // Track passed rows

        // Process each table separately
        for (const tab of tables) {
            const rows = Array.from(tab.querySelectorAll('tr'));
            console.log('Found rows in table:', rows.length);

            // Array to hold rows with their context for sorting
            const processedRows = [];

            // Process each row to determine if it passes the filter
            for (const row of rows) {
                const promise = (async () => {
                    // compute variables - extract values using el.textContent.trim()
                    const ctx = {};
                    for (const v of s.vars) {
                        try {
                            let el = null;
                            if (v.selector) {
                                el = row.querySelector(v.selector);
                            }

                            let rawValue = el ? el.textContent.trim() : '';

                            // Process value based on variable type
                            if (v.type === 'number') {
                                // Parse as number, fallback to 0 if NaN
                                const parsedValue = Number(rawValue);
                                ctx[v.name] = isNaN(parsedValue) ? 0 : parsedValue;
                            } else {
                                // Default to text
                                ctx[v.name] = rawValue;
                            }
                        } catch (err) {
                            console.error('Error extracting value for variable:', v.name, 'error:', err);
                            ctx[v.name] = v.type === 'number' ? 0 : '';
                        }
                    }

                    // evaluate filter expression
                    let pass = false;
                    try {
                        pass = Boolean(await evalExpressionInBackground(s.filterExpr, ctx));
                        console.debug('Filter result for row:', pass, 'context:', ctx);
                    } catch (err) {
                        console.error('Error evaluating filter:', err);
                        pass = false;
                    }

                    // Only store rows that pass the filter for sorting
                    if (pass) {
                        processedRows.push({ row, ctx });
                        passedCount++;
                    }

                    // Hide rows that don't pass the filter
                    row.style.display = pass ? '' : 'none';
                })();
                allPromises.push(promise);
            }

            // Wait for all rows to be processed in this table
            await Promise.all(allPromises.slice(-rows.length)); // Get the last 'rows.length' promises

            // Sort the rows that passed the filter if sorting is enabled
            if (s.sortExpression && s.sortExpression !== '') {
                console.log('Sorting rows with expression:', s.sortExpression);
                // Sort by expression evaluation
                // First, compute the sort values for each row
                for (const item of processedRows) {
                    try {
                        const result = Number(await evalExpressionInBackground(s.sortExpression, item.ctx));
                        console.debug('Sort expression result:', result, 'expression:', s.sortExpression, 'context:', item.ctx);
                        item.sortValue = result;
                    } catch (err) {
                        console.error('Sort expression error:', err, 'expression:', s.sortExpression, 'context:', item.ctx);
                        item.sortValue = 'ERROR';
                    }
                }

                // Now sort based on computed sort values in descending order (larger values first)
                processedRows.sort((a, b) => {
                    const valA = a.sortValue !== undefined ? a.sortValue : '';
                    const valB = b.sortValue !== undefined ? b.sortValue : '';

                    // Try to convert to numbers for numeric comparison if possible
                    let numA = Number(valA);
                    let numB = Number(valB);

                    let comparison = 0;
                    if (!isNaN(numA) && !isNaN(numB)) {
                        // Both are numbers - sort in descending order (larger values first)
                        comparison = numB - numA;  // Note: B - A for descending order
                    } else {
                        // Convert to string for comparison if not numbers
                        comparison = String(valB).localeCompare(String(valA)); // Note: B compared to A for descending order
                    }

                    return comparison;
                });

                // Reorder the rows in the DOM based on the sorted order
                const tbody = tab.querySelector('tbody') || tab;
                processedRows.forEach(item => {
                    tbody.appendChild(item.row); // This moves the element to the end
                });
            }
        }

        console.log('Waiting for', allPromises.length, 'promises');
        await Promise.all(allPromises);
        console.log('All promises resolved');

        // Update table info with filtered count and show the filtered count display
        setTimeout(() => {
            updateTableInfo(passedCount);
            // Show the filtered count display after applying filter
            const filteredCountElem = document.getElementById('tf-filtered-count');
            if (filteredCountElem) {
                filteredCountElem.style.display = 'inline';
            }
        }, 100); // Small delay to ensure DOM updates are complete
    }

    async function persistState() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const sortConfig = gatherSortConfigFromUI();
        const toSave = { tableSelector, filterExpr, vars, ...sortConfig };
        state = toSave;
        try {
            const key = await getStorageKey();
            chrome.storage.local.set({ [key]: toSave }, () => {
                // auto-saved
            });
        } catch (e) {
            console.error('storage save failed', e);
        }
    }

    function exportConfig() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const filterExpr = document.getElementById('tf-filter-expr').value.trim() || 'true';
        const vars = gatherVarsFromUI();
        const config = { tableSelector, filterExpr, vars };
        const json = JSON.stringify(config, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'table-filter-config.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function importConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const config = JSON.parse(e.target.result);
                if (config.tableSelector !== undefined && config.filterExpr !== undefined && Array.isArray(config.vars)) {
                    state = config;
                    try {
                        const key = await getStorageKey();
                        chrome.storage.local.set({ [key]: config }, () => {
                            renderVars();
                            updateTableInfo();
                            updateVarPreviews();
                        });
                    } catch (e) {
                        console.error('storage save failed during import', e);
                    }
                } else {
                    alert('Invalid config format');
                }
            } catch (err) {
                alert('Failed to parse JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        // Reset file input
        event.target.value = '';
    }

    async function loadState() {
        try {
            const key = await getStorageKey();
            return new Promise(resolve => {
                try {
                    chrome.storage.local.get([key], (res) => {
                        if (res && res[key]) {
                            state = res[key];
                        } else {
                            state = getDefaultState();
                        }
                        resolve(state);
                    });
                } catch (e) {
                    state = getDefaultState();
                    resolve(state);
                }
            });
        } catch (e) {
            state = getDefaultState();
            return Promise.resolve(state);
        }
    }

    function getDefaultState() {
        return {
            tableSelector: 'table',
            filterExpr: 'true',
            sortExpression: '',
            vars: [
                { name: 'v1', selector: 'td:nth-child(1)', type: 'number' },
                { name: 'v2', selector: 'td:nth-child(2)', type: 'number' },
                { name: 'v3', selector: 'td:nth-child(3)', type: 'number' }
            ]
        };
    }

    function escapeHtml(s) {
        return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Helper to evaluate expressions - use manifest sandbox to bypass CSP
    let evalSandbox = null;
    let sandboxReady = false;
    let pendingRequests = new Map();
    let requestId = 0;

    function getOrCreateEvalSandbox() {
        if (evalSandbox && evalSandbox.parentElement && sandboxReady) {
            return Promise.resolve(evalSandbox);
        }

        return new Promise((resolve) => {
            if (evalSandbox && evalSandbox.parentElement) {
                // iframe exists but not ready yet, wait for ready message
                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'SANDBOX_READY') {
                        window.removeEventListener('message', readyHandler);
                        sandboxReady = true;
                        resolve(evalSandbox);
                    }
                };
                window.addEventListener('message', readyHandler);
            } else {
                // create new iframe - using manifest declared sandbox page
                evalSandbox = document.createElement('iframe');
                evalSandbox.style.display = 'none';
                evalSandbox.src = chrome.runtime.getURL('eval-sandbox.html');

                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'SANDBOX_READY') {
                        window.removeEventListener('message', readyHandler);
                        sandboxReady = true;
                        resolve(evalSandbox);
                    }
                };

                window.addEventListener('message', readyHandler);
                document.body.appendChild(evalSandbox);
            }
        });
    }

    function evalExpressionInBackground(expr, context) {
        console.debug('[content_script] evalExpressionInBackground called:', { expr, context });
        return getOrCreateEvalSandbox().then((iframe) => {
            return new Promise((resolve, reject) => {
                const id = ++requestId;
                pendingRequests.set(id, { resolve, reject });

                // Set up response handler
                const responseHandler = (event) => {
                    if (event.data && event.data.type === 'EVAL_EXPR_RESPONSE' && event.data.id === id) {
                        window.removeEventListener('message', responseHandler);
                        const { success, result, error } = event.data;
                        if (success) {
                            console.debug('[content_script] sandbox eval result:', result);
                            resolve(result);
                        } else {
                            console.error('[content_script] sandbox eval error:', error);
                            reject(new Error(error));
                        }
                    }
                };
                window.addEventListener('message', responseHandler);

                // Send evaluation request to iframe
                iframe.contentWindow.postMessage({
                    type: 'EVAL_EXPR_REQUEST',
                    id,
                    expr,
                    context
                }, '*');

                // Timeout for safety
                setTimeout(() => {
                    if (pendingRequests.has(id)) {
                        pendingRequests.delete(id);
                        window.removeEventListener('message', responseHandler);
                        reject(new Error('Expression evaluation timeout'));
                    }
                }, 5000);
            });
        });
    }

    function updateTableInfo(filteredRowCount = null) {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const tables = Array.from(document.querySelectorAll(tableSelector));
        let totalRows = 0;
        tables.forEach(tab => {
            const rows = Array.from(tab.querySelectorAll('tr'));
            totalRows += rows.length;
        });

        const elem = document.getElementById('tf-total-rows');
        if (elem) {
            if (filteredRowCount !== null) {
                elem.textContent = `${totalRows} (filtered: ${filteredRowCount})`;
            } else {
                elem.textContent = totalRows;
            }
        }

        // Update filtered count display near Apply button
        const filteredCountElem = document.getElementById('tf-filtered-count');
        if (filteredCountElem) {
            if (filteredRowCount !== null) {
                filteredCountElem.textContent = `Filtered: ${filteredRowCount}`;
            } else {
                filteredCountElem.textContent = `Filtered: ${totalRows}`;
            }
        }
    }

    async function updateVarPreviews() {
        const tableSelector = document.getElementById('tf-table-selector').value.trim() || 'table';
        const vars = gatherVarsFromUI();
        const tables = Array.from(document.querySelectorAll(tableSelector));

        const summaryElems = document.querySelectorAll('.tf-preview-summary');

        for (let varIdx = 0; varIdx < summaryElems.length; varIdx++) {
            if (varIdx >= vars.length) continue;

            const v = vars[varIdx];
            const previews = [];

            // collect first 10 rows of values
            let rowCount = 0;
            for (const tab of tables) {
                const rows = Array.from(tab.querySelectorAll('tr'));
                for (const row of rows) {
                    if (rowCount >= 10) break;
                    try {
                        let el = null;
                        if (v.selector) {
                            el = row.querySelector(v.selector);
                        }
                        // Extract value directly using textContent.trim()
                        const val = el ? el.textContent.trim() : '';
                        previews.push(val);

                        rowCount++;
                    } catch (err) {
                        previews.push('ERROR');
                        rowCount++;
                    }
                }
                if (rowCount >= 10) break;
            }

            // Update summary (show first 10 values)
            const summaryElem = summaryElems[varIdx];
            if (summaryElem) {
                if (previews.length > 0) {
                    summaryElem.textContent = previews.join(', ');
                } else {
                    summaryElem.textContent = 'No data';
                }
            }
        }
    }

    // message listener to toggle overlay
    chrome.runtime.onMessage.addListener(async (msg, sender, resp) => {
        if (msg && msg.type === 'TOGGLE_TABLE_FILTER_OVERLAY') {
            const existing = document.getElementById('table-filter-overlay');
            if (existing && existing.style.display !== 'none') hideOverlay(); else await showOverlay();
        }
    });

    // make sure overlay can be created if extension icon clicked before DOMContentLoaded
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => { });
    }

})();